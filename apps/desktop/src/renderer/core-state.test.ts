import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, reduceCore, type CoreEvent, type CoreState } from './core-state.ts';

const run = (events: CoreEvent[], state: CoreState = INITIAL_STATE): CoreState =>
  events.reduce(reduceCore, state);

describe('стан сторінки з повідомлень core', () => {
  it('з’єднання: ready після hello; новий порт після перезапуску core — знову connecting', () => {
    const ready = run([
      { type: 'message', message: { type: 'ready', version: 1, aiState: 'no_key' } },
    ]);
    expect(ready).toMatchObject({ connection: 'ready', readyCount: 1, aiState: 'no_key' });
    const reconnecting = run([{ type: 'connect' }], ready);
    expect(reconnecting).toMatchObject({ connection: 'connecting', readyCount: 1 });
  });

  it('хід: команда, відповідь частинами, дія й завершення', () => {
    const state = run([
      { type: 'sent', id: 't1', text: 'гучність 40' },
      {
        type: 'message',
        message: {
          type: 'action',
          turnId: 't1',
          actionId: '7',
          tool: 'volume',
          level: 'green',
          summary: 'Гучність 40 %',
          status: 'done',
          undoable: false,
        },
      },
      {
        type: 'message',
        message: { type: 'say', turnId: 't1', text: 'Гучність ', speak: true, done: false },
      },
      {
        type: 'message',
        message: { type: 'say', turnId: 't1', text: '40.', speak: true, done: true },
      },
      {
        type: 'message',
        message: {
          type: 'turn.done',
          turnId: 't1',
          route: 'routine',
          outcome: 'success',
          latencyMs: 40,
          costUsd: 0,
        },
      },
    ]);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({ text: 'гучність 40', say: 'Гучність 40.' });
    expect(state.turns[0]?.actions.map((a) => a.summary)).toEqual(['Гучність 40 %']);
    expect(state.turns[0]?.done?.route).toBe('routine');
  });

  it('хід з іншого клієнта — без тексту команди; підтвердження відкривається й закривається', () => {
    const state = run([
      {
        type: 'message',
        message: { type: 'say', turnId: 'x', text: 'Готово.', speak: true, done: true },
      },
      {
        type: 'message',
        message: {
          type: 'confirm.request',
          requestId: 'r1',
          turnId: 'x',
          level: 'yellow',
          tainted: false,
          summary: 'Закрити Телеграм',
          methods: ['voice', 'click', 'key'],
          timeoutSec: 8,
          armDelaySec: 0,
        },
      },
    ]);
    expect(state.turns[0]?.text).toBeNull();
    expect(state.confirmations.map((c) => c.requestId)).toEqual(['r1']);
    const closed = run(
      [
        {
          type: 'message',
          message: { type: 'confirm.closed', requestId: 'r1', outcome: 'denied' },
        },
      ],
      state,
    );
    expect(closed.confirmations).toEqual([]);
  });
});
