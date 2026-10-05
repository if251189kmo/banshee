// Налаштування в БД (.claude/logic/10-settings.md, «Правила»): значення перевіряє схема
// @banshee/shared, кожна зміна — рядок журналу дій `settings.set` з попереднім значенням у
// `undo_json`, тож «скасуй» працює для налаштувань так само, як для файлів.
import {
  loadSettings,
  parseSetting,
  SETTINGS,
  SETTINGS_TOOL,
  toStored,
  type ActionSource,
  type ConfirmMethod,
  type SettingKey,
  type Settings,
  type SettingValue,
} from '@banshee/shared';
import type { Db } from '../db/database.ts';

export function readSettings(db: Db): { settings: Settings; problems: string[] } {
  const rows = db
    .prepare<[], { key: string; valueJson: string; scope: 'user' | 'device' }>(
      'SELECT key, value_json AS valueJson, scope FROM settings WHERE deleted = 0',
    )
    .all();
  return loadSettings(rows);
}

export interface SettingChange<K extends SettingKey> {
  readonly key: K;
  readonly value: unknown;
  /** Звідки зміна — поле `actions.source`. */
  readonly source: ActionSource;
  readonly confirmedBy: ConfirmMethod;
  readonly turnId?: number;
}

/**
 * Записує налаштування й рядок журналу. Перевіряє значення; хто й як може змінювати (голос,
 * синхронізація) вирішує той, хто викликає, через `changeVerdict` до підтвердження.
 */
export function writeSetting<K extends SettingKey>(
  db: Db,
  change: SettingChange<K>,
  deviceId: string,
  now: Date = new Date(),
): SettingValue<K> {
  const parsed = parseSetting(change.key, change.value);
  if (!parsed.ok) throw new Error(`${SETTINGS[change.key].label}: ${parsed.error}`);
  const previous = readSettings(db).settings[change.key];
  const stored = toStored(change.key, parsed.value);
  const at = now.toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO settings (key, value_json, scope, updated_at, device_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at,
         device_id = excluded.device_id, deleted = 0`,
    ).run(stored.key, stored.valueJson, stored.scope, at, deviceId);
    db.prepare(
      `INSERT INTO actions (turn_id, tool, args_json, tier, source, confirmed_by, status, undo_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?)`,
    ).run(
      change.turnId ?? null,
      SETTINGS_TOOL,
      JSON.stringify({ key: change.key, value: parsed.value }),
      SETTINGS[change.key].manualOnly || change.confirmedBy !== 'auto' ? 'yellow' : 'green',
      change.source,
      change.confirmedBy,
      JSON.stringify({ key: change.key, value: previous }),
      at,
    );
  })();
  return parsed.value;
}
