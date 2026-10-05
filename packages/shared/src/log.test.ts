import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLog, MAX_FIELD_LENGTH } from './log.ts';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'banshee-log-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lines = (file: string): Record<string, unknown>[] =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('журнал роботи', () => {
  it('пише рядок JSON з часом, рівнем, джерелом і полями', () => {
    const dir = tempDir();
    const log = createLog({ dir, source: 'core', now: () => new Date('2026-10-05T10:30:00Z') });
    log.info('db.migrated', { from: 0, to: 1, ms: 12 });
    expect(lines(join(dir, 'core.log'))).toEqual([
      {
        t: '2026-10-05T10:30:00.000Z',
        level: 'info',
        src: 'core',
        event: 'db.migrated',
        from: 0,
        to: 1,
        ms: 12,
      },
    ]);
  });

  it('ховає ключі API, обрізає довгі рядки й не дає підмінити службові поля', () => {
    const dir = tempDir();
    const log = createLog({ dir, source: 'core' });
    log.error('api.failed', {
      detail: 'ключ sk-ant-api03-abcDEF_123 не діє',
      output: 'x'.repeat(1000),
      level: 'info',
    });
    const [entry] = lines(join(dir, 'core.log'));
    expect(entry?.detail).toBe('ключ sk-ant-••• не діє');
    expect(String(entry?.output)).toHaveLength(MAX_FIELD_LENGTH + 1);
    expect(entry?.level).toBe('error');
  });

  it('файл понад ліміт стає core.1.log; зберігаються files останніх', () => {
    const dir = tempDir();
    const log = createLog({ dir, source: 'core', files: 3, sizeMb: 0.01 });
    const big = 'x'.repeat(MAX_FIELD_LENGTH);
    for (let index = 0; index < 200; index += 1) log.info('tick', { index, big });
    expect(existsSync(join(dir, 'core.log'))).toBe(true);
    expect(existsSync(join(dir, 'core.1.log'))).toBe(true);
    expect(existsSync(join(dir, 'core.2.log'))).toBe(true);
    expect(existsSync(join(dir, 'core.3.log'))).toBe(false);
    const newest = lines(join(dir, 'core.log')).at(-1);
    expect(newest?.index).toBe(199);
  });
});
