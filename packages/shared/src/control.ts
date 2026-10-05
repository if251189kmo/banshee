// Службовий канал головного процесу desktop і core в utilityProcess (.claude/logic/01-architecture.md,
// «Процеси»): запуск із шляхами, порти нових вікон, зупинка. Повідомлення протоколу core ↔ desktop
// ідуть окремими портами MessagePort; цей канал — `process.parentPort`.
import { AI_STATES } from './ai.ts';
import { z } from './zod.ts';

const path = z.string().min(1);

/** Перше повідомлення core: шляхи в теці Banshee і порт головного процесу. */
const coreInit = z.object({
  type: z.literal('core.init'),
  appVersion: z.string(),
  dataDir: path,
  logsDir: path,
  dbFile: path,
  /** Зібраний сервер mcp/pc; core запускає його тим самим exe в режимі Node. */
  pcScript: path,
  /** false — перевірка програми: core не читає ключ Claude, тож запитів до API немає. */
  ai: z.boolean(),
});
/** Порт ще одного клієнта: вікна чи головного процесу після перезапуску core. */
const coreAttach = z.object({ type: z.literal('core.attach'), client: z.string().min(1).max(40) });
/** Вихід з програми: core закриває БД і MCP-сервери й завершується сам. */
const coreStop = z.object({ type: z.literal('core.stop') });

export const controlToCore = z.discriminatedUnion('type', [coreInit, coreAttach, coreStop]);
export type ControlToCore = z.output<typeof controlToCore>;
export type CoreInit = z.output<typeof coreInit>;

/** Core готовий: БД відкрита, рушій працює; pcTools — чи запустився mcp/pc. */
const coreStarted = z.object({
  type: z.literal('core.started'),
  ms: z.number().min(0),
  aiState: z.enum(AI_STATES),
  pcTools: z.boolean(),
  /** Процес mcp/pc: після падіння core він має завершитися, а не лишитися сиротою. */
  pcPid: z.number().int().nullable(),
});
/** Core не зміг стартувати: зіпсована БД, БД новішої версії тощо. */
const coreFailed = z.object({ type: z.literal('core.failed'), error: z.string() });

export const controlFromCore = z.discriminatedUnion('type', [coreStarted, coreFailed]);
export type ControlFromCore = z.output<typeof controlFromCore>;

export function parseControlToCore(
  data: unknown,
): { ok: true; message: ControlToCore } | { ok: false; error: string } {
  const result = controlToCore.safeParse(data);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
}

export function parseControlFromCore(
  data: unknown,
): { ok: true; message: ControlFromCore } | { ok: false; error: string } {
  const result = controlFromCore.safeParse(data);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
}
