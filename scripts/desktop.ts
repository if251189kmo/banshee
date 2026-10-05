// Збірка й запуск desktop (.claude/logic/01-architecture.md, «Розробка»):
//   npm run dev            — electron-vite: програма з перезбиранням на льоту;
//   npm run build          — збірка в apps/desktop/out;
//   npm run desktop:check  — збірка й перевірка програми (`--self-check`): старт, вікно, команда без ШІ,
//                            перезапуск core, другий екземпляр; результат — .data/desktop-check.json;
//   npm run desktop:shots  — знімки центру керування й оверлею у світлій і темній темах: .data/ui-shots;
//   npm run dist           — встановлювач NSIS у .data/dist (electron-builder; кеші — на D:).
// Термінал VS Code успадковує ELECTRON_RUN_AS_NODE=1, і тоді Electron працює як звичайний Node, тож
// змінну прибрано з оточення дочірніх процесів.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const desktop = join(root, 'apps', 'desktop');
const electron = createRequire(import.meta.url)('electron') as string;
const electronVite = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const environment: Record<string, string | undefined> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'),
  ),
  // NSIS і решту інструментів electron-builder качає сюди, а не на C:.
  ELECTRON_BUILDER_CACHE: join(root, '.data', 'electron-builder-cache'),
};
const electronBuilder = join(root, 'node_modules', 'electron-builder', 'cli.js');

function run(command: string, args: readonly string[]): number {
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env: environment });
  return result.status ?? 1;
}

interface CheckResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly [key: string]: unknown;
}

function check(): number {
  const built = run(process.execPath, [electronVite, 'build']);
  if (built !== 0) return built;
  const code = run(electron, ['.', '--self-check']);
  const file = join(root, '.data', 'desktop-check.json');
  const result = JSON.parse(readFileSync(file, 'utf8')) as CheckResult;
  console.log(JSON.stringify({ ...result, processes: undefined }, null, 2));
  console.log(result.ok ? 'Перевірка програми пройшла.' : 'Перевірка програми НЕ пройшла.');
  return result.ok && code === 0 ? 0 : 1;
}

const mode = process.argv[2];
switch (mode) {
  case 'dev':
    process.exit(run(process.execPath, [electronVite]));
    break;
  case 'build':
    process.exit(run(process.execPath, [electronVite, 'build']));
    break;
  case 'check':
    process.exit(check());
    break;
  case 'dist': {
    const built = run(process.execPath, [electronVite, 'build']);
    process.exit(
      built === 0
        ? run(process.execPath, [electronBuilder, '--win', 'nsis', '--x64', '--publish', 'never'])
        : built,
    );
    break;
  }
  case 'shots': {
    const built = run(process.execPath, [electronVite, 'build']);
    process.exit(built === 0 ? run(electron, ['.', '--ui-shots']) : built);
    break;
  }
  default:
    console.error('Використання: node scripts/desktop.ts dev | build | check | shots | dist');
    process.exit(2);
}
