import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTION_LEVELS,
  ACTION_SOURCES,
  ACTION_STATUSES,
  CONFIRM_METHODS,
  isUlid,
  loadSettings,
  toStored,
  TURN_OUTCOMES,
  TURN_ROUTES,
} from '@banshee/shared';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, schemaVersion, type Db } from './database.ts';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.ts';

const opened: Db[] = [];
const dirs: string[] = [];
async function open(file = ':memory:', migrations = MIGRATIONS) {
  const result = await openDatabase(file, migrations);
  opened.push(result.db);
  return result;
}
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'banshee-db-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = '2026-10-05T10:30:00.000Z';

function seedTurn(db: Db): { episodeId: number; turnId: number } {
  const episodeId = Number(
    db
      .prepare('INSERT INTO episodes (uid, started_at) VALUES (?, ?)')
      .run('01J0000000000000000000000A', NOW).lastInsertRowid,
  );
  const turnId = Number(
    db
      .prepare('INSERT INTO turns (episode_id, utterance, created_at) VALUES (?, ?, ?)')
      .run(episodeId, 'відкрий телеграм', NOW).lastInsertRowid,
  );
  return { episodeId, turnId };
}

describe('схема БД', () => {
  it('нова БД отримує всі таблиці етапу 1 і версію схеми', async () => {
    const { db, from, to, backup, deviceId } = await open();
    expect({ from, to, backup }).toEqual({ from: 0, to: SCHEMA_VERSION, backup: null });
    expect(isUlid(deviceId)).toBe(true);
    const tables = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      'actions',
      'aliases',
      'episodes',
      'llm_calls',
      'meta',
      'routines',
      'settings',
      'turns',
      'usage_daily',
    ]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('обмеження таблиць збігаються з типами @banshee/shared', async () => {
    const { db } = await open();
    const { turnId } = seedTurn(db);
    const setTurn = db.prepare('UPDATE turns SET route = ?, outcome = ? WHERE id = ?');
    for (const route of TURN_ROUTES)
      expect(() => setTurn.run(route, 'success', turnId)).not.toThrow();
    for (const outcome of TURN_OUTCOMES)
      expect(() => setTurn.run('llm', outcome, turnId)).not.toThrow();
    expect(() => setTurn.run('magic', 'success', turnId)).toThrow(/CHECK/);
    expect(() => setTurn.run('llm', 'great', turnId)).toThrow(/CHECK/);

    const insertAction = db.prepare(
      `INSERT INTO actions (turn_id, tool, tier, source, confirmed_by, status, created_at)
       VALUES (?, 'open_app', ?, ?, ?, ?, ?)`,
    );
    for (const tier of ACTION_LEVELS) insertAction.run(turnId, tier, 'voice', 'auto', 'done', NOW);
    for (const source of ACTION_SOURCES)
      insertAction.run(turnId, 'green', source, 'auto', 'done', NOW);
    for (const method of CONFIRM_METHODS)
      insertAction.run(turnId, 'yellow', 'text', method, 'done', NOW);
    for (const status of ACTION_STATUSES)
      insertAction.run(turnId, 'green', 'text', null, status, NOW);
    expect(() => insertAction.run(turnId, 'purple', 'voice', 'auto', 'done', NOW)).toThrow(/CHECK/);
    expect(() => insertAction.run(turnId, 'green', 'email', 'auto', 'done', NOW)).toThrow(/CHECK/);
  });

  it('забута розмова забирає ходи; журнал дій і витрати лишаються', async () => {
    const { db } = await open();
    const { episodeId, turnId } = seedTurn(db);
    db.prepare(
      `INSERT INTO actions (turn_id, tool, tier, source, status, created_at)
       VALUES (?, 'open_app', 'green', 'voice', 'done', ?)`,
    ).run(turnId, NOW);
    db.prepare(
      `INSERT INTO llm_calls (turn_id, purpose, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, 'turn', 'claude-haiku-4-5', 6000, 150, 0.0028, ?)`,
    ).run(turnId, NOW);
    db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeId);
    expect(db.prepare('SELECT count(*) AS n FROM turns').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT turn_id FROM actions').all()).toEqual([{ turn_id: null }]);
    expect(db.prepare('SELECT turn_id, cost_usd FROM llm_calls').all()).toEqual([
      { turn_id: null, cost_usd: 0.0028 },
    ]);
  });

  it('налаштування: рядки зі схеми shared читаються назад', async () => {
    const { db } = await open();
    const insert = db.prepare(
      'INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, ?, ?)',
    );
    for (const row of [toStored('voice.endPauseSec', 0.7), toStored('ai.enabled', false)]) {
      insert.run(row.key, row.valueJson, row.scope, NOW);
    }
    const rows = db
      .prepare<[], { key: string; valueJson: string; scope: 'user' | 'device' }>(
        'SELECT key, value_json AS valueJson, scope FROM settings WHERE deleted = 0',
      )
      .all();
    const { settings, problems } = loadSettings(rows);
    expect(problems).toEqual([]);
    expect(settings['voice.endPauseSec']).toBe(0.7);
    expect(settings['ai.enabled']).toBe(false);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'settings_version'").get()).toEqual({
      value: '1',
    });
  });

  it('назва не повторюється серед живих записів того самого виду', async () => {
    const { db } = await open();
    const insert = db.prepare(
      "INSERT INTO aliases (uid, phrase, target, kind, deleted) VALUES (?, 'телега', 'Telegram', 'app', ?)",
    );
    insert.run('01J0000000000000000000000B', 1);
    insert.run('01J0000000000000000000000C', 0);
    expect(() => insert.run('01J0000000000000000000000D', 0)).toThrow(/UNIQUE/);
  });
});

describe('міграції', () => {
  it('файл БД: повторне відкриття нічого не мігрує, ідентифікатор ПК той самий', async () => {
    const file = join(tempDir(), 'banshee.db');
    const first = await open(file);
    first.db.close();
    const second = await open(file);
    expect({ from: second.from, to: second.to, backup: second.backup }).toEqual({
      from: SCHEMA_VERSION,
      to: SCHEMA_VERSION,
      backup: null,
    });
    expect(second.deviceId).toBe(first.deviceId);
  });

  it('перед міграцією наявної БД — резервна копія зі старою схемою', async () => {
    const dir = tempDir();
    const file = join(dir, 'banshee.db');
    (await open(file)).db.close();
    const next = [
      ...MIGRATIONS,
      { version: SCHEMA_VERSION + 1, name: 'тест', sql: 'ALTER TABLE turns ADD COLUMN test TEXT;' },
    ];
    const migrated = await open(file, next);
    expect(migrated.from).toBe(SCHEMA_VERSION);
    expect(migrated.backup).toBe(join(dir, `banshee.v${String(SCHEMA_VERSION)}.bak.db`));
    expect(existsSync(migrated.backup ?? '')).toBe(true);
    const copy = new Database(migrated.backup ?? '');
    opened.push(copy);
    expect(schemaVersion(copy)).toBe(SCHEMA_VERSION);
  });

  it('БД від новішої версії Banshee не відкривається', async () => {
    const file = join(tempDir(), 'banshee.db');
    const { db } = await open(file);
    db.pragma(`user_version = ${String(SCHEMA_VERSION + 1)}`);
    db.close();
    await expect(openDatabase(file)).rejects.toThrow('новішої версії');
  });

  it('збій міграції не лишає половини схеми', () => {
    const db = new Database(':memory:');
    opened.push(db);
    expect(() =>
      migrate(db, [
        { version: 1, name: 'добра', sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
        {
          version: 2,
          name: 'зламана',
          sql: 'CREATE TABLE b (x INTEGER) STRICT; SELECT * FROM nope;',
        },
      ]),
    ).toThrow(/nope/);
    expect(schemaVersion(db)).toBe(0);
    expect(
      db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table'").get(),
    ).toEqual({
      n: 0,
    });
  });

  it('пропущена версія — помилка', () => {
    const db = new Database(':memory:');
    opened.push(db);
    expect(() => migrate(db, [{ version: 2, name: 'друга', sql: 'SELECT 1;' }])).toThrow(
      'не по порядку',
    );
  });
});
