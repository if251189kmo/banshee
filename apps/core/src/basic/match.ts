// Розпізнавання рутини без LLM (.claude/logic/04-memory.md, «Рутини»): слова команди
// вирівнюються з шаблоном — як відстань редагування, але по словах. Слово шаблону, схоже на слово
// команди, коштує 1 − схожість; зайве слово команди — 1 (ввічливе «будь ласка» — 0,1); пропущене
// слово шаблону — 1. Слот бере 1–3 слова й має бути числом 0–100 або назвою зі словника.
// Схожість = 1 − ціна / кількість кроків вирівнювання. Рутина впізнана, якщо схожість ≥ 0,85 і
// друга найкраща рутина гірша щонайменше на 0,05; інакше — сумнів, і команда йде в Haiku.
import { findAlias, type Alias, type AliasKind } from './aliases.ts';
import { BUILTIN_ROUTINES, type Routine, type RoutineStep, type SlotType } from './builtins.ts';
import { FILLER_WORDS, similarity, words } from './text.ts';

export const MATCH_THRESHOLD = 0.85;
export const AMBIGUITY_MARGIN = 0.05;
const FILLER_COST = 0.1;
const MAX_NAME_WORDS = 3;

type Token = { readonly word: string } | { readonly slot: SlotType };
type SlotValues = Readonly<Partial<Record<SlotType, string | number>>>;

const SLOT = /^\{(n|app|site|folder)\}$/;

function parseTemplate(template: string): Token[] {
  return template.split(' ').flatMap((part): Token[] => {
    const slot = SLOT.exec(part)?.[1];
    if (slot) return [{ slot: slot as SlotType }];
    return words(part).map((word) => ({ word }));
  });
}

const PARSED = new Map<string, Token[]>();
function tokens(template: string): Token[] {
  let parsed = PARSED.get(template);
  if (!parsed) {
    parsed = parseTemplate(template);
    PARSED.set(template, parsed);
  }
  return parsed;
}

interface Cell {
  readonly cost: number;
  readonly ops: number;
  readonly slots: SlotValues;
}

type SlotHit = { value: string | number; cost: number } | null;

/** Значення слота зі слів команди та «ціна» розпізнавання назви: 0 — точний збіг. */
function slotValue(type: SlotType, span: readonly string[], owner: readonly Alias[]): SlotHit {
  if (type === 'n') {
    const [word] = span;
    if (span.length !== 1 || word === undefined || !/^\d{1,3}$/.test(word)) return null;
    const value = Number(word);
    return value <= 100 ? { value, cost: 0 } : null;
  }
  const match = findAlias(span.join(' '), type satisfies AliasKind, owner);
  return match ? { value: match.alias.target, cost: 1 - match.score } : null;
}

/** Найкраще вирівнювання шаблону з командою: схожість 0…1 і значення слотів. */
export function alignTemplate(
  template: string,
  command: readonly string[],
  owner: readonly Alias[] = [],
  cache: Map<string, SlotHit> = new Map<string, SlotHit>(),
): { score: number; slots: SlotValues } | null {
  const pattern = tokens(template);
  /** Ті самі слова під тим самим слотом трапляються в багатьох шаблонах — словник перебирається раз. */
  const slotOf = (type: SlotType, from: number, span: number): SlotHit => {
    const key = `${type}:${String(from)}:${String(span)}`;
    if (!cache.has(key)) cache.set(key, slotValue(type, command.slice(from, from + span), owner));
    return cache.get(key) ?? null;
  };
  const rows = pattern.length + 1;
  const cols = command.length + 1;
  const table: (Cell | null)[] = Array.from({ length: rows * cols }, () => null);
  const at = (i: number, j: number): Cell | null => table[i * cols + j] ?? null;
  const offer = (i: number, j: number, from: Cell, cost: number, slots = from.slots): void => {
    const next = { cost: from.cost + cost, ops: from.ops + 1, slots };
    const current = at(i, j);
    if (current === null || next.cost < current.cost) table[i * cols + j] = next;
  };
  table[0] = { cost: 0, ops: 0, slots: {} };
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const cell = at(i, j);
      if (cell === null) continue;
      const word = command[j];
      if (word !== undefined) offer(i, j + 1, cell, FILLER_WORDS.has(word) ? FILLER_COST : 1);
      const token = pattern[i];
      if (token === undefined) continue;
      if ('word' in token) {
        offer(i + 1, j, cell, 1);
        if (word !== undefined) offer(i + 1, j + 1, cell, 1 - similarity(token.word, word));
        continue;
      }
      const maxSpan = token.slot === 'n' ? 1 : MAX_NAME_WORDS;
      for (let span = 1; span <= maxSpan && j + span <= command.length; span += 1) {
        const value = slotOf(token.slot, j, span);
        if (value) {
          offer(i + 1, j + span, cell, value.cost, { ...cell.slots, [token.slot]: value.value });
        }
      }
    }
  }
  const end = at(rows - 1, cols - 1);
  if (end === null || end.ops === 0) return null;
  return { score: 1 - end.cost / end.ops, slots: end.slots };
}

function fill(value: unknown, slots: SlotValues): unknown {
  if (typeof value !== 'string') return value;
  const slot = SLOT.exec(value)?.[1] as SlotType | undefined;
  return slot === undefined ? value : slots[slot];
}

export interface RoutineMatch {
  readonly routine: Routine;
  readonly score: number;
  readonly steps: readonly RoutineStep[];
}

export type MatchResult =
  | { readonly kind: 'match'; readonly match: RoutineMatch }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly RoutineMatch[] }
  | { readonly kind: 'none'; readonly best: RoutineMatch | null };

/** Найкраща рутина для команди: вбудовані й рутини власника, назви — зі словника власника. */
export function matchRoutine(
  text: string,
  options: { readonly routines?: readonly Routine[]; readonly aliases?: readonly Alias[] } = {},
): MatchResult {
  const command = words(text);
  const routines = options.routines ?? BUILTIN_ROUTINES;
  const cache = new Map<string, SlotHit>();
  const ranked: RoutineMatch[] = [];
  for (const routine of routines) {
    let best: { score: number; slots: SlotValues } | null = null;
    for (const template of routine.templates) {
      const aligned = alignTemplate(template, command, options.aliases, cache);
      if (aligned && (best === null || aligned.score > best.score)) best = aligned;
    }
    if (best === null) continue;
    const slots = best.slots;
    const steps = routine.steps.map((item) => ({
      tool: item.tool,
      args: Object.fromEntries(
        Object.entries(item.args).map(([key, value]) => [key, fill(value, slots)]),
      ),
    }));
    ranked.push({ routine, score: best.score, steps });
  }
  ranked.sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  if (!first || first.score < MATCH_THRESHOLD) return { kind: 'none', best: first ?? null };
  if (second && second.score > first.score - AMBIGUITY_MARGIN) {
    return { kind: 'ambiguous', candidates: [first, second] };
  }
  return { kind: 'match', match: first };
}
