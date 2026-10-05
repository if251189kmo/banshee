// «Видалити всі дані»: скрипт перевіряється в PowerShell у режимі «лише показати кроки» — без змін
// на диску й без доторку до ключа Claude.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eraseScript, eraseTarget } from './erase.ts';

describe('«Видалити всі дані»', () => {
  it('лише у встановленій програмі з деінсталятором', () => {
    const root = mkdtempSync(join(tmpdir(), 'banshee-erase-'));
    expect(eraseTarget(root, false)).toBeNull();
    expect(eraseTarget(root, true)).toBeNull();
    mkdirSync(join(root, 'app'));
    writeFileSync(join(root, 'app', 'Uninstall Banshee.exe'), '');
    expect(eraseTarget(root, true)).toEqual({
      root,
      uninstaller: join(root, 'app', 'Uninstall Banshee.exe'),
    });
  });

  it('шлях з апострофом — лише текст у лапках, без виконання', () => {
    const script = eraseScript({ root: "D:\\Ben's\\Banshee", uninstaller: 'x' }, 42);
    expect(script).toContain("$root = 'D:\\Ben''s\\Banshee'");
    expect(script).toContain('Wait-Process -Id 42');
    expect(script).toContain("'SendToRecycleBin'");
  });

  it.runIf(process.platform === 'win32')(
    'PowerShell: спершу деінсталятор, потім тека — у Кошик (сухий прогін)',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'banshee-erase-'));
      mkdirSync(join(root, 'app'));
      const uninstaller = join(root, 'app', 'Uninstall Banshee.exe');
      writeFileSync(uninstaller, '');
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', eraseScript({ root, uninstaller }, 1, true)],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split(/\r?\n/)).toEqual([
        `uninstall ${uninstaller}`,
        `recycle ${root}`,
      ]);
    },
  );
});
