// Підсумок прогону еталонного набору: точність, вартість, кеш, затримка (07-quality.md).
import { totalInputTokens, usageCostUsd } from '../models.ts';
import { CASE_KINDS, type CaseKind, type EvalCase } from './dataset.ts';
import type { Grade } from './grade.ts';
import type { CaseRun } from './run-case.ts';

/** Ціль кроку 0.1 і кожного прогону: нижче — помилка, а не попередження. */
export const ACCURACY_TARGET = 0.9;
/** Ціль влучання в кеш (N3). */
export const CACHE_TARGET = 0.7;

export interface CaseResult {
  readonly item: EvalCase;
  readonly run: CaseRun;
  readonly grade: Grade;
}

export interface Summary {
  readonly total: number;
  readonly passed: number;
  readonly accuracy: number;
  readonly byKind: Readonly<Record<CaseKind, { total: number; passed: number }>>;
  readonly modelCalls: number;
  readonly costUsd: number;
  /** Частка вхідних токенів, прочитаних з кешу. */
  readonly cacheReadShare: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ttftP50Ms: number;
  readonly ttftP90Ms: number;
  /** Скільки команд з діями почали з фрази до першої дії. */
  readonly preface: { readonly said: number; readonly of: number };
}

/** Перцентиль методом найближчого рангу; для порожнього списку — 0. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function summarize(results: readonly CaseResult[], model: string): Summary {
  const byKind = Object.fromEntries(
    CASE_KINDS.map((kind) => [kind, { total: 0, passed: 0 }]),
  ) as Record<CaseKind, { total: number; passed: number }>;
  let costUsd = 0;
  let inputTokens = 0;
  let cacheRead = 0;
  let outputTokens = 0;
  const ttft: number[] = [];
  const preface = { said: 0, of: 0 };

  for (const { item, run, grade } of results) {
    byKind[item.kind].total += 1;
    if (grade.pass) byKind[item.kind].passed += 1;
    for (const reply of run.replies) {
      const { usage } = reply;
      costUsd += usageCostUsd(model, usage);
      inputTokens += totalInputTokens(usage);
      cacheRead += usage.cache_read_input_tokens ?? 0;
      outputTokens += usage.output_tokens;
      ttft.push(reply.ttftMs);
    }
    if (run.prefaceBeforeAction !== undefined) {
      preface.of += 1;
      if (run.prefaceBeforeAction) preface.said += 1;
    }
  }

  const passed = results.filter((result) => result.grade.pass).length;
  return {
    total: results.length,
    passed,
    accuracy: results.length === 0 ? 0 : passed / results.length,
    byKind,
    modelCalls: ttft.length,
    costUsd,
    cacheReadShare: inputTokens === 0 ? 0 : cacheRead / inputTokens,
    inputTokens,
    outputTokens,
    ttftP50Ms: percentile(ttft, 0.5),
    ttftP90Ms: percentile(ttft, 0.9),
    preface,
  };
}

const KIND_LABELS: Record<CaseKind, string> = {
  single: 'одна дія',
  multi: 'кілька кроків',
  clarify: 'уточнити',
  refuse: 'відмова',
};

const percent = (value: number): string => `${String(Math.round(value * 100))} %`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)} с`;

/** Рядки підсумку для консолі й звіту. */
export function formatSummary(summary: Summary): string[] {
  const kinds = CASE_KINDS.map(
    (kind) =>
      `${KIND_LABELS[kind]} ${String(summary.byKind[kind].passed)}/${String(summary.byKind[kind].total)}`,
  ).join(' · ');
  const accuracyOk = summary.accuracy >= ACCURACY_TARGET;
  const cacheOk = summary.cacheReadShare >= CACHE_TARGET;
  const perCall = summary.modelCalls === 0 ? 0 : summary.costUsd / summary.modelCalls;
  return [
    `Точність: ${String(summary.passed)}/${String(summary.total)} = ${percent(summary.accuracy)} ` +
      `(ціль ≥ ${percent(ACCURACY_TARGET)}) — ${accuracyOk ? 'OK' : 'НИЖЧЕ ЦІЛІ'}`,
    `  ${kinds}`,
    `Кеш: ${percent(summary.cacheReadShare)} вхідних токенів з кешу ` +
      `(ціль ≥ ${percent(CACHE_TARGET)}) — ${cacheOk ? 'OK' : 'НИЖЧЕ ЦІЛІ'}`,
    `Вартість: $${summary.costUsd.toFixed(4)} за прогін, $${perCall.toFixed(5)} за виклик, ` +
      `${String(summary.modelCalls)} викликів; токени: ${String(summary.inputTokens)} вхід, ` +
      `${String(summary.outputTokens)} вихід`,
    `Перший токен: p50 ${seconds(summary.ttftP50Ms)}, p90 ${seconds(summary.ttftP90Ms)}`,
    `Фраза перед дією: ${String(summary.preface.said)} з ${String(summary.preface.of)}`,
  ];
}
