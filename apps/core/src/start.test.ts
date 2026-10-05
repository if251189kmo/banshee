// Core цілком, як у utilityProcess, але в Node: БД у пам'яті, mcp/pc через InMemoryTransport,
// клієнти — підробні порти. Перевіряє протокол core ↔ desktop від повідомлення до відповіді.
import { createPcServer } from '@banshee/pc';
import type { CoreMessage } from '@banshee/shared';
import type { Log } from '@banshee/shared/log';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { connectPc } from './pc-client.ts';
import { FAILURE_PHRASES } from './phrases.ts';
import { startCore, type StartedCore } from './start.ts';

const silentLog: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };

const silentShell = {
  run: async () =>
    Promise.resolve({ ok: true, output: '{"level":40,"muted":false}', errors: '', ms: 0 }),
  cancel: () => undefined,
  close: () => undefined,
};

async function connectInMemory() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createPcServer(silentShell, '0.0.0').connect(serverSide);
  return connectPc({ transport: clientSide });
}

function fakePort() {
  const messages: CoreMessage[] = [];
  return {
    messages,
    closed: false,
    postMessage(message: CoreMessage) {
      messages.push(message);
    },
    close() {
      this.closed = true;
    },
    of<T extends CoreMessage['type']>(type: T): Extract<CoreMessage, { type: T }>[] {
      return messages.filter((m): m is Extract<CoreMessage, { type: T }> => m.type === type);
    },
  };
}

let core: StartedCore | null = null;

async function start(options: { connect?: () => Promise<never> } = {}) {
  core = await startCore({
    dbFile: ':memory:',
    logsDir: 'unused',
    pc: {},
    log: silentLog,
    readKey: () => Promise.resolve(undefined),
    connect: options.connect ?? connectInMemory,
  });
  return core;
}

afterEach(async () => {
  await core?.close();
  core = null;
});

describe('core: запуск і протокол', () => {
  it('hello → ready зі станом ШІ; без ключа — базовий режим', async () => {
    const { host, pcTools } = await start();
    expect(pcTools).toBe(true);
    const port = fakePort();
    await host.receive(port, { type: 'hello', version: 1, appVersion: '0.0.0' });
    expect(port.of('ready')).toEqual([{ type: 'ready', version: 1, aiState: 'no_key' }]);
  });

  it('команда без ШІ: рутина гучності через mcp/pc, хід до turn.done', async () => {
    const { host } = await start();
    const port = fakePort();
    host.attach(port, 'window');
    await host.receive(port, {
      type: 'command',
      id: 'turn-1',
      text: 'гучність 40',
      source: 'text',
    });
    expect(port.of('action')).toMatchObject([{ tool: 'volume', level: 'green', status: 'done' }]);
    expect(port.of('turn.done')).toMatchObject([
      { turnId: 'turn-1', route: 'routine', outcome: 'success' },
    ]);
  });

  it('налаштування: читання, зміна кліком для всіх клієнтів, стан ШІ', async () => {
    const { host } = await start();
    const window = fakePort();
    const main = fakePort();
    host.attach(window, 'window');
    host.attach(main, 'main');
    await host.receive(window, { type: 'settings.get', id: 's1' });
    const [read] = window.of('reply');
    expect(read).toMatchObject({ id: 's1', ok: true });
    expect((read?.result as Record<string, unknown>)['ai.enabled']).toBe(true);

    await host.receive(window, {
      type: 'settings.set',
      id: 's2',
      key: 'ai.enabled',
      value: false,
      source: 'ui',
    });
    expect(window.of('reply').at(-1)).toEqual({ type: 'reply', id: 's2', ok: true, result: false });
    expect(main.of('settings.changed')).toEqual([
      { type: 'settings.changed', key: 'ai.enabled', value: false },
    ]);
    expect(main.of('ai.state')).toEqual([{ type: 'ai.state', state: 'off' }]);
  });

  it('налаштування: голосом, невідомий ключ і хибне значення — відмова з поясненням', async () => {
    const { host } = await start();
    const port = fakePort();
    const set = (id: string, key: string, value: unknown, source = 'ui') =>
      host.receive(port, { type: 'settings.set', id, key, value, source });
    await set('v', 'ai.enabled', false, 'voice');
    await set('k', 'no.such', 1);
    await set('t', 'ai.enabled', 'так');
    const replies = port.of('reply');
    expect(replies.map((r) => [r.id, r.ok])).toEqual([
      ['v', false],
      ['k', false],
      ['t', false],
    ]);
    expect(replies.every((r) => typeof r.error === 'string' && r.error.length > 0)).toBe(true);
  });

  it('зіпсоване повідомлення не кладе core і лишається без відповіді', async () => {
    const { host } = await start();
    const port = fakePort();
    await host.receive(port, { type: 'command', id: 'x' });
    await host.receive(port, 'не json');
    expect(port.messages).toEqual([]);
    await host.receive(port, { type: 'undo', id: 'u1' });
    expect(port.of('reply')).toEqual([
      { type: 'reply', id: 'u1', ok: true, result: FAILURE_PHRASES.nothingToUndo },
    ]);
  });

  it('відключений клієнт більше нічого не отримує; close закриває порти', async () => {
    const { host } = await start();
    const gone = fakePort();
    const stays = fakePort();
    host.attach(gone, 'old window');
    host.attach(stays, 'main');
    host.detach(gone);
    await host.receive(stays, { type: 'command', id: 't', text: 'гучність 40', source: 'text' });
    expect(gone.messages).toEqual([]);
    expect(stays.of('turn.done')).toHaveLength(1);
    await core?.close();
    core = null;
    expect(stays.closed).toBe(true);
  });

  it('mcp/pc не запустився: core працює, дія ПК — зрозуміла відмова', async () => {
    const { host, pcTools } = await start({
      connect: () => Promise.reject(new Error('немає PowerShell')),
    });
    expect(pcTools).toBe(false);
    const port = fakePort();
    host.attach(port, 'window');
    await host.receive(port, { type: 'command', id: 't', text: 'гучність 40', source: 'text' });
    expect(port.of('say').map((s) => s.text)).toContain(FAILURE_PHRASES.failed);
  });
});
