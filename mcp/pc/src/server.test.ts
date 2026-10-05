import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_POWERSHELL_ALLOWLIST, PC_TOOL_NAMES } from '@banshee/shared';
import { describe, expect, it } from 'vitest';
import type { Shell } from './powershell.ts';
import { ASSESS_TOOL, createPcServer, UNDO_TOOL } from './server.ts';

const silentShell: Shell = {
  run: async () => Promise.resolve({ ok: true, output: '{}', errors: '', ms: 0 }),
  cancel: () => undefined,
  close: () => undefined,
};

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createPcServer(silentShell, '0.0.0').connect(serverSide);
  const client = new Client({ name: 'core-test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const [first] = result.content as { type: string; text: string }[];
  return first?.text ?? '';
};

describe('MCP-сервер mcp/pc', () => {
  it('11 інструментів ПК і два службові для core', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...PC_TOOL_NAMES, ASSESS_TOOL, UNDO_TOOL]);
    const close = tools.find((tool) => tool.name === 'close_app');
    expect(close?._meta).toEqual({ 'banshee/level': 'yellow', 'banshee/final': false });
    await client.close();
  });

  it('виклик інструмента й оцінка дії до виконання', async () => {
    const client = await connect();
    const time = await client.callTool({ name: 'system_info', arguments: { kind: 'time' } });
    expect(JSON.parse(textOf(time))).toMatchObject({ ok: true });
    const assessed = await client.callTool({
      name: ASSESS_TOOL,
      arguments: {
        tool: 'volume',
        args: { level: 40 },
        settings: { powershellAllowlist: DEFAULT_POWERSHELL_ALLOWLIST, massOperationFiles: 20 },
      },
    });
    expect(JSON.parse(textOf(assessed))).toEqual({ level: 'green', summary: 'Гучність 40 %' });
    const wrong = await client.callTool({ name: 'volume', arguments: { level: 400 } });
    expect(wrong.isError).toBe(true);
    await client.close();
  });
});
