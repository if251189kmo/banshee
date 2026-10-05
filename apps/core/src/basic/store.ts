// Словник назв і рутини в БД (.claude/logic/04-memory.md): назви власника, його й вивчені рутини.
// Вбудовані рутини живуть у коді, а в таблицю `routines` записуються під своїм id — на них
// посилаються ходи (`turns.routine_id`) і статистика «Найкорисніші рутини».
import { maxLevel, ulid, type ActionLevel } from '@banshee/shared';
import type { Db } from '../db/database.ts';
import type { Alias, AliasKind } from './aliases.ts';
import { BUILTIN_ROUTINES, type Routine, type RoutineStep } from './builtins.ts';
import { normalize } from './text.ts';

/** Рівні інструментів вбудованих рутин (01-architecture.md); з кроку 1.4 — з реєстру mcp/pc. */
const TOOL_LEVELS: Readonly<Record<string, ActionLevel>> = {
  open_app: 'green',
  close_app: 'yellow',
  volume: 'green',
  media: 'green',
  window: 'green',
  open_target: 'green',
  lock_pc: 'green',
  system_info: 'green',
};

/** Рівень кроку: увімкнути ШІ коштує грошей — 🟡; невідомий інструмент — 🔴. */
export function stepLevel(step: RoutineStep): ActionLevel {
  if (step.tool === 'settings.set') {
    return step.args.key === 'ai.enabled' && step.args.value === true ? 'yellow' : 'green';
  }
  return TOOL_LEVELS[step.tool] ?? 'red';
}

export function routineLevel(routine: Routine): ActionLevel {
  return routine.steps.map(stepLevel).reduce(maxLevel, 'green');
}

/** Записує вбудовані рутини в `routines` під їхніми id; лічильники використання не чіпає. */
export function syncBuiltinRoutines(db: Db): void {
  const upsert = db.prepare(`
    INSERT INTO routines (uid, origin, status, trigger_template, examples_json, steps_json, max_tier)
    VALUES (@uid, 'builtin', 'active', @trigger, @examples, @steps, @tier)
    ON CONFLICT (uid) DO UPDATE SET
      status = 'active',
      trigger_template = excluded.trigger_template,
      examples_json = excluded.examples_json,
      steps_json = excluded.steps_json,
      max_tier = excluded.max_tier`);
  const ids = BUILTIN_ROUTINES.map((routine) => routine.id);
  db.transaction(() => {
    for (const routine of BUILTIN_ROUTINES) {
      upsert.run({
        uid: routine.id,
        trigger: routine.templates[0] ?? '',
        examples: JSON.stringify(routine.templates),
        steps: JSON.stringify(routine.steps),
        tier: routineLevel(routine),
      });
    }
    // Вбудована рутина, якої більше немає в коді, — в архів: ходи на неї посилаються й далі.
    db.prepare(
      `UPDATE routines SET status = 'archived'
       WHERE origin = 'builtin' AND uid NOT IN (SELECT value FROM json_each(?))`,
    ).run(JSON.stringify(ids));
  })();
}

/** Активні рутини власника й вивчені — для маршрутизації разом із вбудованими. */
export function activeRoutines(db: Db): Routine[] {
  const rows = db
    .prepare<[], { uid: string; examples_json: string; steps_json: string }>(
      `SELECT uid, examples_json, steps_json FROM routines
       WHERE origin != 'builtin' AND status = 'active' AND deleted = 0`,
    )
    .all();
  return rows.map((row) => ({
    id: row.uid,
    templates: JSON.parse(row.examples_json) as string[],
    steps: JSON.parse(row.steps_json) as RoutineStep[],
  }));
}

export function ownerAliases(db: Db): Alias[] {
  return db.prepare<[], Alias>('SELECT phrase, target, kind FROM aliases WHERE deleted = 0').all();
}

/** Нова назва власника або нова ціль для наявної: «телега — це Telegram». */
export function saveAlias(
  db: Db,
  input: { readonly phrase: string; readonly target: string; readonly kind: AliasKind },
  deviceId: string,
): Alias {
  const phrase = normalize(input.phrase);
  if (phrase === '') throw new Error('Порожня назва');
  db.prepare(
    `INSERT INTO aliases (uid, phrase, target, kind, device_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (kind, phrase) WHERE deleted = 0 DO UPDATE SET target = excluded.target`,
  ).run(ulid(), phrase, input.target, input.kind, deviceId);
  return { phrase, target: input.target, kind: input.kind };
}
