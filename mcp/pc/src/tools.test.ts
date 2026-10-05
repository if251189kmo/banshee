// Інструменти без дій на ПК власника: PowerShell підробний — тест бачить згенерований скрипт і
// повертає заготовлену відповідь. Файлові операції — у тимчасовій теці.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POWERSHELL_ALLOWLIST, PC_TOOL_NAMES } from '@banshee/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunResult, Shell } from './powershell.ts';
import {
  assessCall,
  pcToolNames,
  runCall,
  ToolInputError,
  undoCall,
  type PcContext,
} from './tools.ts';

interface FakeShell extends Shell {
  readonly scripts: string[];
}

/** Відповідь — за першим правилом, чий шматок є в скрипті. */
function fakeShell(rules: readonly [string, unknown][] = []): FakeShell {
  const scripts: string[] = [];
  return {
    scripts,
    run: async (script: string): Promise<RunResult> => {
      scripts.push(script);
      const rule = rules.find(([part]) => script.includes(part));
      return Promise.resolve({
        ok: true,
        output: JSON.stringify(rule ? rule[1] : {}),
        errors: '',
        ms: 1,
      });
    },
    cancel: () => undefined,
    close: () => undefined,
  };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'banshee-pc-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function context(shell: Shell, extra: Partial<PcContext> = {}): PcContext {
  return {
    shell,
    settings: () => ({ powershellAllowlist: DEFAULT_POWERSHELL_ALLOWLIST, massOperationFiles: 20 }),
    ...extra,
  };
}
const parse = (content: string): Record<string, unknown> =>
  JSON.parse(content) as Record<string, unknown>;

describe('реєстр інструментів ПК', () => {
  it('усі 11 інструментів з 01-architecture.md', () => {
    expect(pcToolNames()).toEqual([...PC_TOOL_NAMES]);
  });

  it('невідомий інструмент і погані аргументи — помилка, а не виконання', async () => {
    const shell = fakeShell();
    expect(parse((await runCall('format_disk', {}, context(shell))).content)).toMatchObject({
      ok: false,
    });
    await expect(assessCall('volume', { level: 120 }, context(shell))).rejects.toThrow(
      ToolInputError,
    );
    await expect(assessCall('volume', {}, context(shell))).rejects.toThrow('рівно одне');
    expect(shell.scripts).toEqual([]);
  });
});

describe('програми, звук, медіа, вікна', () => {
  it('open_app: системна програма за AppID, назва — лише рядком у лапках', async () => {
    const shell = fakeShell([['Get-StartApps', { ok: true, name: 'Калькулятор' }]]);
    const outcome = await runCall('open_app', { app: 'Calculator' }, context(shell));
    expect(parse(outcome.content)).toEqual({ ok: true, opened: 'Калькулятор' });
    expect(shell.scripts[0]).toContain("'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'");
    await runCall('open_app', { app: "x'; Remove-Item C:\\ -Recurse; '" }, context(shell));
    expect(shell.scripts[1]).toContain("$q = 'x''; Remove-Item C:\\ -Recurse; '''");
    expect(await assessCall('open_app', { app: 'Telegram' }, context(shell))).toEqual({
      level: 'green',
      summary: 'Відкрити Telegram',
    });
  });

  it('close_app — 🟡; частину Windows не закриває', async () => {
    const shell = fakeShell([['CloseMainWindow', { closed: [], protected: ['explorer'] }]]);
    expect((await assessCall('close_app', { app: 'Chrome' }, context(shell))).level).toBe('yellow');
    expect(
      parse((await runCall('close_app', { app: 'Провідник' }, context(shell))).content),
    ).toMatchObject({
      ok: false,
      error: 'explorer is part of Windows and is never closed',
    });
  });

  it('volume: рівно одне з level, delta, mute; null — як відсутнє', async () => {
    const shell = fakeShell([['BansheeAudio', { level: 30, muted: false }]]);
    const outcome = await runCall('volume', { level: 30, delta: null, mute: null }, context(shell));
    expect(parse(outcome.content)).toEqual({ ok: true, level: 30, muted: false });
    expect(shell.scripts[0]).toContain(
      '[BansheeAudio]::Level = 0.3; if (30 -gt 0) { [BansheeAudio]::Muted = $false }',
    );
    await runCall('volume', { delta: -10 }, context(shell));
    expect(shell.scripts[1]).toContain('[BansheeAudio]::Level + -0.1');
    expect((await assessCall('volume', { mute: true }, context(shell))).summary).toBe(
      'Вимкнути звук',
    );
  });

  it('media і window', async () => {
    const shell = fakeShell([['ShowWindowAsync', { windows: 1 }]]);
    await runCall('media', { action: 'pause' }, context(shell));
    expect(shell.scripts[0]).toContain('[BansheeUser32]::Press(179)');
    await runCall('window', { action: 'minimize_all' }, context(shell));
    expect(shell.scripts[1]).toContain('MinimizeAll()');
    const outcome = await runCall(
      'window',
      { action: 'maximize', app: 'Google Chrome' },
      context(shell),
    );
    expect(parse(outcome.content)).toEqual({ ok: true, action: 'maximize', windows: 1 });
    expect(shell.scripts[2]).toContain('ShowWindowAsync($w, 3)');
  });

  it('lock_pc — без аргументів', async () => {
    const shell = fakeShell();
    await runCall('lock_pc', {}, context(shell));
    expect(shell.scripts[0]).toContain('LockWorkStation');
    await expect(assessCall('lock_pc', { now: true }, context(shell))).rejects.toThrow(
      ToolInputError,
    );
  });
});

describe('open_target', () => {
  it('сайт і сторінка налаштувань — 🟢; запуск програми чи скрипту — 🔴', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'setup.exe'), '');
    writeFileSync(join(dir, 'звіт.pdf'), '');
    const shell = fakeShell();
    expect(
      (await assessCall('open_target', { target: 'https://www.youtube.com' }, context(shell)))
        .level,
    ).toBe('green');
    expect(
      (await assessCall('open_target', { target: 'ms-settings:display' }, context(shell))).level,
    ).toBe('green');
    expect(
      (await assessCall('open_target', { target: join(dir, 'звіт.pdf') }, context(shell))).level,
    ).toBe('green');
    expect(
      await assessCall('open_target', { target: join(dir, 'setup.exe') }, context(shell)),
    ).toMatchObject({
      level: 'red',
      consequence: 'це запуск програми чи скрипту, а не відкриття файлу',
    });
    await expect(
      assessCall('open_target', { target: join(dir, 'нема.txt') }, context(shell)),
    ).rejects.toThrow('does not exist');
  });

  it('відома тека — справжній шлях з Windows', async () => {
    const dir = tempDir();
    const shell = fakeShell([
      [
        'shell:Downloads',
        { Downloads: dir, Desktop: dir, Documents: dir, Pictures: dir, Music: dir, Videos: dir },
      ],
    ]);
    await runCall('open_target', { target: 'Downloads' }, context(shell));
    expect(shell.scripts.at(-1)).toBe(`Start-Process -FilePath '${dir}'; '{}'`);
  });
});

describe('файли', () => {
  it('find_files: шаблон, дата змінення, найновіші першими', async () => {
    const home = tempDir();
    mkdirSync(join(home, 'Docs', 'node_modules'), { recursive: true });
    writeFileSync(join(home, 'Docs', 'старий.pdf'), 'a');
    writeFileSync(join(home, 'Docs', 'новий.pdf'), 'bb');
    writeFileSync(join(home, 'Docs', 'нотатки.txt'), 'c');
    writeFileSync(join(home, 'Docs', 'node_modules', 'пакет.pdf'), 'd');
    utimesSync(join(home, 'Docs', 'старий.pdf'), new Date(2026, 8, 1), new Date(2026, 8, 1));
    utimesSync(join(home, 'Docs', 'новий.pdf'), new Date(2026, 9, 4), new Date(2026, 9, 4));
    const ctx = context(fakeShell(), { home });
    const all = parse((await runCall('find_files', { query: '*.pdf' }, ctx)).content);
    expect((all.files as { path: string }[]).map((file) => file.path)).toEqual([
      join(home, 'Docs', 'новий.pdf'),
      join(home, 'Docs', 'старий.pdf'),
    ]);
    const recent = parse(
      (await runCall('find_files', { query: 'pdf', modified_after: '2026-10-01' }, ctx)).content,
    );
    expect((recent.files as { size: number }[]).map((file) => file.size)).toEqual([2]);
  });

  it('move і rename з «скасуй»; перезапису немає', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'A');
    writeFileSync(join(dir, 'b.txt'), 'B');
    mkdirSync(join(dir, 'Звіти'));
    writeFileSync(join(dir, 'Звіти', 'b.txt'), 'старий B');
    const ctx = context(fakeShell());
    const moved = await runCall(
      'file_op',
      { op: 'move', paths: [join(dir, 'a.txt'), join(dir, 'b.txt')], dest: join(dir, 'Звіти') },
      ctx,
    );
    expect(parse(moved.content)).toMatchObject({ ok: true, done: [join(dir, 'a.txt')] });
    expect(readFileSync(join(dir, 'Звіти', 'b.txt'), 'utf8')).toBe('старий B');
    expect(moved.undo).toEqual({
      kind: 'move',
      moves: [{ from: join(dir, 'Звіти', 'a.txt'), to: join(dir, 'a.txt') }],
    });
    await undoCall(moved.undo ?? { kind: 'move', moves: [] }, ctx);
    expect(existsSync(join(dir, 'a.txt'))).toBe(true);

    const renamed = await runCall(
      'file_op',
      { op: 'rename', paths: [join(dir, 'a.txt')], dest: 'договір.txt' },
      ctx,
    );
    expect(existsSync(join(dir, 'договір.txt'))).toBe(true);
    await undoCall(renamed.undo ?? { kind: 'move', moves: [] }, ctx);
    expect(existsSync(join(dir, 'a.txt'))).toBe(true);
    await expect(
      assessCall('file_op', { op: 'rename', paths: [join(dir, 'a.txt')], dest: 'x\\y.txt' }, ctx),
    ).rejects.toThrow();
  });

  it('видалення — лише в Кошик через Shell; «скасуй» відновлює з Кошика', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'зайве.txt'), '');
    const shell = fakeShell([
      ['SendToRecycleBin', { recycled: [join(dir, 'зайве.txt')] }],
      ['$Recycle.Bin', { restored: [join(dir, 'зайве.txt')], missing: [] }],
    ]);
    const outcome = await runCall(
      'file_op',
      { op: 'recycle', paths: [join(dir, 'зайве.txt')] },
      context(shell),
    );
    expect(shell.scripts[0]).toContain("DeleteFile($p, 'AllDialogs', 'SendToRecycleBin')");
    expect(outcome.undo).toEqual({ kind: 'restore', paths: [join(dir, 'зайве.txt')] });
    const restored = await undoCall(outcome.undo ?? { kind: 'restore', paths: [] }, context(shell));
    expect(parse(restored.content)).toMatchObject({ ok: true });
  });

  it('понад поріг масової операції й мережевий диск — 🔴', async () => {
    const dir = tempDir();
    const paths = ['1', '2', '3'].map((name) => {
      writeFileSync(join(dir, `${name}.txt`), '');
      return join(dir, `${name}.txt`);
    });
    const ctx = context(fakeShell(), {
      settings: () => ({ powershellAllowlist: [], massOperationFiles: 2 }),
    });
    expect(await assessCall('file_op', { op: 'recycle', paths }, ctx)).toMatchObject({
      level: 'red',
      consequence: 'понад 2 файлів за раз',
    });
    expect(
      await assessCall(
        'file_op',
        { op: 'recycle', paths: ['\\\\nas\\share\\x.txt'] },
        context(fakeShell()),
      ),
    ).toMatchObject({
      level: 'red',
      consequence: 'на мережевому диску Кошика немає — видалення назавжди',
    });
  });
});

describe('PowerShell і стан ПК', () => {
  it('run_powershell: рівень з AST, команда — на картці', async () => {
    const shell = fakeShell([
      [
        'ParseInput',
        {
          errors: [],
          commands: [{ name: 'Remove-Item', resolved: null, parameters: [], verb: null }],
          methods: [],
          redirections: 0,
        },
      ],
    ]);
    expect(
      await assessCall('run_powershell', { script: 'Remove-Item C:\\x' }, context(shell)),
    ).toMatchObject({
      level: 'red',
      command: 'Remove-Item C:\\x',
      consequence: 'Remove-Item — не в списку дозволених',
    });
  });

  it('system_info: час і дата — без PowerShell', async () => {
    const shell = fakeShell();
    const ctx = context(shell, { now: () => new Date(2026, 9, 5, 9, 7) });
    expect(parse((await runCall('system_info', { kind: 'time' }, ctx)).content)).toEqual({
      ok: true,
      time: '09:07',
    });
    expect(parse((await runCall('system_info', { kind: 'date' }, ctx)).content)).toEqual({
      ok: true,
      date: '2026-10-05',
      weekday: 'Monday',
    });
    expect(shell.scripts).toEqual([]);
  });
});
