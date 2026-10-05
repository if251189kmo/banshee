// Стан сторінки з повідомлень core (.claude/logic/01-architecture.md, «Протокол core ↔ desktop»):
// з'єднання, стан ШІ, ходи з відповідями й діями, відкриті підтвердження. Чистий редуктор —
// перевіряється без браузера.
import type { AiState, CoreMessage } from '@banshee/shared';

type ActionMessage = Extract<CoreMessage, { type: 'action' }>;
type TurnDone = Extract<CoreMessage, { type: 'turn.done' }>;
export type ConfirmRequest = Extract<CoreMessage, { type: 'confirm.request' }>;

export interface TurnView {
  readonly id: string;
  /** Текст команди; хід з іншого клієнта (головний процес, голос) — без тексту. */
  readonly text: string | null;
  readonly say: string;
  readonly actions: readonly ActionMessage[];
  readonly done: TurnDone | null;
}

export interface CoreState {
  readonly connection: 'connecting' | 'ready';
  /** Скільки разів core відповів ready: після перезапуску core — ще раз. */
  readonly readyCount: number;
  readonly aiState: AiState | null;
  readonly turns: readonly TurnView[];
  readonly confirmations: readonly ConfirmRequest[];
  readonly notices: readonly string[];
}

export const INITIAL_STATE: CoreState = {
  connection: 'connecting',
  readyCount: 0,
  aiState: null,
  turns: [],
  confirmations: [],
  notices: [],
};

/** Скільки останніх ходів тримає сторінка. */
const MAX_TURNS = 50;

export type CoreEvent =
  | { readonly type: 'connect' }
  | { readonly type: 'sent'; readonly id: string; readonly text: string }
  | { readonly type: 'message'; readonly message: CoreMessage };

function updateTurn(
  turns: readonly TurnView[],
  id: string,
  change: (turn: TurnView) => TurnView,
): readonly TurnView[] {
  const existing = turns.find((turn) => turn.id === id);
  if (existing) return turns.map((turn) => (turn.id === id ? change(turn) : turn));
  const created = change({ id, text: null, say: '', actions: [], done: null });
  return [...turns, created].slice(-MAX_TURNS);
}

export function reduceCore(state: CoreState, event: CoreEvent): CoreState {
  if (event.type === 'connect') return { ...state, connection: 'connecting', confirmations: [] };
  if (event.type === 'sent') {
    return {
      ...state,
      turns: updateTurn(state.turns, event.id, (turn) => ({ ...turn, text: event.text })),
    };
  }
  const message = event.message;
  switch (message.type) {
    case 'ready':
      return {
        ...state,
        connection: 'ready',
        readyCount: state.readyCount + 1,
        aiState: message.aiState,
      };
    case 'ai.state':
      return { ...state, aiState: message.state };
    case 'say':
      return {
        ...state,
        turns: updateTurn(state.turns, message.turnId, (turn) => ({
          ...turn,
          say: turn.say ? `${turn.say}${message.text}` : message.text,
        })),
      };
    case 'action':
      return {
        ...state,
        turns: updateTurn(state.turns, message.turnId, (turn) => ({
          ...turn,
          actions: [...turn.actions.filter((a) => a.actionId !== message.actionId), message],
        })),
      };
    case 'turn.done':
      return {
        ...state,
        turns: updateTurn(state.turns, message.turnId, (turn) => ({ ...turn, done: message })),
      };
    case 'confirm.request':
      return { ...state, confirmations: [...state.confirmations, message] };
    case 'confirm.closed':
      return {
        ...state,
        confirmations: state.confirmations.filter((c) => c.requestId !== message.requestId),
      };
    case 'notice':
      return { ...state, notices: [...state.notices, message.text].slice(-5) };
    case 'reply':
    case 'turn.state':
    case 'settings.changed':
      return state;
  }
}
