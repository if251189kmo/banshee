// npm test — vitest з робочою текою, де літера диска велика. Vitest 5 з робочою текою «d:\…» бачить
// дві копії себе й падає на кожному наборі («Cannot read properties of undefined (reading 'config')»),
// а оболонка інколи дає теку саме з малою літерою: так двічі провалювалась перевірка перед комітом.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cwd = process.cwd().replace(/^[a-z]:/u, (drive) => drive.toUpperCase());
const result = spawnSync(
  process.execPath,
  [join(cwd, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...process.argv.slice(2)],
  { cwd, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
