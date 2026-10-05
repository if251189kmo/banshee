// Хід — одна команда власника й усе, що Banshee на неї зробив (.claude/logic/04-memory.md, `turns`).

/** Звідки команда: голос або текст в оверлеї. */
export const TURN_SOURCES = ['voice', 'text'] as const;
export type TurnSource = (typeof TURN_SOURCES)[number];

/** Хто виконав хід: рутина без LLM, Haiku, Sonnet, Claude Code або ніхто — базовий режим. */
export const TURN_ROUTES = ['routine', 'llm', 'escalation', 'code', 'none'] as const;
export type TurnRoute = (typeof TURN_ROUTES)[number];

export const TURN_OUTCOMES = [
  'success',
  'failed',
  'corrected',
  'rephrased',
  'cancelled',
  'no_ai',
] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/** Стан ходу для трею й оверлея (09-ui.md, «Стани»). */
export const TURN_STATES = ['thinking', 'acting', 'speaking', 'done'] as const;
export type TurnState = (typeof TURN_STATES)[number];
