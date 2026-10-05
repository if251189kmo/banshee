// Дані центру керування (.claude/logic/09-ui.md): «Огляд», «Активність», «Журнал», картка «Стан ШІ».
// Рахуються з тих самих таблиць, що й журнал (`turns`, `llm_calls`, `actions`), тож числа
// «Активності» збігаються з журналом (F10). Дні — місцеві: `date(created_at, 'localtime')`.
import {
  SETTINGS,
  isSettingKey,
  type ActionLevel,
  type ActionSource,
  type ActionStatus,
  type AiDetails,
  type ConfirmMethod,
  type DayStats,
  type JournalItem,
  type JournalPage,
  type KeyStatus,
  type PeriodTotals,
  type StatsPeriod,
  type StatsResult,
} from '@banshee/shared';
import type { AiStatus } from './ai/state.ts';
import type { Db } from './db/database.ts';
import { readSettings } from './settings/store.ts';

const pad = (value: number): string => String(value).padStart(2, '0');
const localDay = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function percentile(sorted: readonly number[], share: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index] ?? null;
}

interface DayRow {
  day: string;
  turns: number;
  noAi: number;
  ai: number;
  escalated: number;
  refused: number;
  success: number;
  failed: number;
  corrected: number;
}

const EMPTY_DAY: Omit<DayStats, 'day'> = {
  turns: 0,
  noAi: 0,
  ai: 0,
  escalated: 0,
  refused: 0,
  success: 0,
  failed: 0,
  corrected: 0,
  costUsd: 0,
};

function dayRows(db: Db, from: Date, to: Date): Map<string, DayStats> {
  const rows = db
    .prepare<[string, string], DayRow>(
      `SELECT date(created_at, 'localtime') AS day, count(*) AS turns,
         sum(route = 'routine') AS noAi, sum(route IN ('llm', 'escalation')) AS ai,
         sum(route = 'escalation') AS escalated, sum(outcome = 'no_ai') AS refused,
         sum(outcome = 'success') AS success, sum(outcome = 'failed') AS failed,
         sum(outcome = 'corrected') AS corrected
       FROM turns WHERE route IS NOT NULL AND created_at >= ? AND created_at < ?
       GROUP BY day`,
    )
    .all(from.toISOString(), to.toISOString());
  const costs = db
    .prepare<[string, string], { day: string; usd: number }>(
      `SELECT date(created_at, 'localtime') AS day, sum(cost_usd) AS usd
       FROM llm_calls WHERE created_at >= ? AND created_at < ? GROUP BY day`,
    )
    .all(from.toISOString(), to.toISOString());
  const days = new Map<string, DayStats>();
  for (const row of rows) days.set(row.day, { ...EMPTY_DAY, ...row });
  for (const cost of costs) {
    days.set(cost.day, { ...EMPTY_DAY, ...days.get(cost.day), day: cost.day, costUsd: cost.usd });
  }
  return days;
}

function totals(db: Db, from: Date, to: Date): PeriodTotals {
  let sum: Omit<DayStats, 'day'> = EMPTY_DAY;
  for (const day of dayRows(db, from, to).values()) {
    sum = {
      turns: sum.turns + day.turns,
      noAi: sum.noAi + day.noAi,
      ai: sum.ai + day.ai,
      escalated: sum.escalated + day.escalated,
      refused: sum.refused + day.refused,
      success: sum.success + day.success,
      failed: sum.failed + day.failed,
      corrected: sum.corrected + day.corrected,
      costUsd: sum.costUsd + day.costUsd,
    };
  }
  const latencies = db
    .prepare<[string, string], { ms: number }>(
      `SELECT latency_ms AS ms FROM turns
       WHERE route IS NOT NULL AND latency_ms IS NOT NULL AND created_at >= ? AND created_at < ?`,
    )
    .all(from.toISOString(), to.toISOString())
    .map((row) => row.ms)
    .sort((a, b) => a - b);
  return {
    ...sum,
    noAiShare: sum.turns > 0 ? sum.noAi / sum.turns : null,
    successShare: sum.turns > 0 ? sum.success / sum.turns : null,
    costPerTurnUsd: sum.turns > 0 ? sum.costUsd / sum.turns : null,
    p50Ms: percentile(latencies, 0.5),
    p90Ms: percentile(latencies, 0.9),
  };
}

/** Статистика за останні `period` днів, включно з сьогодні, і за попередній такий самий період. */
export function stats(db: Db, period: StatsPeriod, now: Date = new Date()): StatsResult {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - period + 1);
  const previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - period);
  const byDay = dayRows(db, start, end);
  const days: DayStats[] = [];
  for (let offset = 0; offset < period; offset += 1) {
    const day = localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset));
    days.push(byDay.get(day) ?? { ...EMPTY_DAY, day });
  }
  const topAi = db
    .prepare<[string], { text: string; count: number }>(
      `SELECT coalesce(normalized, utterance) AS text, count(*) AS count FROM turns
       WHERE route IN ('llm', 'escalation') AND created_at >= ?
       GROUP BY text ORDER BY count DESC, text LIMIT 5`,
    )
    .all(start.toISOString());
  const topRoutines = db
    .prepare<[string], { template: string; uses: number }>(
      `SELECT r.trigger_template AS template, count(*) AS uses FROM turns t
       JOIN routines r ON r.id = t.routine_id
       WHERE t.route = 'routine' AND t.created_at >= ?
       GROUP BY r.id ORDER BY uses DESC, template LIMIT 5`,
    )
    .all(start.toISOString());
  return {
    period,
    days,
    totals: totals(db, start, end),
    previous: totals(db, previousStart, start),
    topAi,
    topRoutines,
  };
}

interface ActionRow {
  id: number;
  at: string;
  tool: string;
  level: ActionLevel;
  source: ActionSource;
  confirmedBy: ConfirmMethod | null;
  status: ActionStatus;
  summary: string | null;
  argsJson: string;
  hasUndo: number;
  undone: number;
}

/** Опис для записів без збереженого речення: налаштування, «скасуй», старі записи. */
function describe(tool: string, argsJson: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    // лишаємо порожні аргументи
  }
  if (tool === 'settings.set' && typeof args['key'] === 'string' && isSettingKey(args['key'])) {
    return `Налаштування «${SETTINGS[args['key']].label}»: ${JSON.stringify(args['value'])}`;
  }
  if (tool === 'undo') return `Скасування дії №${String(args['actionId'])}`;
  const shown = JSON.stringify(args);
  return shown === '{}' ? tool : `${tool} ${shown.slice(0, 120)}`;
}

export interface JournalQuery {
  readonly limit: number;
  readonly before?: number;
  readonly level?: ActionLevel;
  readonly status?: ActionStatus;
}

/** Журнал дій, новіші спершу. */
export function journal(db: Db, query: JournalQuery): JournalPage {
  const rows = db
    .prepare<
      [
        number | null,
        number | null,
        string | null,
        string | null,
        string | null,
        string | null,
        number,
      ],
      ActionRow
    >(
      `SELECT a.id, a.created_at AS at, a.tool, a.tier AS level, a.source,
         a.confirmed_by AS confirmedBy, a.status, a.summary, a.args_json AS argsJson,
         a.undo_json IS NOT NULL AS hasUndo,
         EXISTS (SELECT 1 FROM actions u WHERE u.tool = 'undo' AND u.status = 'done'
           AND CAST(json_extract(u.args_json, '$.actionId') AS INTEGER) = a.id) AS undone
       FROM actions a
       WHERE (? IS NULL OR a.id < ?) AND (? IS NULL OR a.tier = ?) AND (? IS NULL OR a.status = ?)
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(
      query.before ?? null,
      query.before ?? null,
      query.level ?? null,
      query.level ?? null,
      query.status ?? null,
      query.status ?? null,
      query.limit + 1,
    );
  const items: JournalItem[] = rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    at: row.at,
    tool: row.tool,
    level: row.level,
    source: row.source,
    confirmedBy: row.confirmedBy,
    status: row.status,
    summary: row.summary ?? describe(row.tool, row.argsJson),
    undoable: row.hasUndo === 1 && row.status === 'done' && row.undone === 0,
    undone: row.undone === 1,
  }));
  return { items, more: rows.length > query.limit };
}

export interface AiDetailsInput {
  readonly status: AiStatus;
  readonly spending: { todayUsd: number; monthUsd: number; extraTodayUsd: number };
  readonly key: KeyStatus;
}

/** Картка «Стан ШІ»: оцінка кредитів — сума поповнення мінус витрати відтоді (12-api.md). */
export function aiDetails(db: Db, input: AiDetailsInput): AiDetails {
  const settings = readSettings(db).settings;
  const credits = settings['ai.credits'];
  let creditsLeftUsd: number | null = null;
  if (credits !== null) {
    const since =
      db
        .prepare<[], { at: string }>(
          `SELECT updated_at AS at FROM settings WHERE key = 'ai.credits' AND deleted = 0`,
        )
        .get()?.at ?? '1970-01-01T00:00:00.000Z';
    const spent =
      db
        .prepare<[string], { usd: number }>(
          'SELECT coalesce(sum(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ?',
        )
        .get(since)?.usd ?? 0;
    creditsLeftUsd = Math.max(0, credits - spent);
  }
  const lastCallAt =
    db.prepare<[], { at: string | null }>('SELECT max(created_at) AS at FROM llm_calls').get()
      ?.at ?? null;
  return {
    state: input.status.state,
    ...(input.status.until ? { until: input.status.until } : {}),
    model: settings['ai.models'].default,
    complexModel: settings['ai.models'].complex,
    key: input.key,
    spentTodayUsd: input.spending.todayUsd,
    spentMonthUsd: input.spending.monthUsd,
    limits: settings['ai.limits'],
    extraTodayUsd: input.spending.extraTodayUsd,
    creditsLeftUsd,
    lastCallAt,
  };
}
