import { describe, expect, it } from 'vitest';
import { confirmationFor, maxLevel } from './levels.ts';

const quiet = { tainted: false, voiceAllowed: true, voiceSec: 8 };

describe('рівні дій', () => {
  it('вищий рівень перемагає', () => {
    expect(maxLevel('green', 'yellow')).toBe('yellow');
    expect(maxLevel('red', 'yellow')).toBe('red');
    expect(maxLevel('green', 'green')).toBe('green');
  });

  it('🟢 без чужого вмісту виконується без питань', () => {
    expect(confirmationFor('green', quiet)).toEqual({
      required: false,
      methods: ['auto'],
      timeoutSec: 0,
      armDelaySec: 0,
    });
  });

  it('🟢 з чужим вмістом питає, як 🟡', () => {
    expect(confirmationFor('green', { ...quiet, tainted: true })).toEqual(
      confirmationFor('yellow', quiet),
    );
  });

  it('🟡 — голосом за 8 с, кліком або клавішею; без голосу власника — лише руками', () => {
    expect(confirmationFor('yellow', quiet)).toMatchObject({
      required: true,
      methods: ['voice', 'click', 'key'],
      timeoutSec: 8,
    });
    expect(confirmationFor('yellow', { ...quiet, voiceAllowed: false }).methods).toEqual([
      'click',
      'key',
    ]);
  });

  it('🔴 — лише клік або клавіша, 60 с, кнопка активна через 1 с', () => {
    expect(confirmationFor('red', quiet)).toEqual({
      required: true,
      methods: ['click', 'key'],
      timeoutSec: 60,
      armDelaySec: 1,
    });
  });
});
