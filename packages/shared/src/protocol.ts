// Протокол core ↔ desktop (.claude/logic/01-architecture.md, «Протокол core ↔ desktop»):
// повідомлення через MessagePort, без мережевих портів. Кожне повідомлення перевіряється схемою
// на вході: зіпсоване чи чуже повідомлення відкидається, а не кладе core чи інтерфейс.
import { AI_STATES } from './ai.ts';
import { ACTION_LEVELS, ACTION_STATUSES, CONFIRM_METHODS } from './levels.ts';
import { TURN_OUTCOMES, TURN_ROUTES, TURN_SOURCES, TURN_STATES } from './turns.ts';
import { STATS_PERIODS } from './views.ts';
import { z } from './zod.ts';

/**
 * Версія протоколу: core і desktop однієї збірки; різні версії — помилка встановлення.
 * 2 — крок 1.7: ключ Claude, картка «Стан ШІ», статистика й журнал.
 * 3 — етап 2: `say.speech` — текст для озвучки, `pc.state` — заблокований ПК.
 */
export const PROTOCOL_VERSION = 3;

const id = z.string().min(1).max(64);

// desktop → core

const hello = z.object({
  type: z.literal('hello'),
  version: z.number().int(),
  appVersion: z.string(),
});
/** Команда власника з оверлея або з голосу після розпізнавання. */
const command = z.object({
  type: z.literal('command'),
  id,
  text: z.string().trim().min(1).max(2000),
  source: z.enum(TURN_SOURCES),
  /** Перевірка голосу: схожість на профіль власника і чи пройдено поріг. Для тексту — немає. */
  voice: z.object({ score: z.number(), owner: z.boolean() }).optional(),
});
/** «Стоп»: скасувати запит до API, поточну дію й підтвердження. Озвучку desktop зупиняє сам. */
const stop = z.object({ type: z.literal('stop') });
const confirmReply = z.object({
  type: z.literal('confirm.reply'),
  requestId: id,
  approved: z.boolean(),
  method: z.enum(['voice', 'click', 'key']),
});
const settingsGet = z.object({ type: z.literal('settings.get'), id });
const settingsSet = z.object({
  type: z.literal('settings.set'),
  id,
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['ui', 'voice']),
});
/** «Ще $1 на сьогодні» — лише кліком (03-brain.md, «Ліміти витрат»). */
const aiExtraDay = z.object({ type: z.literal('ai.extraDay'), id });
const newEpisode = z.object({ type: z.literal('episode.new') });
/** Стан ПК від головного процесу: заблоковано — лише дозволені дії (02-voice.md). */
const pcState = z.object({ type: z.literal('pc.state'), locked: z.boolean() });
/** «Скасуй»: actionId — кнопка на картці дії; без нього — остання дія, яку можна скасувати. */
const undo = z.object({ type: z.literal('undo'), id, actionId: id.optional() });
/**
 * Ключ Claude (12-api.md, «Ключ»): стан «••••1234», вставити й перевірити, перевірити наявний,
 * видалити. Сам ключ іде лише в `key.set` і далі — у Credential Manager; назад не повертається.
 */
const keyStatus = z.object({ type: z.literal('key.status'), id });
const keySet = z.object({ type: z.literal('key.set'), id, key: z.string().min(1).max(500) });
const keyCheck = z.object({ type: z.literal('key.check'), id });
const keyDelete = z.object({ type: z.literal('key.delete'), id });
/** Картка «Стан ШІ»: стан, модель, ключ, витрати проти лімітів, оцінка кредитів. */
const aiDetails = z.object({ type: z.literal('ai.details'), id });
/** «Огляд» і «Активність»: ходи, частка без ШІ, витрати, затримка за період. */
const statsGet = z.object({
  type: z.literal('stats.get'),
  id,
  days: z.union(STATS_PERIODS.map((days) => z.literal(days))),
});
/** Журнал дій з фільтрами; before — id останнього показаного запису. */
const journalList = z.object({
  type: z.literal('journal.list'),
  id,
  limit: z.number().int().min(1).max(200),
  before: z.number().int().min(1).optional(),
  level: z.enum(ACTION_LEVELS).optional(),
  status: z.enum(ACTION_STATUSES).optional(),
});

export const desktopMessage = z.discriminatedUnion('type', [
  hello,
  command,
  stop,
  confirmReply,
  settingsGet,
  settingsSet,
  aiExtraDay,
  newEpisode,
  pcState,
  undo,
  keyStatus,
  keySet,
  keyCheck,
  keyDelete,
  aiDetails,
  statsGet,
  journalList,
]);
export type DesktopMessage = z.output<typeof desktopMessage>;

// core → desktop

const ready = z.object({
  type: z.literal('ready'),
  version: z.number().int(),
  aiState: z.enum(AI_STATES),
});
/** Відповідь на запит з id: налаштування, ключ, «Стан ШІ», статистика, журнал, «скасуй». */
const reply = z.object({
  type: z.literal('reply'),
  id,
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
const turnState = z.object({
  type: z.literal('turn.state'),
  turnId: id,
  state: z.enum(TURN_STATES),
});
/**
 * Текст відповіді частинами: оверлей показує стрімом, voice озвучує по реченнях.
 * speech — той самий текст для голосу (02-voice.md, «Текст для озвучки»): числа й знаки словами,
 * назви кирилицею, без лапок; є, коли speak.
 */
const say = z.object({
  type: z.literal('say'),
  turnId: id,
  text: z.string(),
  speak: z.boolean(),
  speech: z.string().optional(),
  done: z.boolean(),
});
/** Картка дії в оверлеї: іконка рівня, що зроблено, «Скасувати». */
const action = z.object({
  type: z.literal('action'),
  turnId: id,
  actionId: id,
  tool: z.string(),
  level: z.enum(ACTION_LEVELS),
  summary: z.string(),
  status: z.enum(['running', ...ACTION_STATUSES]),
  undoable: z.boolean(),
});
/** Картка підтвердження (09-ui.md): для 🔴 — точна команда й наслідок. */
const confirmRequest = z.object({
  type: z.literal('confirm.request'),
  requestId: id,
  turnId: id,
  level: z.enum(ACTION_LEVELS),
  tainted: z.boolean(),
  summary: z.string(),
  command: z.string().optional(),
  consequence: z.string().optional(),
  methods: z.array(z.enum(CONFIRM_METHODS)),
  timeoutSec: z.number().min(0),
  armDelaySec: z.number().min(0),
});
const confirmClosed = z.object({
  type: z.literal('confirm.closed'),
  requestId: id,
  outcome: z.enum(['approved', 'denied', 'timeout', 'cancelled']),
});
const turnDone = z.object({
  type: z.literal('turn.done'),
  turnId: id,
  route: z.enum(TURN_ROUTES),
  outcome: z.enum(TURN_OUTCOMES),
  latencyMs: z.number().int().min(0),
  costUsd: z.number().min(0),
});
/** Стан ШІ: позначка на значку трею, в оверлеї й на «Огляді»; until — коли повернеться сам. */
const aiState = z.object({
  type: z.literal('ai.state'),
  state: z.enum(AI_STATES),
  until: z.string().optional(),
});
const settingsChanged = z.object({
  type: z.literal('settings.changed'),
  key: z.string(),
  value: z.unknown(),
});
/** Відкрити розділ центру керування: команда «довідка» без ШІ (09-ui.md, «Довідка»). */
const open = z.object({
  type: z.literal('open'),
  section: z.enum(['help']),
  topic: z.string().max(40).optional(),
});
/** Сповіщення Windows: 80 % ліміту, базовий режим, збій. */
const notice = z.object({
  type: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  text: z.string(),
});

export const coreMessage = z.discriminatedUnion('type', [
  ready,
  reply,
  turnState,
  say,
  action,
  confirmRequest,
  confirmClosed,
  turnDone,
  aiState,
  settingsChanged,
  notice,
  open,
]);
export type CoreMessage = z.output<typeof coreMessage>;

export type Parsed<T> =
  { readonly ok: true; readonly message: T } | { readonly ok: false; readonly error: string };

function parseWith<T>(schema: z.ZodType<T>, data: unknown): Parsed<T> {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, message: result.data };
  const issues = result.error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || 'повідомлення'}: ${issue.message}`,
  );
  return { ok: false, error: issues.join('; ') };
}

/** Повідомлення від desktop, перевірене схемою. */
export function parseDesktopMessage(data: unknown): Parsed<DesktopMessage> {
  return parseWith(desktopMessage, data);
}

/** Повідомлення від core, перевірене схемою. */
export function parseCoreMessage(data: unknown): Parsed<CoreMessage> {
  return parseWith(coreMessage, data);
}
