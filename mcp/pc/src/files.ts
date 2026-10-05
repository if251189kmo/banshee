// Файли (.claude/logic/05-safety.md): пошук, переміщення, копіювання, перейменування, видалення
// лише в Кошик і «скасуй». Перезапису немає: якщо в цілі вже є файл з такою назвою — помилка.
// Переміщення між дисками — копія й видалення оригіналу в Кошик, а не повз нього.
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { psArray, runJson } from './ps.ts';
import type { Shell } from './powershell.ts';

export const KNOWN_FOLDERS = [
  'Desktop',
  'Downloads',
  'Documents',
  'Pictures',
  'Music',
  'Videos',
] as const;
export type KnownFolder = (typeof KNOWN_FOLDERS)[number];

/** Справжні шляхи відомих тек: їх можна перенести, тож питаємо Windows, а не вгадуємо. */
export async function knownFolderPaths(shell: Shell): Promise<Record<KnownFolder, string>> {
  return runJson<Record<KnownFolder, string>>(
    shell,
    `@{
      Desktop = [Environment]::GetFolderPath('Desktop')
      Documents = [Environment]::GetFolderPath('MyDocuments')
      Pictures = [Environment]::GetFolderPath('MyPictures')
      Music = [Environment]::GetFolderPath('MyMusic')
      Videos = [Environment]::GetFolderPath('MyVideos')
      Downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
    } | ConvertTo-Json -Compress`,
  );
}

/**
 * Тека з аргументу інструмента: відома тека («Downloads»), її підтека («Pictures\Screenshots») або
 * абсолютний шлях. null — шлях не впізнано.
 */
export function resolveFolder(
  value: string,
  known: Readonly<Record<KnownFolder, string>>,
): string | null {
  const [first = '', ...rest] = value.replaceAll('/', '\\').split('\\');
  const folder = KNOWN_FOLDERS.find((name) => name.toLowerCase() === first.toLowerCase());
  if (folder) return join(known[folder], ...rest);
  return isAbsolute(value) && /^[A-Za-z]:\\|^\\\\/.test(value) ? resolve(value) : null;
}

/** Мережевий шлях: Кошика там немає, видалення було б назавжди. */
export function isNetworkPath(path: string): boolean {
  return path.startsWith('\\\\');
}

// Пошук файлів

export interface FoundFile {
  readonly path: string;
  readonly size: number;
  readonly modified: string;
}

export interface FindOptions {
  readonly root: string;
  readonly query: string;
  /** YYYY-MM-DD, включно. */
  readonly modifiedAfter?: string;
  /** YYYY-MM-DD, не включно. */
  readonly modifiedBefore?: string;
  readonly limit?: number;
  readonly maxEntries?: number;
  readonly maxMs?: number;
}

/** Теки, де файлів власника немає, а обхід довгий. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'appdata',
  '$recycle.bin',
  'system volume information',
]);
const MAX_DEPTH = 8;

/** «*.pdf», «звіт*» — шаблон; інакше — частина назви. Регістр не важливий. */
export function nameMatcher(query: string): (name: string) => boolean {
  const lowered = query.trim().toLowerCase();
  if (lowered === '' || lowered === '*') return () => true;
  if (!/[*?]/.test(lowered)) return (name) => name.toLowerCase().includes(lowered);
  const pattern = lowered
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  const regex = new RegExp(`^${pattern}$`);
  return (name) => regex.test(name.toLowerCase());
}

const localDay = (value: string): number => {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
};

export async function findFiles(
  options: FindOptions,
): Promise<{ files: FoundFile[]; truncated: boolean }> {
  const matches = nameMatcher(options.query);
  const after = options.modifiedAfter ? localDay(options.modifiedAfter) : -Infinity;
  const before = options.modifiedBefore ? localDay(options.modifiedBefore) : Infinity;
  const deadline = performance.now() + (options.maxMs ?? 5000);
  const maxEntries = options.maxEntries ?? 200_000;
  const found: FoundFile[] = [];
  let seen = 0;
  let truncated = false;
  const queue: { dir: string; depth: number }[] = [{ dir: options.root, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    if (seen >= maxEntries || performance.now() > deadline) {
      truncated = true;
      break;
    }
    let entries;
    try {
      entries = await readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      const path = join(next.dir, entry.name);
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (next.depth < MAX_DEPTH && !name.startsWith('.') && !SKIP_DIRS.has(name)) {
          queue.push({ dir: path, depth: next.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !matches(entry.name)) continue;
      try {
        const info = await stat(path);
        const time = info.mtime.getTime();
        if (time >= after && time < before) {
          found.push({ path, size: info.size, modified: info.mtime.toISOString() });
        }
      } catch {
        // Файл зник між readdir і stat.
      }
    }
  }
  found.sort((a, b) => b.modified.localeCompare(a.modified));
  const limit = options.limit ?? 20;
  return { files: found.slice(0, limit), truncated: truncated || found.length > limit };
}

/** Скільки файлів зачіпає операція: тека рахується всім вмістом (до межі). */
export async function countFiles(paths: readonly string[], cap = 10_000): Promise<number> {
  let count = 0;
  const queue = [...paths];
  while (queue.length > 0 && count < cap) {
    const path = queue.shift();
    if (path === undefined) break;
    try {
      const info = await stat(path);
      if (!info.isDirectory()) {
        count += 1;
        continue;
      }
      for (const name of await readdir(path)) queue.push(join(path, name));
    } catch {
      count += 1;
    }
  }
  return count;
}

// Кошик

/** Видалення в Кошик: Shell показує свій діалог, якщо файл завеликий для Кошика, — тихо назавжди не видаляє. */
export function recycleScript(paths: readonly string[]): string {
  return `
Add-Type -AssemblyName Microsoft.VisualBasic
$done = @()
foreach ($p in ${psArray(paths)}) {
  if (Test-Path -LiteralPath $p -PathType Container) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'AllDialogs', 'SendToRecycleBin')
  } else {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'AllDialogs', 'SendToRecycleBin')
  }
  if (-not (Test-Path -LiteralPath $p)) { $done += $p }
}
@{ recycled = @($done) } | ConvertTo-Json -Compress`;
}

/**
 * Повернення з Кошика за початковим шляхом. Windows 10 і 11 зберігають у файлі $I початковий шлях
 * (UTF-16 з 28-го байта), а сам файл — як $R з тим самим суфіксом.
 */
export function restoreScript(paths: readonly string[]): string {
  return String.raw`
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$restored = @(); $missing = @()
foreach ($original in ${psArray(paths)}) {
  $bin = Join-Path ([IO.Path]::GetPathRoot($original)) ('$Recycle.Bin\' + $sid)
  $match = Get-ChildItem -LiteralPath $bin -Force -Filter '$I*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Where-Object {
      $bytes = [IO.File]::ReadAllBytes($_.FullName)
      if ($bytes.Length -lt 28) { return $false }
      $length = [BitConverter]::ToInt32($bytes, 24)
      [Text.Encoding]::Unicode.GetString($bytes, 28, [Math]::Max(0, $length - 1) * 2) -eq $original
    } | Select-Object -First 1
  if (-not $match -or (Test-Path -LiteralPath $original)) { $missing += $original; continue }
  Move-Item -LiteralPath (Join-Path $bin ('$R' + $match.Name.Substring(2))) -Destination $original
  Remove-Item -LiteralPath $match.FullName -Force
  $restored += $original
}
@{ restored = @($restored); missing = @($missing) } | ConvertTo-Json -Compress`;
}

// Операції з файлами

export type FileOp = 'move' | 'copy' | 'rename' | 'recycle';

/** Що повернути для «скасуй» (`actions.undo_json`). */
export type FileUndo =
  | { readonly kind: 'move'; readonly moves: readonly { from: string; to: string }[] }
  | { readonly kind: 'recycle-copies'; readonly paths: readonly string[] }
  | { readonly kind: 'restore'; readonly paths: readonly string[] };

export interface FileOpResult {
  readonly done: readonly string[];
  readonly failed: readonly { path: string; error: string }[];
  readonly undo: FileUndo | null;
}

async function sameVolume(a: string, b: string): Promise<boolean> {
  return (await stat(a)).dev === (await stat(b)).dev;
}

export async function fileOp(
  shell: Shell,
  op: FileOp,
  paths: readonly string[],
  dest: string | null,
): Promise<FileOpResult> {
  const done: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const moves: { from: string; to: string }[] = [];
  const copies: string[] = [];
  const recycleAfterCopy: string[] = [];
  if (op === 'recycle') {
    const { recycled } = await runJson<{ recycled: string[] }>(shell, recycleScript(paths));
    for (const path of paths) {
      if (recycled.includes(path)) done.push(path);
      else failed.push({ path, error: 'не вдалося видалити в Кошик' });
    }
    return { done, failed, undo: done.length > 0 ? { kind: 'restore', paths: done } : null };
  }
  if (dest === null) throw new Error('Потрібна ціль');
  if (op !== 'rename') await mkdir(dest, { recursive: true });
  for (const path of paths) {
    try {
      if (!existsSync(path)) throw new Error('немає такого файлу');
      const target = op === 'rename' ? join(dirname(path), dest) : join(dest, basename(path));
      if (existsSync(target)) throw new Error(`уже є ${target}`);
      if (op === 'copy') {
        await cp(path, target, { recursive: true, errorOnExist: true, force: false });
        copies.push(target);
      } else if (op === 'rename' || (await sameVolume(path, dirname(target)))) {
        await rename(path, target);
        moves.push({ from: target, to: path });
      } else {
        await cp(path, target, { recursive: true, errorOnExist: true, force: false });
        recycleAfterCopy.push(path);
        moves.push({ from: target, to: path });
      }
      done.push(path);
    } catch (error) {
      failed.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (recycleAfterCopy.length > 0) {
    await runJson<{ recycled: string[] }>(shell, recycleScript(recycleAfterCopy));
  }
  if (op === 'copy') {
    return {
      done,
      failed,
      undo: copies.length > 0 ? { kind: 'recycle-copies', paths: copies } : null,
    };
  }
  return { done, failed, undo: moves.length > 0 ? { kind: 'move', moves } : null };
}

/** «Скасуй» для файлових дій: повернути переміщене, прибрати копії в Кошик, відновити з Кошика. */
export async function undoFileOp(shell: Shell, undo: FileUndo): Promise<FileOpResult> {
  if (undo.kind === 'restore') {
    const { restored, missing } = await runJson<{ restored: string[]; missing: string[] }>(
      shell,
      restoreScript(undo.paths),
    );
    return {
      done: restored,
      failed: missing.map((path) => ({ path, error: 'немає в Кошику або шлях уже зайнятий' })),
      undo: null,
    };
  }
  if (undo.kind === 'recycle-copies') return fileOp(shell, 'recycle', undo.paths, null);
  const done: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const recycle: string[] = [];
  for (const { from, to } of undo.moves) {
    try {
      if (existsSync(to)) throw new Error(`уже є ${to}`);
      await mkdir(dirname(to), { recursive: true });
      if (await sameVolume(from, dirname(to))) {
        await rename(from, to);
      } else {
        // Між дисками: копія назад, а перенесене — у Кошик.
        await cp(from, to, { recursive: true, errorOnExist: true, force: false });
        recycle.push(from);
      }
      done.push(to);
    } catch (error) {
      failed.push({ path: from, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (recycle.length > 0) await runJson<{ recycled: string[] }>(shell, recycleScript(recycle));
  return { done, failed, undo: null };
}

/** Нова назва для rename — лише ім'я, без теки. */
export function isPlainName(name: string): boolean {
  return name !== '' && !name.includes(sep) && !name.includes('/') && !/[<>:"|?*]/.test(name);
}
