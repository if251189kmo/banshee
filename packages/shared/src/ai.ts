// Стан ШІ й базовий режим (.claude/logic/03-brain.md, «Стан ШІ й базовий режим»). ШІ — це виклики
// Claude API; без них Banshee працює в базовому режимі й каже чому.

export const AI_STATES = [
  'active',
  'off',
  'no_key',
  'day_limit',
  'month_limit',
  'offline',
  'key_invalid',
  'billing',
  'console_limit',
] as const;
export type AiState = (typeof AI_STATES)[number];

export interface AiStateText {
  /** Підпис у треї, на «Огляді» й у картці «Стан ШІ». */
  readonly label: string;
  /** Коротка відповідь на команду, якій потрібен ШІ. */
  readonly reply: string;
  /** Як повертається ШІ. */
  readonly recovery: string;
}

export const AI_STATE_TEXT: Readonly<Record<AiState, AiStateText>> = {
  active: { label: 'ШІ активний', reply: '', recovery: '' },
  off: {
    label: 'Базовий режим: ШІ вимкнено',
    reply: 'Без ШІ це не вмію. Увімкнути?',
    recovery: 'увімкнути ШІ',
  },
  no_key: {
    label: 'Базовий режим: немає ключа',
    reply: 'Без ШІ це не вмію: ключ API ще не додано.',
    recovery: 'додати ключ у налаштуваннях',
  },
  day_limit: {
    label: 'Базовий режим: ліміт дня',
    reply: 'Ліміт на сьогодні вичерпано. Дозволити ще $1?',
    recovery: 'о 00:00 або «ще $1 на сьогодні» кліком',
  },
  month_limit: {
    label: 'Базовий режим: ліміт місяця',
    reply: 'Ліміт на місяць вичерпано.',
    recovery: '1-го числа або ліміт піднято вручну',
  },
  offline: {
    label: "Базовий режим: немає зв'язку",
    reply: "Немає зв'язку.",
    recovery: 'сам: перевірка щохвилини',
  },
  key_invalid: {
    label: 'Базовий режим: ключ не діє',
    reply: 'Ключ API не діє — потрібен новий.',
    recovery: 'новий ключ у налаштуваннях',
  },
  billing: {
    label: 'Базовий режим: оплата',
    reply: 'Скінчилися кредити API.',
    recovery: 'поповнити кредити в Console',
  },
  console_limit: {
    label: 'Базовий режим: ліміт Console',
    reply: 'Досягнуто ліміту витрат у Console.',
    recovery: 'дата з повідомлення або ліміт піднято в Console',
  },
};

export function isBasicMode(state: AiState): boolean {
  return state !== 'active';
}

/** Стан, з якого ШІ повертається сам, без дій власника. */
export function recoversItself(state: AiState): boolean {
  return state === 'offline' || state === 'day_limit' || state === 'month_limit';
}
