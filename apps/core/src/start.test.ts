// Core цілком, як у utilityProcess, але в Node: БД у пам'яті, mcp/pc через InMemoryTransport,
// клієнти — підробні порти. Перевіряє протокол core ↔ desktop від повідомлення до відповіді.
import { createPcServer } from '@banshee/pc';
import {
  PROTOCOL_VERSION,
  type AiDetails,
  type CoreMessage,
  type JournalPage,
  type KeyCheck,
  type StatsResult,
} from '@banshee/shared';
import type { Log } from '@banshee/shared/log';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { connectPc } from './pc-client.ts';
import type { KeyProbe, KeyStore } from './keys.ts';
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

/** Сховище ключа в пам'яті замість Credential Manager. */
function memoryStore(initial?: string): KeyStore & { value: string | undefined } {
  return {
    value: initial,
    read() {
      return Promise.resolve(this.value);
    },
    save(key) {
      this.value = key;
      return Promise.resolve();
    },
    remove() {
      const had = this.value !== undefined;
      this.value = undefined;
      return Promise.resolve(had);
    },
  };
}

async function start(
  options: { connect?: () => Promise<never>; keyStore?: KeyStore; keyProbe?: KeyProbe } = {},
) {
  core = await startCore({
    dbFile: ':memory:',
    logsDir: 'unused',
    pc: {},
    log: silentLog,
    keyStore: options.keyStore ?? memoryStore(),
    ...(options.keyProbe ? { keyProbe: options.keyProbe } : {}),
    connect: options.connect ?? connectInMemory,
  });
  return core;
}

const KEY = `sk-ant-api03-${'x'.repeat(40)}`;

afterEach(async () => {
  await core?.close();
  core = null;
});

describe('core: запуск і протокол', () => {
  it('hello → ready зі станом ШІ; без ключа — базовий режим', async () => {
    const { host, pcTools } = await start();
    expect(pcTools).toBe(true);
    const port = fakePort();
    await host.receive(port, { type: 'hello', version: PROTOCOL_VERSION, appVersion: '0.0.0' });
    expect(port.of('ready')).toEqual([
      { type: 'ready', version: PROTOCOL_VERSION, aiState: 'no_key' },
    ]);
    expect(port.of('notice')).toEqual([]);
  });

  it('інша версія протоколу — сповіщення про зіпсоване встановлення', async () => {
    const { host } = await start();
    const port = fakePort();
    await host.receive(port, { type: 'hello', version: 1, appVersion: '0.0.0' });
    expect(port.of('notice')[0]?.level).toBe('error');
    expect(port.of('ready')).toHaveLength(1);
  });

  it('ключ: формат, перевірка, збереження лише дійсного, «••••», видалення', async () => {
    const store = memoryStore();
    const probed: string[] = [];
    const { host } = await start({
      keyStore: store,
      keyProbe: (key) => {
        probed.push(key);
        return Promise.resolve(
          key.endsWith('bad')
            ? { ok: false, kind: 'auth', message: 'Ключ API недійсний' }
            : { ok: true },
        );
      },
    });
    const port = fakePort();
    host.attach(port, 'window');
    const ask = async (message: Record<string, unknown>) => {
      await host.receive(port, message);
      return port.of('reply').at(-1)?.result;
    };
    expect(await ask({ type: 'key.status', id: 'k0' })).toEqual({ present: false, masked: null });
    const format = (await ask({ type: 'key.set', id: 'k1', key: 'hello' })) as KeyCheck;
    expect(format).toMatchObject({ ok: false, reason: 'format' });
    const bad = (await ask({ type: 'key.set', id: 'k2', key: `${KEY}bad` })) as KeyCheck;
    expect(bad).toMatchObject({ ok: false, reason: 'auth' });
    expect(store.value).toBeUndefined();
    const good = (await ask({ type: 'key.set', id: 'k3', key: `  "${KEY}"\n` })) as KeyCheck;
    expect(good).toEqual({ ok: true, masked: '••••xxxx' });
    expect(store.value).toBe(KEY);
    expect(port.of('ai.state').at(-1)).toEqual({ type: 'ai.state', state: 'active' });
    expect(JSON.stringify(port.messages)).not.toContain(KEY);
    expect(probed).toEqual([`${KEY}bad`, KEY]);

    await ask({ type: 'key.delete', id: 'k4' });
    expect(store.value).toBeUndefined();
    expect(port.of('ai.state').at(-1)).toEqual({ type: 'ai.state', state: 'no_key' });
  });

  it('перевірка збереженого ключа: «ключ не діє» і назад', async () => {
    let valid = false;
    const { host } = await start({
      keyStore: memoryStore(KEY),
      keyProbe: () =>
        Promise.resolve(valid ? { ok: true } : { ok: false, kind: 'auth', message: 'недійсний' }),
    });
    const port = fakePort();
    host.attach(port, 'window');
    await host.receive(port, { type: 'key.check', id: 'c1' });
    expect(port.of('ai.state').at(-1)?.state).toBe('key_invalid');
    valid = true;
    await host.receive(port, { type: 'key.check', id: 'c2' });
    expect(port.of('ai.state').at(-1)?.state).toBe('active');
  });

  it('статистика, журнал і «Стан ШІ» рахуються з тих самих ходів і дій', async () => {
    const { host } = await start();
    const port = fakePort();
    host.attach(port, 'window');
    await host.receive(port, { type: 'command', id: 't1', text: 'гучність 40', source: 'text' });
    await host.receive(port, { type: 'command', id: 't2', text: 'котра година', source: 'text' });
    await host.receive(port, {
      type: 'command',
      id: 't3',
      text: 'розкажи про космос',
      source: 'text',
    });

    await host.receive(port, { type: 'stats.get', id: 's', days: 7 });
    const stats = port.of('reply').at(-1)?.result as StatsResult;
    expect(stats.days).toHaveLength(7);
    expect(stats.totals).toMatchObject({ turns: 3, noAi: 2, ai: 0, refused: 1, costUsd: 0 });
    expect(stats.totals.noAiShare).toBeCloseTo(2 / 3);
    expect(stats.days.at(-1)?.turns).toBe(3);
    expect(stats.previous.turns).toBe(0);

    await host.receive(port, { type: 'journal.list', id: 'j', limit: 1 });
    const page = port.of('reply').at(-1)?.result as JournalPage;
    expect(page.more).toBe(true);
    expect(page.items[0]).toMatchObject({ tool: 'system_info', level: 'green', summary: 'Час' });
    await host.receive(port, {
      type: 'journal.list',
      id: 'j2',
      limit: 10,
      before: page.items[0]?.id,
    });
    const rest = port.of('reply').at(-1)?.result as JournalPage;
    expect(rest.items.map((item) => item.summary)).toEqual(['Гучність 40 %']);

    await host.receive(port, { type: 'ai.details', id: 'a' });
    const details = port.of('reply').at(-1)?.result as AiDetails;
    expect(details).toMatchObject({
      state: 'no_key',
      model: 'claude-haiku-4-5',
      spentTodayUsd: 0,
      limits: { dayUsd: 1, monthUsd: 20 },
      creditsLeftUsd: null,
      lastCallAt: null,
      key: { present: false, masked: null },
    });
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
