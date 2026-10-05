// npm run db — відкриває БД розробки `.data/banshee.db` (створює й мігрує, якщо треба) і показує
// версію схеми та кількість рядків у таблицях. Подію відкриття пише в журнал роботи `.data/logs`.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLog } from '@banshee/shared/log';
import { openDatabase } from './database.ts';

const { values } = parseArgs({
  options: { file: { type: 'string', default: '.data/banshee.db' } },
});
const file = resolve(values.file);
mkdirSync(resolve(file, '..'), { recursive: true });
const log = createLog({ dir: resolve('.data/logs'), source: 'core' });
const started = performance.now();
const { db, from, to, backup } = await openDatabase(file);
log.info('db.open', {
  from,
  to,
  backup: backup !== null,
  ms: Math.round(performance.now() - started),
});
console.log(`БД: ${file}`);
console.log(
  `Схема: ${String(from)} → ${String(to)}${backup ? ` · копія перед міграцією: ${backup}` : ''}`,
);
const tables = db
  .prepare<[], { name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
  )
  .all();
for (const { name } of tables) {
  const row = db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM "${name}"`).get();
  console.log(`  ${name}: ${String(row?.n ?? 0)}`);
}
db.close();
