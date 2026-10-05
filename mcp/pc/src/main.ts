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
transport.onclose = () => {
  shell.close();
  log?.info('pc.stop');
};
await server.connect(transport);
log?.info('pc.start');
