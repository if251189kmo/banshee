// БД core (.claude/logic/04-memory.md): SQLite через better-sqlite3, WAL, зовнішні ключі, міграції
// в одній транзакції. Перед міграцією наявної БД — резервна копія поруч. БД від новішої версії
// Banshee не відкривається: старіша програма могла б її зіпсувати.
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { ulid } from '@banshee/shared';
import Database from 'better-sqlite3';
import { MIGRATIONS, type Migration } from './schema.ts';

export type Db = Database.Database;

export function schemaVersion(db: Db): number {
  return Number(db.pragma('user_version', { simple: true }));
}

/** Застосовує міграції, новіші за поточну версію, — усі разом або жодної. */
export function migrate(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
): { from: number; to: number } {
  const from = schemaVersion(db);
  const to = migrations.at(-1)?.version ?? 0;
  if (from > to) {
    throw new Error(
      `БД зі схемою ${String(from)} — від новішої версії Banshee; ця версія знає схему до ${String(to)}`,
    );
  }
  const pending = migrations.filter((migration) => migration.version > from);
  pending.forEach((migration, index) => {
    const expected = from + index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Міграції не по порядку: очікується ${String(expected)}, є ${String(migration.version)}`,
      );
    }
  });
  db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.sql);
      db.pragma(`user_version = ${String(migration.version)}`);
    }
  })();
  return { from, to };
}

/** Ідентифікатор цього ПК для `usage_daily` і синхронізації: створюється один раз. */
function ensureDeviceId(db: Db): string {
  const row = db
    .prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'device_id'")
    .get();
  if (row) return row.value;
  const id = ulid();
  db.prepare("INSERT INTO meta (key, value) VALUES ('device_id', ?)").run(id);
  return id;
}

export interface OpenedDatabase {
  readonly db: Db;
  readonly from: number;
  readonly to: number;
  /** Копія БД перед міграцією; null — міграції не було або БД нова. */
  readonly backup: string | null;
  readonly deviceId: string;
}

/** `data\banshee.db` у теці Banshee; у розробці — `.data/banshee.db`. ':memory:' — для тестів. */
export async function openDatabase(
  file: string,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<OpenedDatabase> {
  const existed = file !== ':memory:' && existsSync(file);
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    const current = schemaVersion(db);
    const target = migrations.at(-1)?.version ?? 0;
    let backup: string | null = null;
    if (existed && current > 0 && current < target) {
      const name = basename(file, extname(file));
      backup = join(dirname(file), `${name}.v${String(current)}.bak${extname(file)}`);
      await db.backup(backup);
    }
    const { from, to } = migrate(db, migrations);
    return { db, from, to, backup, deviceId: ensureDeviceId(db) };
  } catch (error) {
    db.close();
    throw error;
  }
}
