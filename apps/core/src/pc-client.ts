// Інструменти ПК для core через MCP (.claude/logic/01-architecture.md, «Процеси»): mcp/pc — дочірній
// процес core, зв'язок stdio. Оцінка дії бере налаштування власника (список дозволених команд,
// поріг масової операції) з БД у момент виклику.
import { resolve } from 'node:path';
import { ASSESS_TOOL, UNDO_META, UNDO_TOOL } from '@banshee/pc';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Assessment, ToolRunner } from './brain/loop.ts';

export interface PcSettingsSource {
  readonly powershellAllowlist: readonly string[];
  readonly massOperationFiles: number;
}

type CallResult = Awaited<ReturnType<Client['callTool']>>;

const textOf = (result: CallResult): string =>
  (result.content as { type: string; text?: string }[]).find((item) => item.type === 'text')
    ?.text ?? '';

export class PcToolsError extends Error {}

/** ToolRunner поверх уже з'єднаного MCP-клієнта. */
export function mcpToolRunner(client: Client, settings: () => PcSettingsSource): ToolRunner {
  return {
    async assess(name, args) {
      const result = await client.callTool({
        name: ASSESS_TOOL,
        arguments: { tool: name, args, settings: settings() },
      });
      if (result.isError === true) throw new PcToolsError(textOf(result));
      return JSON.parse(textOf(result)) as Assessment;
    },
    async run(name, args) {
      const result = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      const undo = result._meta?.[UNDO_META];
      return {
        ok: result.isError !== true,
        content: textOf(result),
        ...(undo === undefined ? {} : { undo }),
      };
    },
    async undo(record) {
      const result = await client.callTool({ name: UNDO_TOOL, arguments: { undo: record } });
      return { ok: result.isError !== true, content: textOf(result) };
    },
  };
}

export interface PcLaunch {
  /** Виконуваний файл: Node у розробці; у програмі — exe Banshee в режимі Node. */
  readonly command?: string;
  /** Скрипт сервера; типово — вихідний mcp/pc/src/main.ts, типи Node прибирає сам. */
  readonly script?: string;
  /** Додаткові змінні; базові (PATH, SYSTEMROOT…) SDK MCP додає сам, ключів серед них немає. */
  readonly env?: Readonly<Record<string, string>>;
  readonly logs?: string;
  readonly transport?: Transport;
}

/** Запускає mcp/pc дочірнім процесом і з'єднується з ним. */
export async function connectPc(options: PcLaunch): Promise<Client> {
  const transport =
    options.transport ??
    new StdioClientTransport({
      command: options.command ?? process.execPath,
      args: [
        options.script ?? resolve(import.meta.dirname, '../../../mcp/pc/src/main.ts'),
        ...(options.logs ? ['--logs', options.logs] : []),
      ],
      ...(options.env ? { env: { ...options.env } } : {}),
    });
  const client = new Client({ name: 'banshee-core', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/**
 * Інструменти ПК з перезапуском mcp/pc: якщо процес упав, наступний виклик запускає його знову
 * (01-architecture.md, «Процеси»).
 */
export function pcToolRunner(
  connect: () => Promise<Client>,
  settings: () => PcSettingsSource,
  onClosed?: () => void,
): ToolRunner & {
  connected(): Promise<boolean>;
  /** Процес mcp/pc зараз; null — не запущено або не stdio. */
  pid(): number | null;
  close(): Promise<void>;
} {
  let current: Promise<Client> | null = null;
  let latest: Client | null = null;
  let closing = false;
  const client = (): Promise<Client> => {
    current ??= connect().then(
      (connected) => {
        latest = connected;
        connected.onclose = () => {
          current = null;
          latest = null;
          if (!closing) onClosed?.();
        };
        return connected;
      },
      (error: unknown) => {
        current = null;
        throw error;
      },
    );
    return current;
  };
  const runner = async (): Promise<ToolRunner> => mcpToolRunner(await client(), settings);
  return {
    assess: async (name, args) => (await runner()).assess(name, args),
    run: async (name, args) => (await runner()).run(name, args),
    undo: async (record) => (await runner()).undo(record),
    async connected() {
      try {
        await client();
        return true;
      } catch {
        return false;
      }
    },
    pid() {
      const transport = latest?.transport;
      return transport instanceof StdioClientTransport ? transport.pid : null;
    },
    async close() {
      closing = true;
      const connected = await current?.catch(() => null);
      await connected?.close();
    },
  };
}

/** Інструменти ПК недоступні: кожна дія повертає зрозумілу відмову, core працює далі. */
export function unavailablePcTools(reason: string): ToolRunner {
  const refuse = (): Promise<never> => Promise.reject(new PcToolsError(reason));
  return { assess: refuse, run: refuse, undo: refuse };
}
