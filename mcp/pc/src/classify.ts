// Рівень довільного PowerShell (.claude/logic/05-safety.md, «Правила»): скрипт розбирає парсер
// PowerShell (AST) — нічого не виконується. Усі команди зі списку дозволених → 🟡, будь-що інше → 🔴.
// Завжди 🔴: Invoke-Expression, -EncodedCommand, завантаження з мережі, Start-Process -Verb RunAs,
// виклик команди зі змінної, запис у файл перенаправленням, виклики методів .NET поза безпечними.
import type { ActionLevel } from '@banshee/shared';
import type { Shell } from './powershell.ts';

/** Завжди 🔴, навіть якщо власник додав їх до списку дозволених. */
export const ALWAYS_RED_COMMANDS: ReadonlySet<string> = new Set([
  'invoke-expression',
  'invoke-webrequest',
  'invoke-restmethod',
  'start-bitstransfer',
  'invoke-command',
  'new-object',
  'add-type',
  'set-executionpolicy',
]);

/** Методи, які лише перетворюють значення: `(Get-Date).AddDays(-1)`, `$_.Name.ToUpper()`. */
const SAFE_METHODS: ReadonlySet<string> = new Set(
  [
    'ToString',
    'ToUpper',
    'ToLower',
    'Trim',
    'TrimEnd',
    'TrimStart',
    'Split',
    'Replace',
    'Substring',
    'Contains',
    'StartsWith',
    'EndsWith',
    'IndexOf',
    'PadLeft',
    'PadRight',
    'AddDays',
    'AddHours',
    'AddMinutes',
    'AddSeconds',
    'AddMonths',
    'AddYears',
    'ToShortDateString',
    'ToLongDateString',
    'ToShortTimeString',
    'GetType',
    'Equals',
    'CompareTo',
    'Round',
  ].map((name) => name.toLowerCase()),
);

/** Що знайшов парсер; рахує скрипт `PARSE_SCRIPT` у PowerShell. */
export interface ParsedScript {
  readonly errors: readonly string[];
  readonly commands: readonly {
    readonly name: string | null;
    /** Повна назва для аліасу: `gci` → `Get-ChildItem`. */
    readonly resolved: string | null;
    readonly parameters: readonly string[];
    /** Значення `-Verb`, якщо є. */
    readonly verb: string | null;
  }[];
  readonly methods: readonly string[];
  readonly redirections: number;
}

export interface Classification {
  readonly level: ActionLevel;
  /** Команди скрипту — для картки підтвердження. */
  readonly commands: readonly string[];
  /** Чому 🔴, українською; для 🟡 — порожньо. */
  readonly reasons: readonly string[];
}

/** PowerShell, що розбирає скрипт з base64 і друкує ParsedScript JSON-ом. */
export function parseScript(script: string): string {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return String.raw`
$src = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)
$commands = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object {
  $name = $_.GetCommandName()
  $resolved = $null
  if ($name) { $alias = Get-Alias -Name $name -ErrorAction SilentlyContinue; if ($alias) { $resolved = $alias.Definition } }
  $elements = @($_.CommandElements)
  $parameters = @($elements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] } | ForEach-Object { $_.ParameterName })
  $verb = $null
  for ($i = 0; $i -lt $elements.Count - 1; $i++) {
    $e = $elements[$i]
    if ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -like 'Verb*') { $verb = $elements[$i + 1].Extent.Text.Trim('''"') }
  }
  @{ name = $name; resolved = $resolved; parameters = $parameters; verb = $verb }
})
$methods = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true) | ForEach-Object { $_.Member.Extent.Text })
$redirections = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst] }, $true)).Count
@{ errors = @($errors | ForEach-Object { $_.Message }); commands = $commands; methods = $methods; redirections = $redirections } | ConvertTo-Json -Depth 5 -Compress
`;
}

const lower = (value: string): string => value.toLowerCase();
/** -EncodedCommand і його скорочення: -e, -ec, -enc, -encoded… */
const isEncoded = (parameter: string): boolean =>
  parameter.toLowerCase() === 'ec' || 'encodedcommand'.startsWith(parameter.toLowerCase());

/** Рівень за розібраним скриптом і списком дозволених команд (налаштування власника). */
export function classifyParsed(parsed: ParsedScript, allowlist: readonly string[]): Classification {
  const allowed = new Set(allowlist.map(lower));
  const reasons: string[] = [];
  const commands: string[] = [];
  if (parsed.errors.length > 0) reasons.push('скрипт з помилками синтаксису');
  if (parsed.commands.length === 0 && parsed.errors.length === 0 && parsed.methods.length === 0) {
    // Лише вирази й змінні: «1 + 1», «$PSVersionTable» — нічого не змінюють.
    return { level: 'yellow', commands, reasons };
  }
  for (const command of parsed.commands) {
    if (command.name === null) {
      reasons.push('команда зі змінної — її не перевірити заздалегідь');
      continue;
    }
    const name = command.resolved ?? command.name;
    commands.push(name);
    if (ALWAYS_RED_COMMANDS.has(lower(name))) reasons.push(`${name} — завжди лише клік`);
    else if (!allowed.has(lower(name))) reasons.push(`${name} — не в списку дозволених`);
    if (command.parameters.some(isEncoded)) {
      reasons.push('-EncodedCommand');
    }
    if (lower(name) === 'start-process' && command.verb && lower(command.verb) === 'runas') {
      reasons.push('права адміністратора (-Verb RunAs)');
    }
  }
  for (const method of parsed.methods) {
    if (!SAFE_METHODS.has(lower(method))) reasons.push(`виклик методу .NET ${method}()`);
  }
  if (parsed.redirections > 0) reasons.push('запис у файл перенаправленням');
  return { level: reasons.length === 0 ? 'yellow' : 'red', commands, reasons };
}

export async function classifyScript(
  shell: Shell,
  script: string,
  allowlist: readonly string[],
): Promise<Classification> {
  const result = await shell.run(parseScript(script), { timeoutMs: 10_000 });
  if (!result.ok) {
    return {
      level: 'red',
      commands: [],
      reasons: [`скрипт не вдалося розібрати: ${result.errors}`],
    };
  }
  const raw = JSON.parse(result.output) as {
    errors: string[] | null;
    commands: ParsedScript['commands'] | null;
    methods: string[] | null;
    redirections: number;
  };
  return classifyParsed(
    {
      errors: raw.errors ?? [],
      commands: raw.commands ?? [],
      methods: raw.methods ?? [],
      redirections: raw.redirections,
    },
    allowlist,
  );
}
