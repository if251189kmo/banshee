import { describe, expect, it } from 'vitest';
import { bansheePaths, selfCheckPaths } from './paths.ts';

describe('тека Banshee', () => {
  it('зібрана програма: app\\, data\\, models\\, logs\\ в одній теці', () => {
    const paths = bansheePaths({
      packaged: true,
      exe: 'D:\\Banshee\\app\\Banshee.exe',
      appPath: 'D:\\Banshee\\app\\resources\\app.asar',
    });
    expect(paths).toEqual({
      root: 'D:\\Banshee',
      data: 'D:\\Banshee\\data',
      models: 'D:\\Banshee\\models',
      logs: 'D:\\Banshee\\logs',
      db: 'D:\\Banshee\\data\\banshee.db',
      chromium: 'D:\\Banshee\\data\\chromium',
    });
  });

  it('розробка: .data у корені репозиторію', () => {
    const paths = bansheePaths({
      packaged: false,
      exe: 'D:\\work-project\\banshee\\node_modules\\electron\\dist\\electron.exe',
      appPath: 'D:\\work-project\\banshee\\apps\\desktop',
    });
    expect(paths.root).toBe('D:\\work-project\\banshee\\.data');
    expect(paths.db).toBe('D:\\work-project\\banshee\\.data\\banshee.db');
    expect(paths.logs).toBe('D:\\work-project\\banshee\\.data\\logs');
  });

  it('перевірка програми — окрема тека, моделі спільні', () => {
    const paths = selfCheckPaths(
      bansheePaths({ packaged: true, exe: 'E:\\Banshee\\app\\Banshee.exe', appPath: '' }),
    );
    expect(paths.db).toBe('E:\\Banshee\\self-check\\banshee.db');
    expect(paths.chromium).toBe('E:\\Banshee\\self-check\\chromium');
    expect(paths.models).toBe('E:\\Banshee\\models');
  });
});
