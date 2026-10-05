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
      const undo = (result._meta)?.[UNDO_META];
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

/** Запускає mcp/pc дочірнім процесом Node і з'єднується з ним. */
export async function connectPc(options: {
  readonly node?: string;
  readonly logs?: string;
  readonly transport?: Transport;
}): Promise<Client> {
  const transport =
    options.transport ??
    new StdioClientTransport({
      command: options.node ?? process.execPath,
      args: [
        resolve(import.meta.dirname, '../../../mcp/pc/src/main.ts'),
        ...(options.logs ? ['--logs', options.logs] : []),
      ],
    });
  const client = new Client({ name: 'banshee-core', version: '0.0.0' });
  await client.connect(transport);
  return client;
}
