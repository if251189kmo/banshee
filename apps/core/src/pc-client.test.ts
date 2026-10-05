import { createPcServer } from '@banshee/pc';
import { DEFAULT_POWERSHELL_ALLOWLIST } from '@banshee/shared';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { connectPc, mcpToolRunner } from './pc-client.ts';

const silentShell = {
  run: async () =>
    Promise.resolve({ ok: true, output: '{"level":40,"muted":false}', errors: '', ms: 0 }),
  cancel: () => undefined,
  close: () => undefined,
};

describe('інструменти ПК через MCP', () => {
  it('оцінка з налаштуваннями власника, виконання й помилки аргументів', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createPcServer(silentShell, '0.0.0').connect(serverSide);
    const client = await connectPc({ transport: clientSide });
    const runner = mcpToolRunner(client, () => ({
      powershellAllowlist: DEFAULT_POWERSHELL_ALLOWLIST,
      massOperationFiles: 20,
    }));
    expect(await runner.assess('volume', { level: 40 })).toEqual({
      level: 'green',
      summary: 'Гучність 40 %',
    });
    expect(await runner.run('volume', { level: 40 })).toEqual({
      ok: true,
      content: '{"ok":true,"level":40,"muted":false}',
    });
    await expect(runner.assess('volume', { level: 400 })).rejects.toThrow();
    expect((await runner.run('volume', { level: 400 })).ok).toBe(false);
    await client.close();
  });
});
