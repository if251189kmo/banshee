// Тека Banshee (.claude/logic/01-architecture.md, «Встановлення й оновлення»): `app\`, `data\`,
// `models\`, `logs\` поруч, на диску, який обрав користувач. У розробці — `.data/` у корені
// репозиторію на диску D:.
import { dirname, join, resolve } from 'node:path';

export interface BansheePaths {
  /** Тека Banshee: `D:\Banshee`; у розробці — `.data`. */
  readonly root: string;
  readonly data: string;
  readonly models: string;
  readonly logs: string;
  /** БД пам'яті. */
  readonly db: string;
  /** Профіль Chromium: кеш і сховище сторінок; Electron типово писав би його в %APPDATA%. */
  readonly chromium: string;
}

export interface PathsInput {
  /** Зібрана програма чи розробка (`app.isPackaged`). */
  readonly packaged: boolean;
  /** `app.getPath('exe')`: у програмі — `<тека Banshee>\app\Banshee.exe`. */
  readonly exe: string;
  /** `app.getAppPath()`: у розробці — `apps/desktop`. */
  readonly appPath: string;
}

function layout(root: string, data: string): BansheePaths {
  return {
    root,
    data,
    models: join(root, 'models'),
    logs: join(root, 'logs'),
    db: join(data, 'banshee.db'),
    chromium: join(data, 'chromium'),
  };
}

export function bansheePaths(input: PathsInput): BansheePaths {
  if (input.packaged) {
    const root = resolve(dirname(input.exe), '..');
    return layout(root, join(root, 'data'));
  }
  const root = resolve(input.appPath, '..', '..', '.data');
  return layout(root, root);
}

/**
 * Перевірка програми (`--self-check`) працює в окремій теці: своя БД, журнали й профіль Chromium,
 * тож вона не чіпає пам'ять власника й не заважає Banshee, що вже працює.
 */
export function selfCheckPaths(paths: BansheePaths): BansheePaths {
  const root = join(paths.root, 'self-check');
  return { ...layout(root, root), models: paths.models };
}
