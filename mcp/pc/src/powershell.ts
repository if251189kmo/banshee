// Постійний процес PowerShell (.claude/logic/01-architecture.md, «Процеси»): запуск powershell.exe
// на кожну дію коштує сотні мілісекунд, тож один процес живе весь час роботи mcp/pc.
// Скрипт іде одним рядком у base64; вивід і помилки повертаються JSON-ом, кінець — унікальна мітка.
// Скрипт, що завис, вбивається разом із процесом; наступний виклик запускає новий процес.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface RunResult {
  /** Скрипт завершився без помилок PowerShell. */
  readonly ok: boolean;
  /** Звичайний вивід, як його показала б консоль. */
  readonly output: string;
  /** Помилки PowerShell, по одній у рядку. */
  readonly errors: string;
  readonly ms: number;
}

export interface Shell {
  run(script: string, options?: { readonly timeoutMs?: number }): Promise<RunResult>;
  /** «Стоп»: вбити поточний скрипт разом із процесом. */
  cancel(): void;
  close(): void;
}

/** Повністю зависла команда — 30 с (01-architecture.md). */
export const DEFAULT_TIMEOUT_MS = 30_000;

const PRELUDE =
  "$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'; " +
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false';

/** Один рядок для stdin: виконати скрипт, розділити вивід і помилки, надрукувати JSON і мітку. */
export function wrapScript(script: string, marker: string): string {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return [
    `$__b = [scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`,
    '$__all = @(try { & $__b 2>&1 } catch { $_ })',
    '$__err = @($__all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] })',
    '$__out = @($__all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })',
    '$__r = @{ out = ($__out | Out-String -Width 4096); err = (($__err | ForEach-Object { $_.ToString() }) -join "`n") }',
    "[Console]::Out.WriteLine(''); [Console]::Out.WriteLine(($__r | ConvertTo-Json -Compress))",
    `[Console]::Out.WriteLine('${marker}')`,
  ].join('; ');
}

function parseResult(text: string): { output: string; errors: string } {
  const line = text.trim().split(/\r?\n/).at(-1) ?? '';
  try {
    const parsed = JSON.parse(line) as { out?: unknown; err?: unknown };
    return {
      output: typeof parsed.out === 'string' ? parsed.out.replace(/\s+$/, '') : '',
      errors: typeof parsed.err === 'string' ? parsed.err : '',
    };
  } catch {
    return { output: '', errors: `Незрозумілий вивід PowerShell: ${line.slice(0, 200)}` };
  }
}

export function createShell(options: { readonly exe?: string } = {}): Shell {
  const exe = options.exe ?? 'powershell.exe';
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = '';
  let waiting: ((text: string | null) => void) | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const kill = (): void => {
    const current = child;
    child = null;
    buffer = '';
    if (current && current.exitCode === null) current.kill();
    const resolve = waiting;
    waiting = null;
    resolve?.(null);
  };

  const start = (): ChildProcessWithoutNullStreams => {
    const process = spawn(
      exe,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true },
    );
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const resolve = waiting;
      if (resolve) resolve(buffer);
    });
    process.on('exit', () => {
      if (child === process) kill();
    });
    process.stdin.write(`${PRELUDE}\n`);
    return process;
  };

  const runOne = async (script: string, timeoutMs: number): Promise<RunResult> => {
    const started = performance.now();
    child ??= start();
    const process = child;
    const marker = `<<BANSHEE-END-${randomUUID()}>>`;
    buffer = '';
    const done = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        kill();
      }, timeoutMs);
      waiting = (text) => {
        if (text === null) {
          clearTimeout(timer);
          resolve(null);
          return;
        }
        const end = text.indexOf(marker);
        if (end < 0) return;
        clearTimeout(timer);
        waiting = null;
        buffer = text.slice(end + marker.length);
        resolve(text.slice(0, end));
      };
    });
    process.stdin.write(`${wrapScript(script, marker)}\n`);
    const text = await done;
    const ms = Math.round(performance.now() - started);
    if (text === null) {
      return { ok: false, output: '', errors: 'Скрипт не завершився вчасно й зупинений', ms };
    }
    const { output, errors } = parseResult(text);
    return { ok: errors === '', output, errors, ms };
  };

  return {
    run(script, runOptions = {}) {
      const result = queue.then(() => runOne(script, runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS));
      queue = result.catch(() => undefined);
      return result;
    },
    cancel: kill,
    close: kill,
  };
}
