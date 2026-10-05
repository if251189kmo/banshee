// npm run pc:check — перевірка mcp/pc на цьому ПК без змін у системі: справжній сервер по stdio,
// інструменти, що лише читають (диски, мережа, заряд, час), оцінка дій і одна проба Кошика —
// тимчасовий файл видаляється в Кошик і відновлюється звідти.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_POWERSHELL_ALLOWLIST } from '@banshee/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ASSESS_TOOL, UNDO_META, UNDO_TOOL } from './server.ts';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('mcp/pc/src/main.ts')],
});
const client = new Client({ name: 'pc-check', version: '0.0.0' });
await client.connect(transport);
const text = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as { text?: string }[])[0]?.text ?? '';
const call = async (name: string, args: Record<string, unknown>) => {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  console.log(
    `${name} ${JSON.stringify(args)} · ${String(Math.round(performance.now() - started))} мс\n  ${text(result).slice(0, 300)}`,
  );
  return result;
};

const settings = { powershellAllowlist: DEFAULT_POWERSHELL_ALLOWLIST, massOperationFiles: 20 };
await call('system_info', { kind: 'disk' });
await call('system_info', { kind: 'network' });
await call('system_info', { kind: 'battery' });
await call('find_files', { query: '*.pdf', folder: 'Downloads' });
await call(ASSESS_TOOL, {
  tool: 'run_powershell',
  args: { script: 'Get-Process | Sort-Object WS -Descending | Select-Object -First 5' },
  settings,
});
await call(ASSESS_TOOL, {
  tool: 'run_powershell',
  args: { script: 'Remove-Item C:\temp -Recurse' },
  settings,
});
await call(ASSESS_TOOL, { tool: 'open_target', args: { target: 'Downloads' }, settings });

const dir = mkdtempSync(join(tmpdir(), 'banshee-check-'));
const file = join(dir, 'проба Кошика.txt');
writeFileSync(file, 'Banshee');
const recycled = await call('file_op', { op: 'recycle', paths: [file] });
const undo = (recycled._meta)?.[UNDO_META];
await call(UNDO_TOOL, { undo });
console.log(`Відновлено з Кошика: ${readFileSync(file, 'utf8') === 'Banshee' ? 'так' : 'НІ'}`);
await client.close();
