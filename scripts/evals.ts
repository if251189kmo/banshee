// `npm run evals` — еталонний набір на справжньому Haiku 4.5 з кешем; інструменти — заглушки,
// на ПК нічого не виконується (крок 0.1, .claude/logic/07-quality.md).
// Витрачає кредити API: ≈ $0,1 за прогін, стеля одного прогону — $0,50.
// Параметри: `-- --only id1,id2` — лише ці команди; `-- --limit 5` — перші п'ять;
// `-- --strict` — інструменти зі `strict: true`, для порівняння точності й затримки;
// `-- --texts файл.json` — тексти команд, розпізнані з голосу ({ "id": "текст" }), замість текстів набору (крок 0.3);
// `-- --no-injections` — без сценаріїв ін'єкцій (крок 1.8). Хід іде циклом core (apps/core/src/brain/loop.ts).
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient } from '@banshee/core/brain/model-client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { classifyApiError } from './lib/api-status.ts';
import { CLAUDE_KEY_RECORD, readClaudeKey } from './lib/credentials.ts';
import { parseDataset, withTexts, type EvalCase } from './lib/evals/dataset.ts';
import { gradeCase, type ToolCall } from './lib/evals/grade.ts';
import { executedInjections, parseInjections, type InjectionCase } from './lib/evals/injections.ts';
import { ACCURACY_TARGET, formatSummary, summarize, type CaseResult } from './lib/evals/report.ts';
import { runCase } from './lib/evals/run-case.ts';
import { MODELS, usageCostUsd } from './lib/models.ts';
import { buildSystem } from './lib/system-prompt.ts';
import { toolDefinitions } from './lib/tools.ts';
import { formatOwnerTurn } from './lib/turn.ts';

const MAX_RUN_COST_USD = 0.5;
/** Коротший префікс Haiku 4.5 не кешує — без помилки, просто дорожче (03-brain.md). */
const HAIKU_CACHE_MIN_TOKENS = 4096;

const DATASET = new URL('../evals/commands.json', import.meta.url);
const INJECTIONS = new URL('../evals/injections.json', import.meta.url);
const PROFILE = new URL('../evals/profile.md', import.meta.url);
const RESULTS = new URL('../evals/results/', import.meta.url);

function selectCases(cases: readonly EvalCase[], only?: string, limit?: string): EvalCase[] {
  let selected = [...cases];
  if (only) {
    const ids = new Set(only.split(',').map((id) => id.trim()));
    const unknown = [...ids].filter((id) => !cases.some((item) => item.id === id));
    if (unknown.length > 0) throw new Error(`Немає команд з id: ${unknown.join(', ')}`);
    selected = selected.filter((item) => ids.has(item.id));
  }
  if (limit) {
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1) throw new Error('--limit — ціле число від 1');
    selected = selected.slice(0, count);
  }
  return selected;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      limit: { type: 'string' },
      strict: { type: 'boolean' },
      texts: { type: 'string' },
      'no-injections': { type: 'boolean' },
    },
  });
  const dataset = parseDataset(JSON.parse(await readFile(DATASET, 'utf8')) as unknown);
  const profile = (await readFile(PROFILE, 'utf8')).trim();
  const voiced = values.texts
    ? withTexts(dataset.cases, JSON.parse(await readFile(values.texts, 'utf8')) as unknown)
    : dataset.cases;
  const cases = selectCases(voiced, values.only, values.limit);
  const injections =
    values['no-injections'] === true || values.only !== undefined || values.limit !== undefined
      ? []
      : parseInjections(JSON.parse(await readFile(INJECTIONS, 'utf8')) as unknown).cases;
  const injectionResults: { item: InjectionCase; executed: ToolCall[]; finalText: string }[] = [];

  const key = await readClaudeKey();
  if (!key) {
    console.error(
      `Ключа Claude немає (запис ${CLAUDE_KEY_RECORD}). Його вводить власник: npm run key`,
    );
    return 2;
  }
  const client = new Anthropic({ apiKey: key });
  const model = MODELS.default;
  const strict = values.strict === true;
  const base = {
    model,
    tools: strict
      ? toolDefinitions().map((tool) => ({ ...tool, strict: true }))
      : toolDefinitions(),
    system: buildSystem(profile),
    // Друга точка кешу — кінець розмови, TTL 5 хв; перша (1 год) — на профілі.
    cache_control: { type: 'ephemeral' as const },
  };

  const turnClient = anthropicClient(key);

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  let prefixTokens: number | undefined;
  let aborted = false;
  let spent = 0;

  try {
    const counted = await client.messages.countTokens({
      model,
      tools: base.tools,
      system: base.system,
      messages: [{ role: 'user', content: '.' }],
    });
    prefixTokens = counted.input_tokens;
    console.log(
      `Еталонний набір: ${String(cases.length)} команд, ${model}, ` +
        `${String(base.tools.length)} інструментів${strict ? ' зі strict' : ''}; префікс ≈ ${String(prefixTokens)} токенів` +
        (values.texts ? `; тексти — ${values.texts}` : ''),
    );
    if (prefixTokens < HAIKU_CACHE_MIN_TOKENS) {
      console.warn(
        `Префікс коротший за ${String(HAIKU_CACHE_MIN_TOKENS)} токенів — Haiku 4.5 його не кешує.`,
      );
    }

    for (const item of cases) {
      const turn = formatOwnerTurn(item.text, dataset.now, item.source);
      const run = await runCase(turnClient, turn, item.stubs, {
        profile,
        ...(strict ? { definitions: base.tools } : {}),
      });
      const grade = gradeCase(item, run);
      results.push({ item, run, grade });
      spent += run.replies.reduce((sum, reply) => sum + usageCostUsd(model, reply.usage), 0);
      const detail = grade.pass ? '' : ` — ${grade.reason}; відповідь: «${run.finalText}»`;
      console.log(`${grade.pass ? '✓' : '✗'} ${item.id} «${item.text}»${detail}`);
      if (spent > MAX_RUN_COST_USD) {
        console.error(`Витрати прогону перевищили $${MAX_RUN_COST_USD.toFixed(2)} — зупиняю.`);
        aborted = true;
        break;
      }
    }
    for (const item of aborted ? [] : injections) {
      const turns = item.turns.map((text) => formatOwnerTurn(text, dataset.now, 'text'));
      const run = await runCase(turnClient, turns, item.stubs, { profile });
      spent += run.replies.reduce((sum, reply) => sum + usageCostUsd(model, reply.usage), 0);
      const executed = executedInjections(item, run.calls);
      injectionResults.push({ item, executed, finalText: run.finalText });
      const detail =
        executed.length === 0
          ? ''
          : ` — виконано: ${executed.map((call) => `${call.name} ${JSON.stringify(call.input)}`).join('; ')}`;
      console.log(`${executed.length === 0 ? '✓' : '✗'} ін'єкція ${item.id}${detail}`);
      if (spent > MAX_RUN_COST_USD) {
        console.error(`Витрати прогону перевищили ${MAX_RUN_COST_USD.toFixed(2)} — зупиняю.`);
        aborted = true;
        break;
      }
    }
  } catch (error) {
    const failure = classifyApiError(error);
    console.error(`Claude API: помилка. ${failure.message}`);
    aborted = true;
  }

  const summary = summarize(results, model);
  const stamp = startedAt.replaceAll(':', '-').slice(0, 19);
  await mkdir(RESULTS, { recursive: true });
  const report = {
    model,
    strict,
    texts: values.texts ?? null,
    startedAt,
    now: dataset.now,
    prefixTokens,
    aborted,
    summary,
    injections: injectionResults.map(({ item, executed, finalText }) => ({
      id: item.id,
      vector: item.vector,
      pass: executed.length === 0,
      executed,
      finalText,
    })),
    cases: results.map(({ item, run, grade }) => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      pass: grade.pass,
      reason: grade.reason,
      stop: run.stop,
      calls: run.calls,
      finalText: run.finalText,
      prefaceBeforeAction: run.prefaceBeforeAction,
      replies: run.replies.map((reply) => ({
        stopReason: reply.stopReason,
        usage: reply.usage,
        ttftMs: Math.round(reply.ttftMs),
        totalMs: Math.round(reply.totalMs),
      })),
    })),
  };
  await writeFile(new URL(`${stamp}.json`, RESULTS), `${JSON.stringify(report, null, 2)}\n`);

  console.log('');
  for (const line of formatSummary(summary)) console.log(line);
  const executedCount = injectionResults.filter((result) => result.executed.length > 0).length;
  if (injectionResults.length > 0) {
    console.log(
      `Ін'єкції: виконано ${String(executedCount)} з ${String(injectionResults.length)} (ціль — 0)`,
    );
  }
  console.log(`Звіт: evals/results/${stamp}.json`);

  if (aborted) return 2;
  return summary.accuracy >= ACCURACY_TARGET && executedCount === 0 ? 0 : 1;
}

process.exit(await main());
