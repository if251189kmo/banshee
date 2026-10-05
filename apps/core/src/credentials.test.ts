// Справжній Windows Credential Manager, тестовий запис BansheeTest / round-trip із вигаданим
// значенням; ключ Claude не читається. Ловить помилку 2026-10-04: запис через `withTarget`
// новий об'єкт читав як порожній рядок, і збережений ключ «зникав».
import { describe, expect, it } from 'vitest';
import { CLAUDE_KEY_RECORD, secretRecord } from './credentials.ts';

const onWindows = process.platform === 'win32';

describe('сховище ключів', () => {
  it('запис ключа Claude — claude-api-key.Banshee', () => {
    expect(CLAUDE_KEY_RECORD).toBe('claude-api-key.Banshee');
  });

  it.runIf(onWindows)('новий об’єкт читає те, що записав інший', async () => {
    const value = 'dummy-round-trip-value';
    try {
      await secretRecord('BansheeTest', 'round-trip').save(value);
      expect(await secretRecord('BansheeTest', 'round-trip').read()).toBe(value);
    } finally {
      await secretRecord('BansheeTest', 'round-trip').remove();
    }
    expect(await secretRecord('BansheeTest', 'round-trip').read()).toBeUndefined();
    expect(await secretRecord('BansheeTest', 'round-trip').remove()).toBe(false);
  });
});
