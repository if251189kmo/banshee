// Буфер обміну Windows через Windows PowerShell 5.1 (є в Windows 10 і 11). Вміст не друкується.
import { execFileSync } from 'node:child_process';

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];

export function readClipboard(): string {
  return execFileSync('powershell.exe', [...POWERSHELL_ARGS, 'Get-Clipboard -Raw'], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

/** Замінює вміст буфера пробілом, щоб ключ не лишився там після збереження. */
export function clearClipboard(): void {
  execFileSync('powershell.exe', [...POWERSHELL_ARGS, "Set-Clipboard -Value ' '"], {
    windowsHide: true,
  });
}
