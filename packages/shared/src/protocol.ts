// Протокол core ↔ desktop (.claude/logic/01-architecture.md, «Протокол core ↔ desktop»):
// повідомлення через MessagePort, без мережевих портів. Кожне повідомлення перевіряється схемою
// на вході: зіпсоване чи чуже повідомлення відкидається, а не кладе core чи інтерфейс.
import { AI_STATES } from './ai.ts';
import { ACTION_LEVELS, ACTION_STATUSES, CONFIRM_METHODS } from './levels.ts';
import { TURN_OUTCOMES, TURN_ROUTES, TURN_SOURCES, TURN_STATES } from './turns.ts';
import { z } from './zod.ts';

/** Версія протоколу: core і desktop однієї збірки; різні версії — помилка встановлення. */
export const PROTOCOL_VERSION = 1;

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
/** «Скасуй»: actionId — кнопка на картці дії; без нього — остання дія, яку можна скасувати. */
const undo = z.object({ type: z.literal('undo'), id, actionId: id.optional() });

export const desktopMessage = z.discriminatedUnion('type', [
  hello,
  command,
  stop,
  confirmReply,
  settingsGet,
  settingsSet,
  aiExtraDay,
  newEpisode,
  undo,
]);
export type DesktopMessage = z.output<typeof desktopMessage>;

// core → desktop

const ready = z.object({
  type: z.literal('ready'),
  version: z.number().int(),
  aiState: z.enum(AI_STATES),
});
/** Відповідь на запит з id: settings.get, settings.set, ai.extraDay, undo. */
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
/** Текст відповіді частинами: оверлей показує стрімом, voice озвучує по реченнях. */
const say = z.object({
  type: z.literal('say'),
  turnId: id,
  text: z.string(),
  speak: z.boolean(),
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
