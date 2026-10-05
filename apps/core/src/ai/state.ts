// Стан ШІ (.claude/logic/03-brain.md, «Стан ШІ й базовий режим», «Ліміти витрат»): з перемикача,
// наявності ключа, витрат проти лімітів і останньої помилки API. Порядок — від того, що власник
// виправляє сам (вимкнув, немає ключа, оплата), до того, що мине саме (ліміти, зв'язок).
import type { AiState } from '@banshee/shared';

/** Помилка API, що вимикає ШІ до виправлення; її визначає клієнт API за класом помилки SDK. */
export type ApiProblem = 'key_invalid' | 'billing' | 'console_limit' | 'offline';

export interface AiInputs {
  /** Налаштування `ai.enabled`. */
  readonly enabled: boolean;
  readonly hasKey: boolean;
  readonly spentTodayUsd: number;
  readonly spentMonthUsd: number;
  readonly limits: { readonly dayUsd: number; readonly monthUsd: number };
  /** «Ще $1 на сьогодні» кліком — додається до денного ліміту до 00:00. */
  readonly extraTodayUsd: number;
  readonly apiProblem?: { readonly problem: ApiProblem; readonly until?: string };
}

export interface AiStatus {
  readonly state: AiState;
  /** Коли ШІ повернеться сам: місцевий час «2026-10-06T00:00». */
  readonly until?: string;
}

/** Частка ліміту, з якої в треї попередження (03-brain.md). */
export const LIMIT_WARNING_SHARE = 0.8;

const pad = (value: number): string => String(value).padStart(2, '0');
const localMinute = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function nextMidnight(now: Date): string {
  return localMinute(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export function firstOfNextMonth(now: Date): string {
  return localMinute(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

export function aiStatus(inputs: AiInputs, now: Date): AiStatus {
  if (!inputs.enabled) return { state: 'off' };
  if (!inputs.hasKey) return { state: 'no_key' };
  const problem = inputs.apiProblem;
  if (problem && problem.problem !== 'offline') {
    return problem.until
      ? { state: problem.problem, until: problem.until }
      : { state: problem.problem };
  }
  if (inputs.spentMonthUsd >= inputs.limits.monthUsd) {
    return { state: 'month_limit', until: firstOfNextMonth(now) };
  }
  if (inputs.spentTodayUsd >= inputs.limits.dayUsd + inputs.extraTodayUsd) {
    return { state: 'day_limit', until: nextMidnight(now) };
  }
  if (problem?.problem === 'offline') return { state: 'offline' };
  return { state: 'active' };
}

/** Попередження про 80 % ліміту: спершу місячного, бо його не скинути кліком. */
export function limitWarning(inputs: AiInputs): 'day' | 'month' | null {
  if (inputs.spentMonthUsd >= inputs.limits.monthUsd * LIMIT_WARNING_SHARE) return 'month';
  if (inputs.spentTodayUsd >= (inputs.limits.dayUsd + inputs.extraTodayUsd) * LIMIT_WARNING_SHARE) {
    return 'day';
  }
  return null;
}
