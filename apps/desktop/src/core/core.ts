// Core в utilityProcess (.claude/logic/01-architecture.md, «Процеси»): чекає `core.init` від головного
// процесу, запускає core і підключає порти клієнтів — головного процесу й вікон. mcp/pc запускається
// тим самим exe в режимі Node: окремого Node на ПК користувача немає.
import { startCore, type StartedCore } from '@banshee/core';
import { parseControlToCore, type ControlFromCore, type CoreInit } from '@banshee/shared';
import type { MessagePortMain } from 'electron';

const startedAt = performance.now();
const NO_KEY = {
  read: () => Promise.resolve(undefined),
  save: () => Promise.reject(new Error('Перевірка програми не зберігає ключ')),
  remove: () => Promise.resolve(false),
};
let core: StartedCore | null = null;
const waiting: { port: MessagePortMain; client: string }[] = [];

const post = (message: ControlFromCore): void => {
  process.parentPort.postMessage(message);
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function attach(started: StartedCore, port: MessagePortMain, client: string): void {
  const hostPort = {
    postMessage: (message: unknown) => {
      port.postMessage(message);
    },
    close: () => {
      port.close();
    },
  };
  const receive = started.host.attach(hostPort, client);
  port.on('message', (event) => {
    receive(event.data);
  });
  port.on('close', () => {
    started.host.detach(hostPort);
  });
  port.start();
}

async function init(message: CoreInit, port: MessagePortMain | undefined): Promise<void> {
  try {
    core = await startCore({
      dbFile: message.dbFile,
      logsDir: message.logsDir,
      pc: {
        command: process.execPath,
        script: message.pcScript,
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
      // Перевірка програми не читає ключ Claude: запитів до API немає.
      ...(message.ai ? {} : { keyStore: NO_KEY }),
    });
  } catch (error) {
    post({ type: 'core.failed', error: errorText(error) });
    process.exit(1);
  }
  if (port) attach(core, port, 'main');
  for (const item of waiting.splice(0)) attach(core, item.port, item.client);
  core.log.info('core.start', { ms: Math.round(performance.now() - startedAt), pc: core.pcTools });
  post({
    type: 'core.started',
    ms: Math.round(performance.now() - startedAt),
    aiState: core.engine.status().state,
    pcTools: core.pcTools,
    pcPid: core.pcPid,
  });
}

async function stop(): Promise<void> {
  try {
    await core?.close();
  } finally {
    process.exit(0);
  }
}

process.on('uncaughtException', (error) => {
  core?.log.error('core.crash', { error: errorText(error) });
  process.exit(1);
});

process.parentPort.on('message', (event) => {
  const parsed = parseControlToCore(event.data);
  if (!parsed.ok) return;
  const [port] = event.ports;
  switch (parsed.message.type) {
    case 'core.init':
      void init(parsed.message, port);
      return;
    case 'core.attach':
      if (!port) return;
      if (core) attach(core, port, parsed.message.client);
      else waiting.push({ port, client: parsed.message.client });
      return;
    case 'core.stop':
      void stop();
      return;
  }
});
