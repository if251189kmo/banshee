import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/database.ts';
import { readSettings, writeSetting } from './store.ts';

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('налаштування в БД', () => {
  it('перемикач ШІ: значення, журнал дій і попереднє значення для «скасуй»', async () => {
    const { db, deviceId } = await openDatabase(':memory:');
    opened.push(db);
    expect(readSettings(db).settings['ai.enabled']).toBe(true);
    writeSetting(
      db,
      { key: 'ai.enabled', value: false, source: 'voice', confirmedBy: 'auto' },
      deviceId,
      new Date('2026-10-05T10:30:00Z'),
    );
    expect(readSettings(db).settings['ai.enabled']).toBe(false);
    expect(
      db
        .prepare('SELECT tool, args_json, tier, source, confirmed_by, undo_json FROM actions')
        .get(),
    ).toEqual({
      tool: 'settings.set',
      args_json: '{"key":"ai.enabled","value":false}',
      tier: 'green',
      source: 'voice',
      confirmed_by: 'auto',
      undo_json: '{"key":"ai.enabled","value":true}',
    });
  });

  it('значення поза межами не записується', async () => {
    const { db, deviceId } = await openDatabase(':memory:');
    opened.push(db);
    expect(() =>
      writeSetting(
        db,
        { key: 'voice.endPauseSec', value: 9, source: 'ui', confirmedBy: 'click' },
        deviceId,
      ),
    ).toThrow('Пауза кінця фрази');
    expect(db.prepare('SELECT count(*) AS n FROM actions').get()).toEqual({ n: 0 });
  });
});
