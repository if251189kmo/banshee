// Запуск Electron для перевірок розробки: `node scripts/electron.ts <скрипт>`. Термінал VS Code
// успадковує ELECTRON_RUN_AS_NODE=1, і тоді Electron працює як звичайний Node без `app`; тут змінну
// прибрано з оточення дочірнього процесу.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron') as string;
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'),
);
const result = spawnSync(electron, process.argv.slice(2), { stdio: 'inherit', env: environment });
process.exit(result.status ?? 1);
