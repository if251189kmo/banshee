import type Anthropic from '@anthropic-ai/sdk';
import { AuthenticationError } from '@anthropic-ai/sdk';
import type { CoreMessage } from '@banshee/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { Assessment, ToolRunner } from './brain/loop.ts';
import {
  Cancelled,
  type ModelClient,
  type ModelReply,
  type TurnRequest,
} from './brain/model-client.ts';
import { openDatabase, type Db } from './db/database.ts';
import { Engine } from './engine.ts';
import { writeSetting } from './settings/store.ts';

const USAGE = {
  input_tokens: 200,
  output_tokens: 40,
  cache_read_input_tokens: 6000,
  cache_creation_input_tokens: 0,
} as Anthropic.Usage;

const text = (value: string): Anthropic.ContentBlock => ({
  type: 'text',
  text: value,
  citations: null,
});
const use = (id: string, name: string, input: unknown): Anthropic.ContentBlock =>
  ({ type: 'tool_use', id, name, input }) as Anthropic.ContentBlock;

function reply(
  content: Anthropic.ContentBlock[],
  stopReason = 'end_turn',
  model = 'claude-haiku-4-5',
): ModelReply {
  return { content, stopReason, usage: USAGE, model, ttftMs: 300, totalMs: 600 };
}

interface FakeClient extends ModelClient {
  readonly requests: TurnRequest[];
  readonly escalations: string[];
}

/** Відповіді по черзі; функція — щоб змоделювати помилку чи очікування. */
function fakeClient(
  script: (ModelReply | ((signal: AbortSignal) => Promise<ModelReply>))[],
  escalation?: ModelReply,
): FakeClient {
  const requests: TurnRequest[] = [];
  const escalations: string[] = [];
  return {
    requests,
    escalations,
    async turn(request, options) {
      requests.push({ ...request, messages: structuredClone([...request.messages]) });
      const next = script.shift();
      if (!next) throw new Error('немає відповіді в сценарії');
      const result = typeof next === 'function' ? await next(options.signal) : next;
      for (const block of result.content) if (block.type === 'text') options.onText?.(block.text);
      return result;
    },
    async escalate(request) {
      escalations.push(request.task);
      return Promise.resolve(
        escalation ?? reply([text('План: …')], 'end_turn', 'claude-sonnet-5-5'),
      );
    },
  };
}

const LEVELS: Record<string, Assessment['level']> = {
  open_app: 'green',
  volume: 'green',
  find_files: 'green',
  system_info: 'green',
  close_app: 'yellow',
  file_op: 'yellow',
  run_powershell: 'red',
};

function fakeTools(): ToolRunner & { runs: { name: string; args: unknown }[]; undos: unknown[] } {
  const runs: { name: string; args: unknown }[] = [];
  const undos: unknown[] = [];
  return {
    runs,
    undos,
    assess: async (name) =>
      Promise.resolve({ level: LEVELS[name] ?? 'red', summary: `дія ${name}` }),
    run: async (name, args) => {
      runs.push({ name, args });
      if (name === 'volume')
        return Promise.resolve({ ok: true, content: '{"ok":true,"level":30,"muted":false}' });
      if (name === 'file_op') {
        return Promise.resolve({
          ok: true,
          content: '{"ok":true}',
          undo: { kind: 'restore', paths: ['C:\\x.txt'] },
        });
      }
      if (name === 'system_info') {
        return Promise.resolve({
          ok: true,
          content: '{"ok":true,"disk":[{"drive":"C:","freeGb":8.1,"sizeGb":111.2}]}',
        });
      }
      return Promise.resolve({ ok: true, content: '{"ok":true}' });
    },
    undo: async (record) => {
      undos.push(record);
      return Promise.resolve({ ok: true, content: '{"ok":true}' });
    },
  };
}

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

async function setup(
  options: { client?: FakeClient | null; approve?: (message: CoreMessage) => void } = {},
) {
  const { db, deviceId } = await openDatabase(':memory:');
  opened.push(db);
  const events: CoreMessage[] = [];
  const tools = fakeTools();
  const client = options.client === undefined ? fakeClient([]) : options.client;
  let engine: Engine | null = null;
  engine = new Engine({
    db,
    deviceId,
    client: () => client,
    tools,
    now: () => new Date(2026, 9, 5, 10, 30),
    emit: (message) => {
      events.push(message);
      if (message.type === 'confirm.request' && engine) options.approve?.(message);
    },
  });
  const said = () => events.flatMap((event) => (event.type === 'say' ? [event.text] : []));
  const done = () => events.filter((event) => event.type === 'turn.done');
  return { db, engine, events, tools, client, said, done };
}

const turnRows = (db: Db) =>
  db.prepare('SELECT route, outcome, routine_id IS NOT NULL AS routine FROM turns').all();

describe('рушій ходів: без ШІ', () => {
  it('рутина виконується локально: дія, фраза, журнал, жодного виклику Claude', async () => {
    const { db, engine, tools, client, said, events } = await setup();
    await engine.command({ id: 't1', text: 'зроби гучність на тридцять', source: 'voice' });
    expect(tools.runs).toEqual([{ name: 'volume', args: { level: 30 } }]);
    expect(said()).toEqual(['Гучність 30 відсотків.']);
    // Голос читає число словами (02-voice.md, «Текст для озвучки»).
    expect(events.find((event) => event.type === 'say')).toMatchObject({
      speak: true,
      speech: 'Гучність тридцять відсотків.',
    });
    expect(turnRows(db)).toEqual([{ route: 'routine', outcome: 'success', routine: 1 }]);
    expect(db.prepare('SELECT tool, source, confirmed_by, status FROM actions').all()).toEqual([
      { tool: 'volume', source: 'routine', confirmed_by: 'auto', status: 'done' },
    ]);
    expect(client?.requests).toEqual([]);
  });

  it('базовий режим: команда без рутини — відповідь з причиною, 0 запитів', async () => {
    const { db, engine, client, said } = await setup();
    writeSetting(db, { key: 'ai.enabled', value: false, source: 'ui', confirmedBy: 'click' }, 'pc');
    await engine.command({ id: 't1', text: 'знайди моє резюме', source: 'text' });
    expect(said()).toEqual(['Без ШІ це не вмію. Увімкнути?']);
    expect(turnRows(db)).toEqual([{ route: 'none', outcome: 'no_ai', routine: 0 }]);
    expect(client?.requests).toEqual([]);
  });

  it('вбудована рутина з 🟡 кроком питає щоразу; «ні» — нічого не зроблено', async () => {
    const { engine, tools, events, said } = await setup({
      approve: (message) => {
        if (message.type === 'confirm.request')
          queueMicrotask(() => {
            engineRef.confirmReply(message.requestId, false, 'click');
          });
      },
    });
    const engineRef = engine;
    await engine.command({ id: 't1', text: 'закрий хром', source: 'text' });
    expect(
      events.some((event) => event.type === 'confirm.request' && event.level === 'yellow'),
    ).toBe(true);
    expect(tools.runs).toEqual([]);
    expect(said()).toEqual(['Добре, не роблю.']);
  });

  it('чужий голос: нічого не виконується, хід не пишеться, лічильник росте', async () => {
    const { db, engine, said, tools } = await setup();
    await engine.command({
      id: 't1',
      text: 'гучність 30',
      source: 'voice',
      voice: { score: 0.1, owner: false },
    });
    expect(said()).toEqual(['Голос не впізнано']);
    expect(tools.runs).toEqual([]);
    expect(turnRows(db)).toEqual([]);
    expect(db.prepare('SELECT voice_rejected FROM usage_daily').get()).toEqual({
      voice_rejected: 1,
    });
  });

  it('ШІ голосом: вимкнути — одразу, увімкнути — з підтвердженням', async () => {
    let engineRef: Engine | null = null;
    const { db, engine, events } = await setup({
      approve: (message) => {
        if (message.type === 'confirm.request') {
          queueMicrotask(() => engineRef?.confirmReply(message.requestId, true, 'voice'));
        }
      },
    });
    engineRef = engine;
    await engine.command({ id: 't1', text: 'базовий режим', source: 'voice' });
    expect(engine.status().state).toBe('off');
    expect(events.filter((event) => event.type === 'confirm.request')).toHaveLength(0);
    await engine.command({ id: 't2', text: 'увімкни ші', source: 'voice' });
    expect(events.filter((event) => event.type === 'confirm.request')).toHaveLength(1);
    expect(engine.status().state).toBe('active');
    expect(
      db.prepare("SELECT count(*) AS n FROM actions WHERE tool = 'settings.set'").get(),
    ).toEqual({ n: 2 });
  });
});

describe('рушій ходів: Haiku', () => {
  it('проста дія завершує хід одним викликом; її результат іде першим у наступному запиті', async () => {
    const client = fakeClient([
      reply([text('Шукаю резюме.'), use('u1', 'open_app', { app: 'Telegram' })], 'tool_use'),
      reply([text('Готово, файл знайдено.')]),
    ]);
    const { db, engine, said, tools } = await setup({ client });
    await engine.command({
      id: 't1',
      text: 'відкрий телеграм на весь екран з новим чатом',
      source: 'voice',
    });
    expect(client.requests).toHaveLength(1);
    expect(tools.runs).toEqual([{ name: 'open_app', args: { app: 'Telegram' } }]);
    expect(said()).toEqual(['Шукаю резюме.', 'Готово.']);
    expect(turnRows(db)).toEqual([{ route: 'llm', outcome: 'success', routine: 0 }]);
    const call = db
      .prepare('SELECT model, input_tokens, cache_read_tokens, cost_usd > 0 AS paid FROM llm_calls')
      .get();
    expect(call).toEqual({
      model: 'claude-haiku-4-5',
      input_tokens: 200,
      cache_read_tokens: 6000,
      paid: 1,
    });

    await engine.command({ id: 't2', text: 'а тепер знайди моє резюме', source: 'text' });
    const last = client.requests[1]?.messages.at(-1);
    const content = last?.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'u1' });
    expect(content[1]).toMatchObject({ type: 'text' });
  });

  it('стан ПК після простої дії озвучує core, а не «Готово»', async () => {
    const client = fakeClient([
      reply([text('Перевіряю диски.'), use('u1', 'system_info', { kind: 'disk' })], 'tool_use'),
    ]);
    const { engine, said } = await setup({ client });
    await engine.command({ id: 't1', text: 'скільки вільного місця на дисках', source: 'voice' });
    expect(said()).toEqual(['Перевіряю диски.', 'Вільно: C — 8,1 гігабайт.']);
  });

  it('🟡 дія з підтвердженням кліком; 🔴 голосом не підтверджується', async () => {
    let engineRef: Engine | null = null;
    const client = fakeClient([
      reply(
        [text('Видаляю в Кошик.'), use('u1', 'file_op', { op: 'recycle', paths: ['C:\\x.txt'] })],
        'tool_use',
      ),
      reply(
        [text('Запускаю скрипт.'), use('u2', 'run_powershell', { script: 'Remove-Item C:\\y' })],
        'tool_use',
      ),
      reply([text('Скрипт не виконано: ти не підтвердив.')]),
    ]);
    const { db, engine, tools } = await setup({
      client,
      approve: (message) => {
        if (message.type !== 'confirm.request') return;
        queueMicrotask(() =>
          engineRef?.confirmReply(
            message.requestId,
            true,
            message.level === 'red' ? 'voice' : 'click',
          ),
        );
      },
    });
    engineRef = engine;
    await engine.command({ id: 't1', text: 'видали x і запусти скрипт', source: 'voice' });
    expect(tools.runs.map((run) => run.name)).toEqual(['file_op']);
    expect(
      db.prepare('SELECT tool, tier, confirmed_by, status FROM actions ORDER BY id').all(),
    ).toEqual([
      { tool: 'file_op', tier: 'yellow', confirmed_by: 'click', status: 'done' },
      { tool: 'run_powershell', tier: 'red', confirmed_by: 'voice', status: 'denied' },
    ]);
  });

  it('«скасуй» повертає останню дію один раз', async () => {
    let engineRef: Engine | null = null;
    const client = fakeClient([
      reply([use('u1', 'file_op', { op: 'recycle', paths: ['C:\\x.txt'] })], 'tool_use'),
      reply([text('Готово.')]),
    ]);
    const { engine, tools, said } = await setup({
      client,
      approve: (message) => {
        if (message.type === 'confirm.request')
          queueMicrotask(() => engineRef?.confirmReply(message.requestId, true, 'key'));
      },
    });
    engineRef = engine;
    await engine.command({ id: 't1', text: 'видали x', source: 'text' });
    await engine.command({ id: 't2', text: 'скасуй', source: 'text' });
    await engine.command({ id: 't3', text: 'скасуй', source: 'text' });
    expect(tools.undos).toEqual([{ kind: 'restore', paths: ['C:\\x.txt'] }]);
    expect(said().slice(-2)).toEqual(['Скасовано.', 'Немає чого скасувати.']);
  });

  it('ескалація: Sonnet окремим субагентом, Haiku переказує', async () => {
    const client = fakeClient([
      reply(
        [
          text('Зараз обміркую.'),
          use('u1', 'escalate', { task: 'Plan a backup', reason: 'owner_request' }),
        ],
        'tool_use',
      ),
      reply([text('Раджу копіювати фото щотижня на два диски.')]),
    ]);
    const { db, engine, done } = await setup({ client });
    await engine.command({ id: 't1', text: 'подумай краще, як зберегти фото', source: 'voice' });
    expect(client.escalations).toEqual(['Plan a backup']);
    expect(done()).toMatchObject([{ route: 'escalation', outcome: 'success' }]);
    expect(db.prepare('SELECT model FROM llm_calls ORDER BY id').all()).toEqual([
      { model: 'claude-haiku-4-5' },
      { model: 'claude-sonnet-5-5' },
      { model: 'claude-haiku-4-5' },
    ]);
  });

  it('виклик, написаний текстом, не озвучується; хід — збій, розмова як до нього', async () => {
    const client = fakeClient([reply([text('Попередня пісня. media {"action": "previous"}')])]);
    const { engine, said, done } = await setup({ client });
    await engine.command({
      id: 't1',
      text: 'перемкни на попередню пісню будь ласка якщо можна',
      source: 'voice',
    });
    expect(said()).toEqual(['Не вийшло. Скажи інакше.']);
    expect(done()).toMatchObject([{ outcome: 'failed' }]);
  });
});

describe('рушій ходів: збої й ліміти', () => {
  it('недійсний ключ → базовий режим з причиною; далі запитів немає', async () => {
    const client = fakeClient([
      async () =>
        Promise.reject(
          new AuthenticationError(
            401,
            {
              type: 'error',
              error: { type: 'authentication_error', message: 'invalid x-api-key' },
            },
            undefined,
            new Headers(),
          ),
        ),
    ]);
    const { engine, said, events } = await setup({ client });
    await engine.command({ id: 't1', text: 'знайди моє резюме', source: 'text' });
    expect(engine.status().state).toBe('key_invalid');
    expect(said()).toEqual(['Ключ API не діє — потрібен новий.']);
    expect(events.some((event) => event.type === 'ai.state' && event.state === 'key_invalid')).toBe(
      true,
    );
    await engine.command({ id: 't2', text: 'знайди моє резюме', source: 'text' });
    expect(client.requests).toHaveLength(1);
  });

  it('денний ліміт: базовий режим; «ще $1» повертає ШІ', async () => {
    const { db, engine } = await setup();
    db.prepare(
      `INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES ('turn', 'claude-haiku-4-5', 1, 1, 1.0, ?)`,
    ).run(new Date(2026, 9, 5, 9, 0).toISOString());
    expect(engine.status()).toEqual({ state: 'day_limit', until: '2026-10-06T00:00' });
    engine.allowExtraToday();
    expect(engine.status().state).toBe('active');
  });

  it('80 % денного ліміту — одне сповіщення за день, а не на кожен хід', async () => {
    const client = fakeClient([reply([text('Перше.')]), reply([text('Друге.')])]);
    const { db, engine, events } = await setup({ client });
    db.prepare(
      `INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES ('turn', 'claude-haiku-4-5', 1, 1, 0.85, ?)`,
    ).run(new Date(2026, 9, 5, 9, 0).toISOString());
    await engine.command({ id: 'a', text: 'розкажи щось', source: 'text' });
    await engine.command({ id: 'b', text: 'ще щось', source: 'text' });
    const notices = events.filter((event) => event.type === 'notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ level: 'warn' });
    expect(JSON.stringify(notices[0])).toContain('денного ліміту $1,00');
  });

  it('«стоп» скасовує запит до моделі; розмова лишається як до ходу', async () => {
    const client = fakeClient([
      async (signal) =>
        new Promise<ModelReply>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Cancelled());
          });
        }),
    ]);
    const { engine, done } = await setup({ client });
    const turn = engine.command({ id: 't1', text: 'знайди моє резюме', source: 'text' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await engine.command({ id: 't2', text: 'стоп', source: 'voice' });
    await turn;
    expect(done()).toMatchObject([
      { turnId: 't1', outcome: 'cancelled' },
      // Сама команда «стоп» теж завершена — оверлей не чекає на неї.
      { turnId: 't2', route: 'none', outcome: 'success', costUsd: 0 },
    ]);
  });

  it('«довідка» — без ШІ: відкрити довідку й відповісти; хід не пишеться в turns', async () => {
    const { db, engine, events, said, done } = await setup({ client: null });
    await engine.command({ id: 'h', text: 'довідка', source: 'text' });
    expect(events).toContainEqual({ type: 'open', section: 'help' });
    expect(said()).toEqual(['Відкриваю довідку.']);
    expect(done()).toMatchObject([{ turnId: 'h', route: 'none', outcome: 'success' }]);
    expect(turnRows(db)).toEqual([]);
  });
});
