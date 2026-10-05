// Маршрутизація команди (.claude/logic/03-brain.md, «Маршрутизація»): керування — одразу; рутина,
// впізнана впевнено, — локально без LLM; решта — у Haiku, якщо ШІ активний, інакше базовий режим
// відповідає чому. У базовому режимі маршрутизатор ніколи не веде в LLM — 0 запитів до API.
import { AI_STATE_TEXT, type AiState } from '@banshee/shared';
import type { Alias } from './aliases.ts';
import { BUILTIN_ROUTINES, CONTROL_COMMANDS, type Routine } from './builtins.ts';
import { matchRoutine, type RoutineMatch } from './match.ts';
import { FILLER_WORDS, normalize, words } from './text.ts';

export type ControlCommand = 'stop' | 'undo' | 'new_episode';

export type Route =
  | { readonly kind: 'control'; readonly command: ControlCommand }
  | { readonly kind: 'routine'; readonly match: RoutineMatch }
  | { readonly kind: 'llm'; readonly reason: 'no_routine' | 'ambiguous' }
  | { readonly kind: 'none'; readonly state: AiState; readonly reply: string };

const CONTROL = new Map(
  Object.entries(CONTROL_COMMANDS).map(([phrase, command]) => [normalize(phrase), command]),
);

export interface RouteContext {
  readonly ai: AiState;
  /** Активні рутини власника й вивчені; вбудовані додаються самі. */
  readonly routines?: readonly Routine[];
  readonly aliases?: readonly Alias[];
}

export function route(text: string, context: RouteContext): Route {
  const meaningful = words(text)
    .filter((word) => !FILLER_WORDS.has(word))
    .join(' ');
  const control = CONTROL.get(meaningful);
  if (control) return { kind: 'control', command: control };
  const result = matchRoutine(text, {
    routines: [...BUILTIN_ROUTINES, ...(context.routines ?? [])],
    ...(context.aliases ? { aliases: context.aliases } : {}),
  });
  if (result.kind === 'match') return { kind: 'routine', match: result.match };
  if (context.ai === 'active') {
    return { kind: 'llm', reason: result.kind === 'ambiguous' ? 'ambiguous' : 'no_routine' };
  }
  return { kind: 'none', state: context.ai, reply: AI_STATE_TEXT[context.ai].reply };
}
