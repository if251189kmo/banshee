import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/database.ts';
import { BUILTIN_ROUTINES } from './builtins.ts';
import { route } from './router.ts';
import {
  activeRoutines,
  ownerAliases,
  routineLevel,
  saveAlias,
  syncBuiltinRoutines,
} from './store.ts';

const opened: Db[] = [];
async function open(): Promise<{ db: Db; deviceId: string }> {
  const result = await openDatabase(':memory:');
  opened.push(result.db);
  return result;
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('словник назв і рутини в БД', () => {
  it('вбудовані рутини записуються під своїми id з рівнем; повтор лічильників не скидає', async () => {
    const { db } = await open();
    syncBuiltinRoutines(db);
    db.prepare("UPDATE routines SET uses = 7 WHERE uid = 'builtin.volume.set'").run();
    syncBuiltinRoutines(db);
    const rows = db
      .prepare<[], { uid: string; max_tier: string; uses: number }>(
        "SELECT uid, max_tier, uses FROM routines WHERE origin = 'builtin' AND status = 'active'",
      )
      .all();
    expect(rows).toHaveLength(BUILTIN_ROUTINES.length);
    expect(rows.find((row) => row.uid === 'builtin.volume.set')?.uses).toBe(7);
    expect(rows.find((row) => row.uid === 'builtin.close.app')?.max_tier).toBe('yellow');
    expect(rows.find((row) => row.uid === 'builtin.ai.on')?.max_tier).toBe('yellow');
    expect(rows.find((row) => row.uid === 'builtin.ai.off')?.max_tier).toBe('green');
  });

  it('вбудована рутина, якої вже немає в коді, іде в архів', async () => {
    const { db } = await open();
    db.prepare(
      `INSERT INTO routines (uid, origin, status, trigger_template, steps_json, max_tier)
       VALUES ('builtin.old', 'builtin', 'active', 'старе', '[]', 'green')`,
    ).run();
    syncBuiltinRoutines(db);
    expect(db.prepare("SELECT status FROM routines WHERE uid = 'builtin.old'").get()).toEqual({
      status: 'archived',
    });
  });

  it('назва власника працює в маршрутизації; повтор — нова ціль', async () => {
    const { db, deviceId } = await open();
    saveAlias(
      db,
      { phrase: 'Проект Банші', target: 'D:\\work-project\\banshee', kind: 'folder' },
      deviceId,
    );
    const command = route('відкрий проект банші', { ai: 'off', aliases: ownerAliases(db) });
    expect(command.kind === 'routine' && command.match.steps).toEqual([
      { tool: 'open_target', args: { target: 'D:\\work-project\\banshee' } },
    ]);
    saveAlias(db, { phrase: 'проект банші', target: 'E:\\banshee', kind: 'folder' }, deviceId);
    expect(ownerAliases(db)).toEqual([
      { phrase: 'проект банші', target: 'E:\\banshee', kind: 'folder' },
    ]);
  });

  it('рутини власника беруться лише активні й не видалені', async () => {
    const { db } = await open();
    const insert = db.prepare(
      `INSERT INTO routines (uid, origin, status, trigger_template, examples_json, steps_json, max_tier, deleted)
       VALUES (?, 'owner', ?, 'режим роботи', '["режим роботи"]', '[{"tool":"open_app","args":{"app":"Visual Studio Code"}}]', 'green', ?)`,
    );
    insert.run('01J0000000000000000000000E', 'active', 0);
    insert.run('01J0000000000000000000000F', 'off', 0);
    insert.run('01J0000000000000000000000G', 'active', 1);
    const routines = activeRoutines(db);
    expect(routines.map((routine) => routine.id)).toEqual(['01J0000000000000000000000E']);
    expect(routineLevel(routines[0] ?? { id: '', templates: [], steps: [] })).toBe('green');
    const command = route('режим роботи', { ai: 'off', routines });
    expect(command.kind === 'routine' && command.match.routine.id).toBe(
      '01J0000000000000000000000E',
    );
  });
});
