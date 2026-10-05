// «Видалити всі дані» (.claude/logic/01-architecture.md, «Встановлення й оновлення»): ключ Claude —
// з Credential Manager (робить core), програма — своїм деінсталятором, тека Banshee з пам'яттю,
// моделями й журналами — у Кошик. Лише у встановленій програмі; виконує окремий PowerShell, коли
// Banshee вже завершився: файли працюючої програми не видалити.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Рядок PowerShell в одинарних лапках — значення лише як текст. */
const quote = (value: string): string => `'${value.replaceAll('\0', '').replaceAll("'", "''")}'`;

export interface EraseTarget {
  /** Тека Banshee. */
  readonly root: string;
  readonly uninstaller: string;
}

/** Що видаляти; null — це не встановлена програма (розробка чи розпакована збірка). */
export function eraseTarget(root: string, packaged: boolean): EraseTarget | null {
  const uninstaller = join(root, 'app', 'Uninstall Banshee.exe');
  return packaged && existsSync(uninstaller) ? { root, uninstaller } : null;
}

/**
 * Скрипт: дочекатися виходу Banshee, запустити деінсталятор тихо, решту теки — у Кошик.
 * dryRun лише друкує кроки — для перевірки скрипту без змін на диску.
 */
export function eraseScript(target: EraseTarget, pid: number, dryRun = false): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$root = ${quote(target.root)}`,
    `$uninstaller = ${quote(target.uninstaller)}`,
    `$dry = $${String(dryRun)}`,
    `Wait-Process -Id ${String(Math.trunc(pid))} -Timeout 60 -ErrorAction SilentlyContinue`,
    'if (Test-Path -LiteralPath $uninstaller) {',
    "  if ($dry) { Write-Output \"uninstall $uninstaller\" } else { Start-Process -FilePath $uninstaller -ArgumentList '/currentuser', '/S' -Wait }",
    '}',
    'if (Test-Path -LiteralPath $root) {',
    '  if ($dry) { Write-Output "recycle $root" } else {',
    '    Add-Type -AssemblyName Microsoft.VisualBasic',
    "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($root, 'OnlyErrorDialogs', 'SendToRecycleBin')",
    '  }',
    '}',
    '',
  ].join('\r\n');
}
