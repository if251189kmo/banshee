// Агентний цикл одного ходу через Haiku (.claude/logic/03-brain.md, «Маршрутизація»): модель дає першу
// фразу й викликає інструменти; кожна дія проходить оцінку рівня й підтвердження (05-safety.md) і
// пишеться в журнал. Проста дія `final`, що вдалася, завершує хід без другого виклику — її результат
// піде на початку наступного запиту. `escalate` — окремий субагент Sonnet зі своїм контекстом.
import type Anthropic from '@anthropic-ai/sdk';
import { findTool, toolDefinitions, type ClaudeTool } from '@banshee/pc/definitions';
import { confirmationFor, type ActionLevel, type ConfirmMethod } from '@banshee/shared';
import { Cancelled, FirstTokenTimeout, type ModelClient, type ModelReply } from './model-client.ts';
import { repairToolInput } from './tool-input.ts';
import { writtenCall } from './written-call.ts';

/** Більше запитів на одну команду не буває: інакше це цикл. */
export const MAX_STEPS = 6;
/** Швидкий шлях Haiku (03-brain.md). */
export const HAIKU_MAX_TOKENS = 1024;
export const ESCALATION_MAX_TOKENS = 4096;
const RESULT_LIMIT = 4000;

export const ESCALATION_SYSTEM =
  "You are a specialist consulted by Banshee, a voice assistant on the owner's Windows PC. " +
  'Solve the task you are given. You see only this task, not the conversation, and you cannot act ' +
  'on the PC yourself. Answer in Ukrainian, concisely, in plain sentences without markdown: your ' +
  'answer is retold to the owner by voice.';

export interface Assessment {
  readonly level: ActionLevel;
  readonly summary: string;
  readonly command?: string;
  readonly consequence?: string;
}

/** Інструменти ПК: оцінка до виконання, виконання, «скасуй». У продукті — MCP-клієнт до mcp/pc. */
export interface ToolRunner {
  /** Рівень і опис дії; кидає помилку, якщо аргументи хибні. */
  assess(name: string, args: unknown): Promise<Assessment>;
  run(name: string, args: unknown): Promise<{ ok: boolean; content: string; undo?: unknown }>;
  undo(record: unknown): Promise<{ ok: boolean; content: string }>;
}

export interface ConfirmRequest {
  readonly tool: string;
  readonly level: ActionLevel;
  readonly summary: string;
  readonly command?: string;
  readonly consequence?: string;
  readonly tainted: boolean;
  readonly methods: readonly ConfirmMethod[];
  readonly timeoutSec: number;
  readonly armDelaySec: number;
}

/** Відповідь власника; approved false — «ні» або час вийшов. */
export type Confirm = (
  request: ConfirmRequest,
) => Promise<{ approved: boolean; method: ConfirmMethod | null }>;

export interface LlmCall {
  readonly model: string;
  readonly usage: Anthropic.Usage;
  readonly latencyMs: number;
}

export interface ActionRecord {
  readonly tool: string;
  readonly args: unknown;
  readonly level: ActionLevel;
  readonly confirmedBy: ConfirmMethod | null;
  readonly status: 'done' | 'failed' | 'denied' | 'cancelled';
  readonly result: string;
  readonly undo?: unknown;
}

export interface LoopHooks {
  /** Текст відповіді частинами: оверлей і озвучка. */
  say(text: string): void;
  llmCall(call: LlmCall): void;
  /** Картка дії: з'явилась і виконується. */
  actionStarted(tool: string, level: ActionLevel, summary: string): void;
  /** Запис у журнал дій; повертає його id. */
  action(record: ActionRecord, summary: string): number;
  /** Чи ще можна витрачати: ліміти дня й місяця перевіряються перед кожним запитом. */
  budgetLeft(): boolean;
}

export interface LoopInput {
  readonly client: ModelClient;
  readonly models: { readonly default: string; readonly complex: string };
  readonly escalation: boolean;
  readonly system: Anthropic.TextBlockParam[];
  /** Попередні ходи розмови. */
  readonly history: readonly Anthropic.MessageParam[];
  /** Результати простої дії попереднього ходу: ідуть на початку цього запиту. */
  readonly pending: readonly Anthropic.ToolResultBlockParam[];
  /** Рядок контексту ходу й команда (turn-line.ts). */
  readonly turnText: string;
  readonly tools: ToolRunner;
  readonly confirm: Confirm;
  /** Голосове «так» можна приймати: команду дав власник своїм голосом. */
  readonly voiceAllowed: boolean;
  readonly voiceSec: number;
  readonly tainted: boolean;
  readonly signal: AbortSignal;
  readonly hooks: LoopHooks;
  readonly definitions?: readonly ClaudeTool[];
  /** Кожна відповідь Haiku як є — для еталонного набору: виклики, фраза перед дією, перший токен. */
  readonly onReply?: (reply: ModelReply) => void;
  /** Ліміт запитів на хід; типово MAX_STEPS. */
  readonly maxSteps?: number;
}

export type LoopStop =
  | 'end_turn'
  | 'final_tools'
  | 'max_steps'
  | 'max_tokens'
  | 'refusal'
  | 'written_call'
  | 'budget'
  | 'cancelled'
  | 'timeout';

export interface LoopResult {
  readonly stop: LoopStop;
  readonly escalated: boolean;
  readonly history: Anthropic.MessageParam[];
  readonly pending: Anthropic.ToolResultBlockParam[];
  readonly finalText: string;
}

const textOf = (content: readonly Anthropic.ContentBlock[]): string =>
  content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(' ')
    .trim();

const limit = (text: string): string =>
  text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}…` : text;

/** Вхід escalate, перевірений кодом: схеми без strict (03-brain.md). */
function escalationTask(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('task' in input)) return null;
  const task: unknown = input.task;
  return typeof task === 'string' && task.trim() !== '' ? task : null;
}

export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const definitions = input.definitions ?? toolDefinitions();
  const messages: Anthropic.MessageParam[] = [...input.history];
  messages.push({
    role: 'user',
    content:
      input.pending.length > 0
        ? [...input.pending, { type: 'text', text: input.turnText }]
        : input.turnText,
  });
  let escalated = false;
  let finalText = '';
  const finish = (stop: LoopStop, pending: Anthropic.ToolResultBlockParam[] = []): LoopResult => ({
    stop,
    escalated,
    history: messages,
    pending,
    finalText,
  });

  const execute = async (use: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> => {
    const reply = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
      type: 'tool_result',
      tool_use_id: use.id,
      content: limit(content),
      ...(isError ? { is_error: true } : {}),
    });

    if (use.name === 'escalate') {
      const task = escalationTask(use.input);
      if (!input.escalation)
        return reply('{"ok":false,"error":"escalation is off in settings"}', true);
      if (task === null) return reply('{"ok":false,"error":"task is required"}', true);
      if (!input.hooks.budgetLeft())
        return reply('{"ok":false,"error":"spending limit reached"}', true);
      escalated = true;
      const answer = await input.client.escalate(
        {
          model: input.models.complex,
          system: ESCALATION_SYSTEM,
          task,
          maxTokens: ESCALATION_MAX_TOKENS,
        },
        { signal: input.signal },
      );
      input.hooks.llmCall({
        model: answer.model,
        usage: answer.usage,
        latencyMs: Math.round(answer.totalMs),
      });
      if (answer.stopReason === 'refusal') {
        return reply('{"ok":false,"error":"the specialist model declined this task"}', true);
      }
      return reply(textOf(answer.content) || '{"ok":false,"error":"empty answer"}');
    }

    const args = repairToolInput(use.input);
    let assessment: Assessment;
    try {
      assessment = await input.tools.assess(use.name, args);
    } catch (error) {
      return reply(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
        true,
      );
    }
    const confirmation = confirmationFor(assessment.level, {
      tainted: input.tainted,
      voiceAllowed: input.voiceAllowed,
      voiceSec: input.voiceSec,
    });
    let confirmedBy: ConfirmMethod | null = confirmation.required ? null : 'auto';
    if (confirmation.required) {
      const answer = await input.confirm({
        tool: use.name,
        level: assessment.level,
        summary: assessment.summary,
        ...(assessment.command ? { command: assessment.command } : {}),
        ...(assessment.consequence ? { consequence: assessment.consequence } : {}),
        tainted: input.tainted,
        methods: confirmation.methods,
        timeoutSec: confirmation.timeoutSec,
        armDelaySec: confirmation.armDelaySec,
      });
      if (!answer.approved) {
        input.hooks.action(
          {
            tool: use.name,
            args,
            level: assessment.level,
            confirmedBy: answer.method,
            status: 'denied',
            result: '',
          },
          assessment.summary,
        );
        return reply('{"ok":false,"declined":true,"error":"the owner declined this action"}');
      }
      confirmedBy = answer.method;
    }
    input.hooks.actionStarted(use.name, assessment.level, assessment.summary);
    const outcome = await input.tools.run(use.name, args);
    input.hooks.action(
      {
        tool: use.name,
        args,
        level: assessment.level,
        confirmedBy,
        status: outcome.ok ? 'done' : 'failed',
        result: limit(outcome.content),
        ...(outcome.undo === undefined ? {} : { undo: outcome.undo }),
      },
      assessment.summary,
    );
    return reply(outcome.content, !outcome.ok);
  };

  try {
    for (let step = 0; step < (input.maxSteps ?? MAX_STEPS); step += 1) {
      if (!input.hooks.budgetLeft()) return finish('budget');
      // Текст до першого виклику — фраза перед дією: озвучуємо її одразу, але не виклик, написаний текстом.
      let spoken = '';
      const reply: ModelReply = await input.client.turn(
        {
          model: input.models.default,
          system: input.system,
          tools: definitions,
          messages,
          maxTokens: HAIKU_MAX_TOKENS,
        },
        { signal: input.signal, onText: (delta) => (spoken += delta) },
      );
      input.hooks.llmCall({
        model: reply.model,
        usage: reply.usage,
        latencyMs: Math.round(reply.totalMs),
      });
      input.onReply?.(reply);
      finalText = textOf(reply.content);
      if (reply.stopReason === 'refusal') return finish('refusal');
      if (reply.stopReason === 'max_tokens') return finish('max_tokens');
      if (writtenCall(finalText) !== undefined) return finish('written_call');
      if (spoken.trim() !== '') input.hooks.say(spoken.trim());

      const uses = reply.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      messages.push({ role: 'assistant', content: [...reply.content] });
      if (uses.length === 0) return finish('end_turn');

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        if (input.signal.aborted) throw new Cancelled();
        results.push(await execute(use));
      }
      const allFinal = uses.every((use) => findTool(use.name)?.meta.final === true);
      if (allFinal && results.every((result) => result.is_error !== true)) {
        return finish('final_tools', results);
      }
      messages.push({ role: 'user', content: results });
    }
    return finish('max_steps');
  } catch (error) {
    if (error instanceof Cancelled) return finish('cancelled');
    if (error instanceof FirstTokenTimeout) return finish('timeout');
    throw error;
  }
}
