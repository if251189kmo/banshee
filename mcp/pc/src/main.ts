// Точка входу mcp/pc: core запускає її дочірнім процесом і говорить з нею по stdio.
// `--logs <тека>` — журнал роботи (01-architecture.md, «Діагностика»).
import { parseArgs } from 'node:util';
import { createLog } from '@banshee/shared/log';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createShell } from './powershell.ts';
import { createPcServer } from './server.ts';

const { values } = parseArgs({ options: { logs: { type: 'string' } } });
const log = values.logs ? createLog({ dir: values.logs, source: 'pc' }) : null;
const shell = createShell();
const server = createPcServer(shell, '0.0.0');
const transport = new StdioServerTransport();

let stopped = false;
function stop(reason: string): void {
  if (stopped) return;
  stopped = true;
  shell.close();
  log?.info('pc.stop', { reason });
  process.exit(0);
}

transport.onclose = () => {
  stop('transport');
};
// Core завершився чи впав: Windows не закриває дочірні процеси разом із батьківським, а stdin
// закривається — тоді завершуємось і ми разом із PowerShell, а не лишаємось сиротою.
process.stdin.once('end', () => {
  stop('stdin');
});
process.stdin.once('close', () => {
  stop('stdin');
});
await server.connect(transport);
log?.info('pc.start');
