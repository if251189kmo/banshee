// MCP-сервер mcp/pc (.claude/logic/01-architecture.md, «Процеси»): інструменти ПК для core по stdio.
// Схеми для Claude — у definitions.ts, core бере їх звідти; сервер перевіряє аргументи сам.
// Два службові інструменти — лише для core, Claude їх не бачить: `banshee_assess` — рівень і опис дії
// до виконання (для політики й картки підтвердження), `banshee_undo` — «скасуй» файлової дії.
// Що повернути для «скасуй», сервер кладе в `_meta` результату, а не в текст для Claude.
import { DEFAULT_POWERSHELL_ALLOWLIST } from '@banshee/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findTool } from './definitions.ts';
import type { Shell } from './powershell.ts';
import {
  assessCall,
  pcToolNames,
  runCall,
  undoCall,
  type PcContext,
  type PcSettings,
} from './tools.ts';

export const ASSESS_TOOL = 'banshee_assess';
export const UNDO_TOOL = 'banshee_undo';
export const UNDO_META = 'banshee/undo';

const DEFAULT_SETTINGS: PcSettings = {
  powershellAllowlist: DEFAULT_POWERSHELL_ALLOWLIST,
  massOperationFiles: 20,
};

const text = (value: string, isError = false) => ({
  content: [{ type: 'text' as const, text: value }],
  ...(isError ? { isError: true } : {}),
});

const undoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    moves: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
  z.object({ kind: z.literal('recycle-copies'), paths: z.array(z.string()) }),
  z.object({ kind: z.literal('restore'), paths: z.array(z.string()) }),
]);

export function createPcServer(shell: Shell, version: string): McpServer {
  const server = new McpServer({ name: 'banshee-pc', version });
  const context = (settings: PcSettings = DEFAULT_SETTINGS): PcContext => ({
    shell,
    settings: () => settings,
  });

  for (const name of pcToolNames()) {
    const tool = findTool(name);
    if (!tool) throw new Error(`Немає визначення інструмента ${name}`);
    server.registerTool(
      name,
      {
        description: tool.definition.description,
        // Аргументи перевіряє сам інструмент; тут — будь-який об'єкт.
        inputSchema: z.looseObject({}),
        annotations: {
          readOnlyHint: tool.meta.readOnly,
          destructiveHint: tool.meta.level !== 'green',
        },
        _meta: { 'banshee/level': tool.meta.level, 'banshee/final': tool.meta.final },
      },
      async (args) => {
        const outcome = await runCall(name, args, context());
        return {
          ...text(outcome.content, !outcome.ok),
          ...(outcome.undo ? { _meta: { [UNDO_META]: outcome.undo } } : {}),
        };
      },
    );
  }

  server.registerTool(
    ASSESS_TOOL,
    {
      description:
        'Banshee core only: action level and Ukrainian summary of a PC tool call before it runs.',
      inputSchema: z.object({
        tool: z.string(),
        args: z.unknown(),
        settings: z.object({
          powershellAllowlist: z.array(z.string()),
          massOperationFiles: z.number().int().min(1),
        }),
      }),
    },
    async ({ tool, args, settings }) => {
      try {
        return text(JSON.stringify(await assessCall(tool, args, context(settings))));
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  server.registerTool(
    UNDO_TOOL,
    {
      description: 'Banshee core only: undo a file action from its journal record.',
      inputSchema: z.object({ undo: undoSchema }),
    },
    async ({ undo }) => {
      const outcome = await undoCall(undo, context());
      return text(outcome.content, !outcome.ok);
    },
  );
  return server;
}
