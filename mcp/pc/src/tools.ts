// Інструменти ПК етапу 1 (.claude/logic/01-architecture.md, «Інструменти етапу 1»). Кожен:
// перевіряє аргументи, оцінює дію — рівень і одне речення для картки підтвердження — і виконує її.
// Рівень визначає код (05-safety.md): типовий з визначення, але скрипт поза списком, понад 20 файлів,
// запуск програми через open_target чи видалення без Кошика — 🔴.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname } from 'node:path';
import { maxLevel, type ActionLevel, type PcToolName } from '@banshee/shared';
import { z } from 'zod';
import { classifyScript } from './classify.ts';
import { findTool } from './definitions.ts';
import {
  countFiles,
  fileOp,
  findFiles,
  isNetworkPath,
  isPlainName,
  knownFolderPaths,
  resolveFolder,
  undoFileOp,
  type FileUndo,
  type KnownFolder,
} from './files.ts';
import {
  AUDIO_TYPE,
  MEDIA_KEYS,
  PROTECTED_PROCESSES,
  SHOW_WINDOW,
  SYSTEM_APPS,
  USER32_TYPE,
} from './native.ts';
import { psQuote, runJson } from './ps.ts';
import type { Shell } from './powershell.ts';

export interface PcSettings {
  readonly powershellAllowlist: readonly string[];
  readonly massOperationFiles: number;
}

export interface PcContext {
  readonly shell: Shell;
  readonly settings: () => PcSettings;
  readonly home?: string;
  readonly now?: () => Date;
}

export interface Assessment {
  readonly level: ActionLevel;
  /** Одне речення українською: що буде зроблено. */
  readonly summary: string;
  /** Точна команда для картки 🔴. */
  readonly command?: string;
  /** Наслідок для картки 🔴: «не можна скасувати». */
  readonly consequence?: string;
}

export interface ToolOutcome {
  readonly ok: boolean;
  /** Результат для Claude (`tool_result`): короткий JSON. */
  readonly content: string;
  /** Для журналу дій і «скасуй». */
  readonly undo?: FileUndo;
}

export class ToolInputError extends Error {}

interface PcTool<A> {
  readonly name: PcToolName;
  readonly schema: z.ZodType<A>;
  assess(args: A, ctx: PcContext): Promise<Assessment>;
  run(args: A, ctx: PcContext): Promise<ToolOutcome>;
}

const json = (value: unknown): string => JSON.stringify(value);
const ok = (value: Record<string, unknown>): ToolOutcome => ({
  ok: true,
  content: json({ ok: true, ...value }),
});
const fail = (error: string): ToolOutcome => ({ ok: false, content: json({ ok: false, error }) });
const levelOf = (name: PcToolName): ActionLevel => findTool(name)?.meta.level ?? 'red';

/** Модель іноді передає null для непотрібних полів — це те саме, що їх немає. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

/** Шляхи відомих тек — один раз на процес PowerShell. */
const knownCache = new WeakMap<Shell, Promise<Record<KnownFolder, string>>>();
function known(ctx: PcContext): Promise<Record<KnownFolder, string>> {
  let cached = knownCache.get(ctx.shell);
  if (!cached) {
    cached = knownFolderPaths(ctx.shell).catch((error: unknown) => {
      knownCache.delete(ctx.shell);
      throw error;
    });
    knownCache.set(ctx.shell, cached);
  }
  return cached;
}

/** Процеси з вікном, що відповідають назві програми: за назвою процесу, описом чи продуктом. */
function windowProcessesScript(app: string): string {
  return `$q = ${psQuote(app)}
$p = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like "*$q*" -or $_.Description -like "*$q*" -or $_.Product -like "*$q*" -or $_.MainWindowTitle -like "*$q*") })`;
}

const openApp: PcTool<{ app: string }> = {
  name: 'open_app',
  schema: z.object({ app: z.string().trim().min(1) }),
  assess: async ({ app }) =>
    Promise.resolve({ level: levelOf('open_app'), summary: `Відкрити ${app}` }),
  async run({ app }, ctx) {
    const systemId = SYSTEM_APPS[app.toLowerCase()];
    const result = await runJson<{ ok: boolean; name?: string }>(
      ctx.shell,
      `$q = ${psQuote(app)}; $id = ${systemId ? psQuote(systemId) : '$null'}
$apps = @(Get-StartApps)
$app = $null
if ($id) { $app = $apps | Where-Object { $_.AppID -eq $id } | Select-Object -First 1 }
if (-not $app) { $app = $apps | Where-Object { $_.Name -eq $q } | Select-Object -First 1 }
if (-not $app) { $app = $apps | Where-Object { $_.Name -like "*$q*" } | Sort-Object { $_.Name.Length } | Select-Object -First 1 }
if (-not $app) { @{ ok = $false } | ConvertTo-Json -Compress; return }
Start-Process ('shell:AppsFolder\\' + $app.AppID)
@{ ok = $true; name = $app.Name } | ConvertTo-Json -Compress`,
    );
    return result.ok
      ? ok({ opened: result.name ?? app })
      : fail(`no Start menu app matches "${app}"`);
  },
};

const closeApp: PcTool<{ app: string }> = {
  name: 'close_app',
  schema: z.object({ app: z.string().trim().min(1) }),
  assess: async ({ app }) =>
    Promise.resolve({
      level: levelOf('close_app'),
      summary: `Закрити ${app}; незбережене може пропасти`,
    }),
  async run({ app }, ctx) {
    const result = await runJson<{ closed: string[]; protected: string[] }>(
      ctx.shell,
      `${windowProcessesScript(app)}
$protected = @(${[...PROTECTED_PROCESSES].map(psQuote).join(', ')})
$closed = @(); $skipped = @()
foreach ($proc in $p) {
  if ($protected -contains $proc.ProcessName.ToLower()) { $skipped += $proc.ProcessName; continue }
  if ($proc.CloseMainWindow()) { $closed += $proc.ProcessName }
}
@{ closed = @($closed | Select-Object -Unique); protected = @($skipped | Select-Object -Unique) } | ConvertTo-Json -Compress`,
    );
    if (result.protected.length > 0 && result.closed.length === 0) {
      return fail(`${result.protected.join(', ')} is part of Windows and is never closed`);
    }
    return result.closed.length > 0
      ? ok({ closed: result.closed })
      : fail(`no open window of "${app}"`);
  },
};

const volumeSchema = z
  .object({
    level: optional(z.number().int().min(0).max(100)),
    delta: optional(z.number().int().min(-100).max(100)),
    mute: optional(z.boolean()),
  })
  .refine(
    (args) =>
      [args.level, args.delta, args.mute].filter((value) => value !== undefined).length === 1,
    {
      error: 'Потрібне рівно одне з level, delta, mute',
    },
  );

const volume: PcTool<z.output<typeof volumeSchema>> = {
  name: 'volume',
  schema: volumeSchema,
  assess: async ({ level, delta, mute }) =>
    Promise.resolve({
      level: levelOf('volume'),
      summary:
        mute !== undefined
          ? mute
            ? 'Вимкнути звук'
            : 'Увімкнути звук'
          : level !== undefined
            ? `Гучність ${String(level)} %`
            : `Гучність ${delta !== undefined && delta > 0 ? '+' : ''}${String(delta)} %`,
    }),
  async run({ level, delta, mute }, ctx) {
    const change =
      mute !== undefined
        ? `[BansheeAudio]::Muted = $${String(mute)}`
        : level !== undefined
          ? `[BansheeAudio]::Level = ${String(level / 100)}; if (${String(level)} -gt 0) { [BansheeAudio]::Muted = $false }`
          : `[BansheeAudio]::Level = [Math]::Min(1, [Math]::Max(0, [BansheeAudio]::Level + ${String((delta ?? 0) / 100)}))`;
    const result = await runJson<{ level: number; muted: boolean }>(
      ctx.shell,
      `${AUDIO_TYPE}
${change}
@{ level = [int][Math]::Round([BansheeAudio]::Level * 100); muted = [BansheeAudio]::Muted } | ConvertTo-Json -Compress`,
    );
    return ok(result);
  },
};

const media: PcTool<{ action: keyof typeof MEDIA_KEYS }> = {
  name: 'media',
  schema: z.object({ action: z.enum(['play', 'pause', 'next', 'previous']) }),
  assess: async ({ action }) =>
    Promise.resolve({
      level: levelOf('media'),
      summary: {
        play: 'Відтворення',
        pause: 'Пауза',
        next: 'Наступний трек',
        previous: 'Попередній трек',
      }[action],
    }),
  async run({ action }, ctx) {
    await runJson(
      ctx.shell,
      `${USER32_TYPE}\n[BansheeUser32]::Press(${String(MEDIA_KEYS[action])}); '{}'`,
    );
    return ok({ sent: action });
  },
};

const windowSchema = z.object({
  action: z.enum(['show', 'minimize', 'maximize', 'minimize_all']),
  app: optional(z.string().trim().min(1)),
});
const windowTool: PcTool<z.output<typeof windowSchema>> = {
  name: 'window',
  schema: windowSchema,
  assess: async ({ action, app }) =>
    Promise.resolve({
      level: levelOf('window'),
      summary:
        action === 'minimize_all'
          ? 'Згорнути всі вікна'
          : `${{ show: 'Показати', minimize: 'Згорнути', maximize: 'Розгорнути' }[action]} ${app ?? 'активне вікно'}`,
    }),
  async run({ action, app }, ctx) {
    if (action === 'minimize_all') {
      await runJson(ctx.shell, `(New-Object -ComObject Shell.Application).MinimizeAll(); '{}'`);
      return ok({ action });
    }
    const target = app
      ? `${windowProcessesScript(app)}\n$h = @($p | ForEach-Object { $_.MainWindowHandle })`
      : '$h = @([BansheeUser32]::GetForegroundWindow())';
    const result = await runJson<{ windows: number }>(
      ctx.shell,
      `${USER32_TYPE}
${target}
foreach ($w in $h) {
  [void][BansheeUser32]::ShowWindowAsync($w, ${String(SHOW_WINDOW[action])})
  if (${action === 'minimize' ? '$false' : '$true'}) { [void][BansheeUser32]::SetForegroundWindow($w) }
}
@{ windows = $h.Count } | ConvertTo-Json -Compress`,
    );
    return result.windows > 0
      ? ok({ action, windows: result.windows })
      : fail(`no open window of "${app ?? 'active'}"`);
  },
};

/** Файли, відкриття яких — запуск програми чи скрипту: це вже не «відкрити», а 🔴. */
const EXECUTABLE = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.hta',
  '.lnk',
  '.reg',
  '.cpl',
  '.msc',
  '.jar',
]);

type Target =
  | { kind: 'url' | 'settings'; value: string }
  | { kind: 'path'; value: string; executable: boolean }
  | { kind: 'invalid'; reason: string };

async function resolveTarget(target: string, ctx: PcContext): Promise<Target> {
  const value = target.trim();
  if (/^https?:\/\/[^\s]+$/i.test(value)) return { kind: 'url', value };
  if (/^ms-settings:[a-z0-9-]*$/i.test(value)) return { kind: 'settings', value };
  const path = resolveFolder(value, await known(ctx));
  if (path === null)
    return {
      kind: 'invalid',
      reason: `unknown target "${value}": use a URL, ms-settings:, known folder or absolute path`,
    };
  if (!existsSync(path)) return { kind: 'invalid', reason: `path does not exist: ${path}` };
  const executable = !statSync(path).isDirectory() && EXECUTABLE.has(extname(path).toLowerCase());
  return { kind: 'path', value: path, executable };
}

const openTarget: PcTool<{ target: string }> = {
  name: 'open_target',
  schema: z.object({ target: z.string().trim().min(1) }),
  async assess({ target }, ctx) {
    const resolved = await resolveTarget(target, ctx);
    if (resolved.kind === 'invalid') throw new ToolInputError(resolved.reason);
    if (resolved.kind === 'path' && resolved.executable) {
      return {
        level: 'red',
        summary: `Запустити ${resolved.value}`,
        command: resolved.value,
        consequence: 'це запуск програми чи скрипту, а не відкриття файлу',
      };
    }
    return { level: levelOf('open_target'), summary: `Відкрити ${resolved.value}` };
  },
  async run({ target }, ctx) {
    const resolved = await resolveTarget(target, ctx);
    if (resolved.kind === 'invalid') return fail(resolved.reason);
    await runJson(ctx.shell, `Start-Process -FilePath ${psQuote(resolved.value)}; '{}'`);
    return ok({ opened: resolved.value });
  },
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Дата — YYYY-MM-DD' });
const findSchema = z.object({
  query: z.string().trim().min(1),
  folder: optional(z.string().trim().min(1)),
  modified_after: optional(day),
  modified_before: optional(day),
});
const findFilesTool: PcTool<z.output<typeof findSchema>> = {
  name: 'find_files',
  schema: findSchema,
  assess: async ({ query, folder }) =>
    Promise.resolve({
      level: levelOf('find_files'),
      summary: `Знайти «${query}»${folder ? ` у ${folder}` : ''}`,
    }),
  async run(args, ctx) {
    const root = args.folder
      ? resolveFolder(args.folder, await known(ctx))
      : (ctx.home ?? homedir());
    if (root === null || !existsSync(root)) return fail(`folder not found: ${args.folder ?? ''}`);
    const { files, truncated } = await findFiles({
      root,
      query: args.query,
      ...(args.modified_after ? { modifiedAfter: args.modified_after } : {}),
      ...(args.modified_before ? { modifiedBefore: args.modified_before } : {}),
    });
    return ok({ files, truncated });
  },
};

const fileOpSchema = z
  .object({
    op: z.enum(['move', 'copy', 'rename', 'recycle']),
    paths: z.array(z.string().trim().min(1)).min(1),
    dest: optional(z.string().trim().min(1)),
  })
  .refine((args) => args.op === 'recycle' || args.dest !== undefined, {
    error: 'Для move, copy і rename потрібен dest',
  })
  .refine(
    (args) => args.op !== 'rename' || (args.paths.length === 1 && isPlainName(args.dest ?? '')),
    {
      error: 'rename: один шлях і нова назва без теки',
    },
  );

const fileOpTool: PcTool<z.output<typeof fileOpSchema>> = {
  name: 'file_op',
  schema: fileOpSchema,
  async assess({ op, paths, dest }, ctx) {
    const missing = paths.filter((path) => !isNetworkPath(path) && !existsSync(path));
    if (missing.length > 0) throw new ToolInputError(`paths do not exist: ${missing.join('; ')}`);
    const count = await countFiles(paths, ctx.settings().massOperationFiles + 1);
    const verb = {
      move: 'Перемістити',
      copy: 'Скопіювати',
      rename: 'Перейменувати',
      recycle: 'Видалити в Кошик',
    }[op];
    const where = op === 'rename' ? ` на «${dest ?? ''}»` : dest ? ` у ${dest}` : '';
    const summary = `${verb} ${paths.length === 1 ? (paths[0] ?? '') : `${String(count)} файлів`}${where}`;
    let level = levelOf('file_op');
    let consequence: string | undefined;
    if (count > ctx.settings().massOperationFiles) {
      level = 'red';
      consequence = `понад ${String(ctx.settings().massOperationFiles)} файлів за раз`;
    }
    if (op === 'recycle' && paths.some(isNetworkPath)) {
      level = maxLevel(level, 'red');
      consequence = 'на мережевому диску Кошика немає — видалення назавжди';
    }
    return consequence
      ? { level, summary, command: paths.join('\n'), consequence }
      : { level, summary };
  },
  async run({ op, paths, dest }, ctx) {
    const destination =
      op === 'move' || op === 'copy' ? resolveFolder(dest ?? '', await known(ctx)) : (dest ?? null);
    if ((op === 'move' || op === 'copy') && destination === null)
      return fail(`unknown destination: ${dest ?? ''}`);
    const result = await fileOp(ctx.shell, op, paths, destination);
    const outcome = { done: result.done, failed: result.failed };
    if (result.done.length === 0)
      return { ...fail('nothing was done'), content: json({ ok: false, ...outcome }) };
    return result.undo
      ? { ok: true, content: json({ ok: true, ...outcome }), undo: result.undo }
      : ok(outcome);
  },
};

const runPowerShell: PcTool<{ script: string }> = {
  name: 'run_powershell',
  schema: z.object({ script: z.string().trim().min(1).max(4000) }),
  async assess({ script }, ctx) {
    const classification = await classifyScript(
      ctx.shell,
      script,
      ctx.settings().powershellAllowlist,
    );
    return classification.level === 'red'
      ? {
          level: 'red',
          summary: `PowerShell: ${classification.commands.join(', ') || 'скрипт'}`,
          command: script,
          consequence: classification.reasons.join('; '),
        }
      : {
          level: 'yellow',
          summary: `PowerShell: ${classification.commands.join(', ') || 'вираз'}`,
          command: script,
        };
  },
  async run({ script }, ctx) {
    const result = await ctx.shell.run(script);
    const output = result.output.length > 4000 ? `${result.output.slice(0, 4000)}…` : result.output;
    return result.ok
      ? ok({ output })
      : { ok: false, content: json({ ok: false, output, error: result.errors }) };
  },
};

const systemInfo: PcTool<{ kind: 'disk' | 'network' | 'battery' | 'time' | 'date' }> = {
  name: 'system_info',
  schema: z.object({ kind: z.enum(['disk', 'network', 'battery', 'time', 'date']) }),
  assess: async ({ kind }) =>
    Promise.resolve({
      level: levelOf('system_info'),
      summary: {
        disk: 'Вільне місце',
        network: 'Мережа',
        battery: 'Заряд',
        time: 'Час',
        date: 'Дата',
      }[kind],
    }),
  async run({ kind }, ctx) {
    const now = (ctx.now ?? (() => new Date()))();
    if (kind === 'time') return ok({ time: now.toTimeString().slice(0, 5) });
    if (kind === 'date') {
      const date = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      return ok({ date, weekday: now.toLocaleDateString('en-US', { weekday: 'long' }) });
    }
    const scripts = {
      disk: `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ drive = $_.DeviceID; freeGb = [Math]::Round($_.FreeSpace / 1GB, 1); sizeGb = [Math]::Round($_.Size / 1GB, 1) } })`,
      network: String.raw`$profiles = @{}; Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $profiles[$_.InterfaceAlias] = [string]$_.IPv4Connectivity }
ConvertTo-Json -Compress -InputObject @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notlike 'Loopback*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { @{ adapter = $_.InterfaceAlias; ipv4 = $_.IPAddress; connected = ($profiles[$_.InterfaceAlias] -eq 'Internet') } })`,
      battery: String.raw`$b = @(Get-CimInstance Win32_Battery); if ($b.Count -eq 0) { 'null' } else { @{ charge = $b[0].EstimatedChargeRemaining; charging = ($b[0].BatteryStatus -eq 2) } | ConvertTo-Json -Compress }`,
    } as const;
    const value = await runJson<unknown>(ctx.shell, scripts[kind]);
    return ok({ [kind]: value });
  },
};

const lockPc: PcTool<Record<string, never>> = {
  name: 'lock_pc',
  schema: z.object({}).strict(),
  assess: async () => Promise.resolve({ level: levelOf('lock_pc'), summary: 'Заблокувати ПК' }),
  async run(_args, ctx) {
    await runJson(
      ctx.shell,
      `Start-Process rundll32.exe -ArgumentList 'user32.dll,LockWorkStation'; '{}'`,
    );
    return ok({ locked: true });
  },
};

const TOOLS = [
  openApp,
  closeApp,
  volume,
  media,
  windowTool,
  openTarget,
  findFilesTool,
  fileOpTool,
  runPowerShell,
  systemInfo,
  lockPc,
] as const;
const BY_NAME = new Map<string, PcTool<unknown>>(
  TOOLS.map((tool) => [tool.name, tool as PcTool<unknown>]),
);

export function pcToolNames(): PcToolName[] {
  return TOOLS.map((tool) => tool.name);
}

function parseArgs(name: string, args: unknown): { tool: PcTool<unknown>; input: unknown } {
  const tool = BY_NAME.get(name);
  if (!tool) throw new ToolInputError(`unknown tool ${name}`);
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new ToolInputError(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || name}: ${issue.message}`)
        .join('; '),
    );
  }
  return { tool, input: parsed.data };
}

/** Рівень і опис дії до виконання — для політики core й картки підтвердження. */
export async function assessCall(name: string, args: unknown, ctx: PcContext): Promise<Assessment> {
  const { tool, input } = parseArgs(name, args);
  return tool.assess(input, ctx);
}

/** Виконання; помилки аргументів і PowerShell стають результатом з ok: false, а не винятком. */
export async function runCall(name: string, args: unknown, ctx: PcContext): Promise<ToolOutcome> {
  try {
    const { tool, input } = parseArgs(name, args);
    return await tool.run(input, ctx);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** «Скасуй» файлової дії з `undo_json` журналу. */
export async function undoCall(undo: FileUndo, ctx: PcContext): Promise<ToolOutcome> {
  const result = await undoFileOp(ctx.shell, undo);
  return result.done.length > 0
    ? ok({ done: result.done, failed: result.failed })
    : fail('nothing to undo');
}
