// Еталонний набір `evals/commands.json` (07-quality.md): команда → очікувані виклики інструментів.
// Формат перевіряється до прогону, щоб помилка в наборі не коштувала запитів до API.
import { findTool } from '../tools.ts';
import { parseLocalDateTime, type LocalDateTime, type TurnSource } from '../turn.ts';

export const CASE_KINDS = ['single', 'multi', 'clarify', 'refuse'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/**
 * Очікуване значення аргументу:
 * - рядок — дорівнює без урахування регістру, `/` і `\` однакові;
 * - число чи `true`/`false` — дорівнює точно;
 * - `null` — аргументу немає;
 * - масив рядків — фактичний масив містить кожен;
 * - `{ "oneOf": [...] }`, `{ "contains": "..." | [...] }`, `{ "pattern": "регулярний вираз" }`,
 *   `{ "min": n, "max": n }`.
 */
export type ArgMatcher =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | { readonly oneOf: readonly string[] }
  | { readonly contains: string | readonly string[] }
  | { readonly pattern: string }
  | { readonly min?: number; readonly max?: number };

export interface ExpectedCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, ArgMatcher>>;
}

export interface EvalCase {
  readonly id: string;
  readonly kind: CaseKind;
  readonly text: string;
  readonly source: TurnSource;
  /** Очікувані виклики; для `clarify` і `refuse` — порожньо. */
  readonly calls: readonly ExpectedCall[];
  /** Інші прийнятні набори викликів. */
  readonly alt: readonly (readonly ExpectedCall[])[];
  /** Чи важливий порядок викликів. */
  readonly ordered: boolean;
  /** Відповіді заглушок для цієї команди: назва інструмента → результат. */
  readonly stubs: Readonly<Record<string, unknown>>;
  readonly note?: string;
}

export interface Dataset {
  /** Дата й час, які бачить модель у кожному ході. */
  readonly now: LocalDateTime;
  readonly cases: readonly EvalCase[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNumberOrAbsent(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isArgMatcher(value: unknown): value is ArgMatcher {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (isStringArray(value)) return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === 'oneOf') return isStringArray(value.oneOf);
  if (keys.length === 1 && keys[0] === 'contains') {
    return typeof value.contains === 'string' || isStringArray(value.contains);
  }
  if (keys.length === 1 && keys[0] === 'pattern') return typeof value.pattern === 'string';
  return (
    keys.length > 0 &&
    keys.every((key) => key === 'min' || key === 'max') &&
    isNumberOrAbsent(value.min) &&
    isNumberOrAbsent(value.max)
  );
}

function parseCall(value: unknown, where: string, problems: string[]): ExpectedCall | undefined {
  if (!isRecord(value) || typeof value.tool !== 'string') {
    problems.push(`${where}: очікується { "tool": "...", "args": {...} }`);
    return undefined;
  }
  const tool = findTool(value.tool);
  if (!tool) {
    problems.push(`${where}: невідомий інструмент ${value.tool}`);
    return undefined;
  }
  const rawArgs = value.args ?? {};
  if (!isRecord(rawArgs)) {
    problems.push(`${where}: args має бути об'єктом`);
    return undefined;
  }
  const { properties } = tool.definition.input_schema;
  const known = isRecord(properties) ? Object.keys(properties) : [];
  const args: Record<string, ArgMatcher> = {};
  for (const [name, matcher] of Object.entries(rawArgs)) {
    if (!known.includes(name)) {
      problems.push(`${where}: ${value.tool} не має аргументу ${name}`);
    } else if (!isArgMatcher(matcher)) {
      problems.push(`${where}: незрозуміле очікування для ${name}`);
    } else {
      args[name] = matcher;
    }
  }
  return { tool: value.tool, args };
}

function parseCalls(value: unknown, where: string, problems: string[]): ExpectedCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where}: очікується масив викликів`);
    return [];
  }
  return value.flatMap(
    (item, index) => parseCall(item, `${where}[${String(index)}]`, problems) ?? [],
  );
}

function parseCase(value: unknown, index: number, problems: string[]): EvalCase | undefined {
  const where = `cases[${String(index)}]`;
  if (!isRecord(value)) {
    problems.push(`${where}: очікується об'єкт`);
    return undefined;
  }
  const { id, kind, text, source = 'voice', ordered = false, stubs = {}, note } = value;
  const label = typeof id === 'string' ? id : where;
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    problems.push(`${where}: id — латиниця в нижньому регістрі, цифри й дефіси`);
  }
  if (typeof kind !== 'string' || !(CASE_KINDS as readonly string[]).includes(kind)) {
    problems.push(`${label}: kind — одне з ${CASE_KINDS.join(', ')}`);
  }
  if (typeof text !== 'string' || text.trim() === '') problems.push(`${label}: немає text`);
  if (source !== 'voice' && source !== 'text') problems.push(`${label}: source — voice або text`);
  if (typeof ordered !== 'boolean') problems.push(`${label}: ordered — true або false`);
  if (!isRecord(stubs)) problems.push(`${label}: stubs має бути об'єктом`);
  if (note !== undefined && typeof note !== 'string') problems.push(`${label}: note — рядок`);

  const calls = parseCalls(value.calls, `${label}.calls`, problems);
  const rawAlt = value.alt ?? [];
  const alt = Array.isArray(rawAlt)
    ? rawAlt.map((set, setIndex) => parseCalls(set, `${label}.alt[${String(setIndex)}]`, problems))
    : [];
  if (!Array.isArray(rawAlt)) problems.push(`${label}: alt — масив наборів викликів`);

  const acts = kind === 'single' || kind === 'multi';
  if (acts && calls.length === 0) problems.push(`${label}: для ${kind} потрібні calls`);
  if (!acts && (calls.length > 0 || alt.length > 0)) {
    problems.push(`${label}: для ${String(kind)} викликів не має бути`);
  }

  if (
    typeof id !== 'string' ||
    typeof kind !== 'string' ||
    typeof text !== 'string' ||
    (source !== 'voice' && source !== 'text') ||
    typeof ordered !== 'boolean' ||
    !isRecord(stubs)
  ) {
    return undefined;
  }
  return {
    id,
    kind: kind as CaseKind,
    text,
    source,
    calls,
    alt,
    ordered,
    stubs,
    ...(typeof note === 'string' ? { note } : {}),
  };
}

/** Перевіряє набір і повертає його; помилка перелічує всі проблеми одразу. */
export function parseDataset(raw: unknown): Dataset {
  const problems: string[] = [];
  if (!isRecord(raw) || typeof raw.now !== 'string' || !Array.isArray(raw.cases)) {
    throw new Error('Набір: очікується { "now": "2026-10-05T10:30", "cases": [...] }');
  }
  const now = parseLocalDateTime(raw.now);
  const cases = raw.cases.flatMap((item, index) => parseCase(item, index, problems) ?? []);

  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) problems.push(`${item.id}: id повторюється`);
    seen.add(item.id);
  }
  if (problems.length > 0) throw new Error(`Набір має помилки:\n- ${problems.join('\n- ')}`);
  return { now, cases };
}

/**
 * Підміняє тексти команд розпізнаними з голосу (крок 0.3): так видно, чи Haiku робить ту саму дію,
 * коли текст прийшов від Whisper, а не з набору. Команди без розпізнаного тексту випадають.
 */
export function withTexts(cases: readonly EvalCase[], raw: unknown): EvalCase[] {
  if (!isRecord(raw) || !Object.values(raw).every((text) => typeof text === 'string')) {
    throw new Error('Тексти: очікується { "id": "розпізнаний текст", … }');
  }
  const unknown = Object.keys(raw).filter((id) => !cases.some((item) => item.id === id));
  if (unknown.length > 0) throw new Error(`Тексти: немає команд з id ${unknown.join(', ')}`);
  return cases.flatMap((item) => {
    const text = raw[item.id];
    return typeof text === 'string' ? [{ ...item, text, source: 'voice' as const }] : [];
  });
}

/** Очікувані виклики поза набором команд (сценарії ін'єкцій); помилка формату — виняток. */
export function parseExpectedCalls(value: unknown, where: string): ExpectedCall[] {
  const problems: string[] = [];
  const calls = parseCalls(value, where, problems);
  if (problems.length > 0) throw new Error(`Набір: ${problems.join('; ')}`);
  return calls;
}
