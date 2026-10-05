import { describe, expect, it } from 'vitest';
import { AI_STATE_TEXT, AI_STATES, isBasicMode, recoversItself } from './ai.ts';
import { parseCoreMessage, parseDesktopMessage } from './protocol.ts';

describe('протокол core ↔ desktop', () => {
  it('приймає команду з голосу з перевіркою голосу', () => {
    const parsed = parseDesktopMessage({
      type: 'command',
      id: 't1',
      text: '  відкрий телеграм ',
      source: 'voice',
      voice: { score: 0.61, owner: true },
    });
    expect(parsed).toEqual({
      ok: true,
      message: {
        type: 'command',
        id: 't1',
        text: 'відкрий телеграм',
        source: 'voice',
        voice: { score: 0.61, owner: true },
      },
    });
  });

  it('відкидає порожню команду, невідомий тип і чуже джерело з поясненням', () => {
    const empty = parseDesktopMessage({ type: 'command', id: 't1', text: '   ', source: 'text' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/^text:/);
    expect(parseDesktopMessage({ type: 'shell', script: 'Remove-Item C:\\' }).ok).toBe(false);
    expect(parseDesktopMessage({ type: 'command', id: 't1', text: 'так', source: 'web' }).ok).toBe(
      false,
    );
    expect(parseDesktopMessage('stop').ok).toBe(false);
  });

  it('підтвердження голосом, кліком або клавішею — не auto', () => {
    const base = { type: 'confirm.reply', requestId: 'c1', approved: true };
    expect(parseDesktopMessage({ ...base, method: 'click' }).ok).toBe(true);
    expect(parseDesktopMessage({ ...base, method: 'auto' }).ok).toBe(false);
  });

  it('картка підтвердження 🔴 з точною командою', () => {
    const parsed = parseCoreMessage({
      type: 'confirm.request',
      requestId: 'c1',
      turnId: 't1',
      level: 'red',
      tainted: false,
      summary: 'Очистити Кошик',
      command: 'Clear-RecycleBin -Force',
      consequence: 'не можна скасувати',
      methods: ['click', 'key'],
      timeoutSec: 60,
      armDelaySec: 1,
    });
    expect(parsed.ok).toBe(true);
  });

  it('стан ШІ — лише відомий', () => {
    expect(parseCoreMessage({ type: 'ai.state', state: 'day_limit', until: '00:00' }).ok).toBe(
      true,
    );
    expect(parseCoreMessage({ type: 'ai.state', state: 'broken' }).ok).toBe(false);
  });
});

describe('стан ШІ', () => {
  it('кожен стан базового режиму має підпис, відповідь і як повертається ШІ', () => {
    for (const state of AI_STATES.filter(isBasicMode)) {
      expect(AI_STATE_TEXT[state].label, state).toMatch(/^Базовий режим/);
      expect(AI_STATE_TEXT[state].reply, state).not.toBe('');
      expect(AI_STATE_TEXT[state].recovery, state).not.toBe('');
    }
    expect(isBasicMode('active')).toBe(false);
  });

  it("сам повертається лише після зв'язку й лімітів", () => {
    expect(AI_STATES.filter(recoversItself)).toEqual(['day_limit', 'month_limit', 'offline']);
  });
});
