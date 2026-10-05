// Дані для сторінок центру керування (.claude/logic/09-ui.md): відповіді core на запити `key.*`,
// `ai.details`, `stats.get` і `journal.list`. Core і desktop — однієї збірки, тож результат у `reply`
// схема не перевіряє; типи спільні.
import type { AiState } from './ai.ts';
import type { ActionLevel, ActionSource, ActionStatus, ConfirmMethod } from './levels.ts';

/** Ключ Claude: показується лише як «••••1234» (10-settings.md, «Правила»). */
export interface KeyStatus {
  readonly present: boolean;
  readonly masked: string | null;
}

/** Перевірка ключа списком моделей; reason — вид збою API або `format`. */
export type KeyCheck =
  | { readonly ok: true; readonly masked: string }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/** Картка «Стан ШІ» (10-settings.md, «Мозок і витрати»). */
export interface AiDetails {
  readonly state: AiState;
  /** Коли ШІ повернеться сам, місцевий час. */
  readonly until?: string;
  readonly model: string;
  readonly complexModel: string;
  readonly key: KeyStatus;
  readonly spentTodayUsd: number;
  readonly spentMonthUsd: number;
  readonly limits: { readonly dayUsd: number; readonly monthUsd: number };
  readonly extraTodayUsd: number;
  /** Оцінка залишку: сума поповнення мінус витрати відтоді; null — суму не введено. */
  readonly creditsLeftUsd: number | null;
  readonly lastCallAt: string | null;
}

export const STATS_PERIODS = [7, 30, 90, 365] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/** Один день «Активності» (09-ui.md): ходи за маршрутом і результатом, витрати. */
export interface DayStats {
  /** Місцева дата YYYY-MM-DD. */
  readonly day: string;
  readonly turns: number;
  /** Без ШІ: рутини й вбудовані команди (`route = routine`). */
  readonly noAi: number;
  /** Через ШІ: Haiku й ескалація. */
  readonly ai: number;
  readonly escalated: number;
  /** Відмова базового режиму: потрібен ШІ, а його немає. */
  readonly refused: number;
  readonly success: number;
  readonly failed: number;
  readonly corrected: number;
  readonly costUsd: number;
}

export interface PeriodTotals {
  readonly turns: number;
  readonly noAi: number;
  readonly ai: number;
  readonly escalated: number;
  readonly refused: number;
  readonly success: number;
  readonly failed: number;
  readonly corrected: number;
  readonly costUsd: number;
  /** Частка ходів без ШІ (07-quality.md); null — ходів не було. */
  readonly noAiShare: number | null;
  readonly successShare: number | null;
  readonly costPerTurnUsd: number | null;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
}

export interface StatsResult {
  readonly period: StatsPeriod;
  /** Дні періоду від найстаршого, без пропусків. */
  readonly days: readonly DayStats[];
  readonly totals: PeriodTotals;
  /** Попередній період такої самої довжини — для порівняння. */
  readonly previous: PeriodTotals;
  /** Що найчастіше йде через ШІ — кандидати в рутини. */
  readonly topAi: readonly { readonly text: string; readonly count: number }[];
  /** Найкорисніші рутини — за кількістю запусків. */
  readonly topRoutines: readonly { readonly template: string; readonly uses: number }[];
}

/** Рядок журналу дій (09-ui.md, «Журнал»). */
export interface JournalItem {
  readonly id: number;
  readonly at: string;
  readonly tool: string;
  readonly level: ActionLevel;
  readonly source: ActionSource;
  readonly confirmedBy: ConfirmMethod | null;
  readonly status: ActionStatus;
  readonly summary: string;
  /** Можна скасувати: є дані для скасування, і дію ще не скасовано. */
  readonly undoable: boolean;
  readonly undone: boolean;
}

export interface JournalPage {
  readonly items: readonly JournalItem[];
  /** Є старіші записи: наступна сторінка — `before` = id останнього. */
  readonly more: boolean;
}
