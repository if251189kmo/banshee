import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, TurnRequest } from '@banshee/core/brain/model-client';
import { describe, expect, it } from 'vitest';
import { runCase, type ModelReply } from './run-case.ts';
import { stubResult } from './stubs.ts';

const text = (value: string): Anthropic.ContentBlock => ({
  type: 'text',
  text: value,
  citations: null,
});
const use = (
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): Anthropic.ContentBlock => ({ type: 'tool_use', id, name, input }) as Anthropic.ContentBlock;

function reply(content: Anthropic.ContentBlock[], stopReason = 'end_turn'): ModelReply {
  return {
    content,
    stopReason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : stopReason,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } as Anthropic.Usage,
    model: 'claude-haiku-4-5',
    ttftMs: 100,
    totalMs: 300,
  };
}

/** Модель-сценарій: віддає відповіді по черзі й запам'ятовує, що отримала. */
function scripted(replies: ModelReply[]): { client: ModelClient; seen: TurnRequest['messages'][] } {
  const seen: TurnRequest['messages'][] = [];
  let next = 0;
  const client: ModelClient = {
    turn: async (request) => {
      seen.push(structuredClone([...request.messages]));
      const result = replies[Math.min(next, replies.length - 1)];
      next += 1;
      return result ? Promise.resolve(result) : Promise.reject(new Error('немає відповіді'));
    },
    escalate: async () => Promise.reject(new Error('ескалація не очікувалась')),
  };
  return { client, seen };
}

const OPTIONS = { profile: '# Owner profile' };

describe('runCase — цикл core на заглушках', () => {
  it('проста дія завершує хід без другого виклику моделі', async () => {
    const model = scripted([
      reply([text('Відкриваю Telegram.'), use('t1', 'open_app', { app: 'Telegram' })]),
    ]);
    const run = await runCase(model.client, 'відкрий телеграм', {}, OPTIONS);
    expect(run.stop).toBe('final_tools');
    expect(run.calls).toEqual([{ name: 'open_app', input: { app: 'Telegram' } }]);
    expect(run.prefaceBeforeAction).toBe(true);
    expect(run.finalText).toBe('Відкриваю Telegram.');
    expect(model.seen).toHaveLength(1);
  });

  it('результат кроку повертається в модель, доки вона не відповість текстом', async () => {
    const found = { files: [{ path: 'C:\\a.pdf' }] };
    const model = scripted([
      reply([use('t1', 'find_files', { query: '*.pdf' })]),
      reply([text('Видаляю.'), use('t2', 'file_op', { op: 'recycle', paths: ['C:\\a.pdf'] })]),
      reply([text('Готово.')]),
    ]);
    const run = await runCase(model.client, 'видали pdf', { find_files: found }, OPTIONS);
    expect(run.stop).toBe('end_turn');
    expect(run.calls.map((item) => item.name)).toEqual(['find_files', 'file_op']);
    expect(run.prefaceBeforeAction).toBe(false);
    expect(run.finalText).toBe('Готово.');
    expect(model.seen).toHaveLength(3);
    expect(model.seen[1]?.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(found) }],
    });
  });

  it('відмова й обрізана відповідь зупиняють хід', async () => {
    const refusal = await runCase(scripted([reply([], 'refusal')]).client, 'x', {}, OPTIONS);
    expect(refusal.stop).toBe('refusal');
    const cut = await runCase(
      scripted([reply([text('Відкри')], 'max_tokens')]).client,
      'x',
      {},
      OPTIONS,
    );
    expect(cut.stop).toBe('max_tokens');
  });

  it('невідомий інструмент — помилка в tool_result, хід триває', async () => {
    const model = scripted([reply([use('t1', 'format_disk')]), reply([text('Такого не вмію.')])]);
    const run = await runCase(model.client, 'x', {}, OPTIONS);
    expect(run.stop).toBe('end_turn');
    expect(JSON.stringify(model.seen[1]?.at(-1))).toContain('"is_error":true');
  });

  it('модель, що кличе інструменти без кінця, зупиняється лімітом кроків', async () => {
    const model = scripted([reply([use('t1', 'find_files', { query: '*' })])]);
    const run = await runCase(model.client, 'x', {}, { ...OPTIONS, maxSteps: 3 });
    expect(run.stop).toBe('max_steps');
    expect(run.calls).toHaveLength(3);
  });

  it('кілька ходів — одна розмова; результат простої дії йде на початку наступного запиту', async () => {
    const model = scripted([
      reply([text('Відкриваю.'), use('t1', 'open_app', { app: 'Telegram' })]),
      reply([text('Готово.')]),
    ]);
    const run = await runCase(model.client, ['відкрий телеграм', 'дякую'], {}, OPTIONS);
    expect(run.calls).toHaveLength(1);
    const content = model.seen[1]?.at(-1)?.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
  });
});

describe('stubResult', () => {
  it('відповідь з набору має перевагу над типовою', () => {
    expect(stubResult('find_files', { query: '*' }, {})).toEqual({
      content: '{"files":[]}',
      isError: false,
    });
    expect(stubResult('find_files', {}, { find_files: { files: ['x'] } }).content).toBe(
      '{"files":["x"]}',
    );
  });

  it('системна інформація — ПК власника без батареї; file_op рахує файли', () => {
    expect(stubResult('system_info', { kind: 'battery' }, {}).content).toContain('"present":false');
    expect(stubResult('file_op', { op: 'recycle', paths: ['a', 'b'] }, {}).content).toBe(
      '{"ok":true,"count":2}',
    );
  });
});
