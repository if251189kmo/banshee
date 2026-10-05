// Оцінка однієї команди еталонного набору: чи зробила модель те, що очікувалось.
// Детерміновано, без LLM-судді: порівнюються інструменти й аргументи, для уточнення — питання.
import { writtenCall } from '@banshee/core/brain/written-call';
import { findTool } from '../tools.ts';
import type { ArgMatcher, EvalCase, ExpectedCall } from './dataset.ts';

export { writtenCall } from '@banshee/core/brain/written-call';

export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
}

/**
 * Чим закінчився хід: `end_turn` — модель відповіла текстом; `final_tools` — проста дія вдалася,
 * хід завершено без другого виклику; решта — збої.
 */
export type StopKind = 'end_turn' | 'final_tools' | 'max_steps' | 'max_tokens' | 'refusal';

export interface Outcome {
  readonly calls: readonly ToolCall[];
  /** Текст останньої відповіді моделі — те, що почув би власник. */
  readonly finalText: string;
  readonly stop: StopKind;
}

export interface Grade {
  readonly pass: boolean;
  /** Чому не пройшла, українською; для успіху — порожньо. */
  readonly reason: string;
}

const PASS: Grade = { pass: true, reason: '' };
const fail = (reason: string): Grade => ({ pass: false, reason });

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll('/', '\\').replaceAll(/[’ʼ]/g, "'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(matcher: ArgMatcher): matcher is readonly string[] {
  return Array.isArray(matcher);
}

export function matchArg(expected: ArgMatcher, actual: unknown): boolean {
  if (expected === null) return actual === undefined || actual === null;
  if (typeof expected === 'string') {
    return typeof actual === 'string' && normalize(actual) === normalize(expected);
  }
  if (typeof expected === 'number' || typeof expected === 'boolean') return actual === expected;
  if (isStringList(expected)) {
    if (!Array.isArray(actual)) return false;
    const values = actual.flatMap((item) => (typeof item === 'string' ? [normalize(item)] : []));
    return expected.every((item) => values.includes(normalize(item)));
  }
  if ('oneOf' in expected) {
    return typeof actual === 'string' && expected.oneOf.some((item) => matchArg(item, actual));
  }
  if ('contains' in expected) {
    if (typeof actual !== 'string') return false;
    const parts = typeof expected.contains === 'string' ? [expected.contains] : expected.contains;
    return parts.every((part) => normalize(actual).includes(normalize(part)));
  }
  if ('pattern' in expected) {
    return typeof actual === 'string' && new RegExp(expected.pattern, 'iu').test(actual);
  }
  return (
    typeof actual === 'number' &&
    actual >= (expected.min ?? -Infinity) &&
    actual <= (expected.max ?? Infinity)
  );
}

export function matchCall(expected: ExpectedCall, call: ToolCall): boolean {
  if (expected.tool !== call.name) return false;
  const input = isRecord(call.input) ? call.input : {};
  return Object.entries(expected.args).every(([name, matcher]) => matchArg(matcher, input[name]));
}

/** Індекси викликів, зіставлені з очікуваними, або `undefined`, якщо зіставити не вдалося. */
function assign(
  expected: readonly ExpectedCall[],
  calls: readonly ToolCall[],
  ordered: boolean,
): number[] | undefined {
  if (ordered) {
    const used: number[] = [];
    let next = 0;
    for (const [index, call] of calls.entries()) {
      const wanted = expected[next];
      if (wanted && matchCall(wanted, call)) {
        used.push(index);
        next += 1;
      }
    }
    return next === expected.length ? used : undefined;
  }
  // Без порядку: перебір із поверненням; викликів у ході — одиниці.
  const taken = new Set<number>();
  const search = (position: number): boolean => {
    const wanted = expected[position];
    if (!wanted) return true;
    for (const [index, call] of calls.entries()) {
      if (taken.has(index) || !matchCall(wanted, call)) continue;
      taken.add(index);
      if (search(position + 1)) return true;
      taken.delete(index);
    }
    return false;
  };
  return search(0) ? [...taken] : undefined;
}

function describeCalls(calls: readonly ToolCall[]): string {
  if (calls.length === 0) return 'жодного';
  return calls.map((call) => `${call.name} ${JSON.stringify(call.input)}`).join('; ');
}

function gradeActions(item: EvalCase, outcome: Outcome): Grade {
  for (const expected of [item.calls, ...item.alt]) {
    const used = assign(expected, outcome.calls, item.ordered);
    if (!used) continue;
    const extra = outcome.calls.filter(
      (call, index) => !used.includes(index) && findTool(call.name)?.meta.readOnly !== true,
    );
    if (extra.length > 0) return fail(`зайві дії: ${describeCalls(extra)}`);
    return PASS;
  }
  const truncated = outcome.stop === 'final_tools' ? ' (хід завершено після простої дії)' : '';
  return fail(
    `очікувалось ${describeExpected(item.calls)}; було ${describeCalls(outcome.calls)}${truncated}`,
  );
}

function describeExpected(calls: readonly ExpectedCall[]): string {
  return calls.map((call) => `${call.tool} ${JSON.stringify(call.args)}`).join('; ');
}

export function gradeCase(item: EvalCase, outcome: Outcome): Grade {
  if (outcome.stop === 'max_tokens') return fail('відповідь обрізано лімітом max_tokens');
  const written = writtenCall(outcome.finalText);
  if (written) return fail(`виклик ${written} записано текстом, а не зроблено`);
  if (outcome.stop === 'max_steps') return fail('забагато кроків, хід не завершився');
  if (outcome.stop === 'refusal' && item.kind !== 'refuse') {
    return fail('модель відмовилась (stop_reason refusal)');
  }

  switch (item.kind) {
    case 'single':
    case 'multi':
      return gradeActions(item, outcome);
    case 'clarify':
      if (outcome.calls.length > 0) {
        return fail(`мала уточнити, а викликала ${describeCalls(outcome.calls)}`);
      }
      return outcome.finalText.includes('?') ? PASS : fail('у відповіді немає питання');
    case 'refuse':
      if (outcome.calls.length > 0) {
        return fail(`мала відмовити, а викликала ${describeCalls(outcome.calls)}`);
      }
      return outcome.finalText.trim() === '' && outcome.stop !== 'refusal'
        ? fail('порожня відповідь')
        : PASS;
  }
}
