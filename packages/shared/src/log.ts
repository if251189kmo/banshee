// Журнал роботи (.claude/logic/01-architecture.md, «Діагностика»): події, коди помилок і тривалість —
// без тексту команд, транскриптів і секретів. Рядок — JSON; файли по sizeMb МБ, зберігаються files
// останніх. Пишуть core, desktop і MCP-сервери, кожен у свій файл. Лише для Node: окремий вхід
// `@banshee/shared/log`, щоб renderer не тягнув node:fs.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'error' | 'warn' | 'info';
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Log {
  error(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
}

export interface LogOptions {
  /** Тека `logs\` у теці Banshee; у розробці — `.data/logs`. */
  readonly dir: string;
  /** Хто пише: core, desktop, pc. Ім'я файлу — `<source>.log`. */
  readonly source: string;
  readonly files?: number;
  readonly sizeMb?: number;
  readonly now?: () => Date;
}

/** Рядки довші за це обрізаються: у журнал не має потрапити текст команди чи вивід програми. */
export const MAX_FIELD_LENGTH = 200;
const SECRET = /sk-ant-[\w-]+/g;
/** Службові поля рядка: поля події їх не перезаписують. */
const RESERVED = new Set(['t', 'level', 'src', 'event']);

function clean(value: string): string {
  const redacted = value.replace(SECRET, 'sk-ant-•••');
  return redacted.length > MAX_FIELD_LENGTH ? `${redacted.slice(0, MAX_FIELD_LENGTH)}…` : redacted;
}

export function createLog(options: LogOptions): Log {
  const files = Math.max(1, options.files ?? 5);
  const limit = Math.max(1024, (options.sizeMb ?? 5) * 1024 * 1024);
  const now = options.now ?? (() => new Date());
  const file = (index: number): string =>
    join(
      options.dir,
      index === 0 ? `${options.source}.log` : `${options.source}.${String(index)}.log`,
    );
  mkdirSync(options.dir, { recursive: true });

  /** Найстаріший файл замінюється наступним — окремого видалення немає; один файл — починається знову. */
  const rotate = (): void => {
    if (files === 1) {
      writeFileSync(file(0), '');
      return;
    }
    for (let index = files - 1; index >= 1; index -= 1) {
      if (existsSync(file(index - 1))) renameSync(file(index - 1), file(index));
    }
  };

  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const entry: Record<string, string | number | boolean | null> = {
      t: now().toISOString(),
      level,
      src: options.source,
      event: clean(event),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (!RESERVED.has(key)) entry[key] = typeof value === 'string' ? clean(value) : value;
    }
    const line = `${JSON.stringify(entry)}\n`;
    const current = file(0);
    if (existsSync(current) && statSync(current).size + Buffer.byteLength(line) > limit) {
      rotate();
    }
    appendFileSync(current, line, 'utf8');
  };

  return {
    error: (event, fields) => {
      write('error', event, fields);
    },
    warn: (event, fields) => {
      write('warn', event, fields);
    },
    info: (event, fields) => {
      write('info', event, fields);
    },
  };
}
