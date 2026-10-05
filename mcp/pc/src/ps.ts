// Допоміжне для скриптів PowerShell: значення з команди потрапляють у скрипт лише як рядок в
// одинарних лапках — без підстановок і виконання. Результат скрипт друкує JSON-ом.
import type { Shell } from './powershell.ts';

/** Рядок PowerShell в одинарних лапках: `it's` → `'it''s'`. */
export function psQuote(value: string): string {
  return `'${value.replaceAll('\0', '').replaceAll("'", "''")}'`;
}

/** Масив рядків PowerShell: `@('a', 'b')`. */
export function psArray(values: readonly string[]): string {
  return `@(${values.map(psQuote).join(', ')})`;
}

export class PowerShellError extends Error {}

/** Виконує скрипт, що друкує JSON, і повертає розібране значення. */
export async function runJson<T>(shell: Shell, script: string, timeoutMs?: number): Promise<T> {
  const result = await shell.run(script, timeoutMs === undefined ? {} : { timeoutMs });
  if (!result.ok) throw new PowerShellError(result.errors);
  try {
    return JSON.parse(result.output) as T;
  } catch {
    throw new PowerShellError(`Незрозумілий вивід: ${result.output.slice(0, 200)}`);
  }
}
