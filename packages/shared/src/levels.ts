// Рівні дій і поля журналу дій (.claude/logic/05-safety.md, 04-memory.md). Рівень визначає код,
// а не модель: інструмент декларує типовий рівень, політика core його лише піднімає.

export const ACTION_LEVELS = ['green', 'yellow', 'red'] as const;
/** 🟢 безпечна, 🟡 зміна, 🔴 небезпечна. */
export type ActionLevel = (typeof ACTION_LEVELS)[number];

/** Вищий з двох рівнів. */
export function maxLevel(a: ActionLevel, b: ActionLevel): ActionLevel {
  return ACTION_LEVELS.indexOf(a) >= ACTION_LEVELS.indexOf(b) ? a : b;
}

/** Як дію підтверджено — `actions.confirmed_by`. */
export const CONFIRM_METHODS = ['auto', 'voice', 'click', 'key'] as const;
export type ConfirmMethod = (typeof CONFIRM_METHODS)[number];

/** Звідки прийшла дія — `actions.source`. */
export const ACTION_SOURCES = ['voice', 'text', 'routine', 'code', 'ui', 'sync'] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

/** Чим закінчилась дія — `actions.status`. */
export const ACTION_STATUSES = ['done', 'failed', 'denied', 'cancelled'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Скільки чекати рішення про 🔴 дію (05-safety.md). */
export const RED_TIMEOUT_SEC = 60;
/** Кнопка «Виконати» 🔴 дії стає активною не одразу: випадковий Enter її не натисне (09-ui.md). */
export const RED_ARM_DELAY_SEC = 1;

export interface Confirmation {
  /** Чи питати власника перед дією. */
  readonly required: boolean;
  /** Чим можна підтвердити; `auto` — питати не треба. */
  readonly methods: readonly ConfirmMethod[];
  /** Скільки чекати відповіді, с; без відповіді дію скасовано. 0 — не чекати. */
  readonly timeoutSec: number;
  /** Через скільки секунд кнопка підтвердження стає активною. */
  readonly armDelaySec: number;
}

export interface ConfirmationContext {
  /** У розмові є чужий вміст (`tainted`): 🟢 дії теж питають підтвердження. */
  readonly tainted: boolean;
  /** Голосове «так» можна прийняти: команду дав власник, і голосове підтвердження ввімкнено. */
  readonly voiceAllowed: boolean;
  /** Вікно голосового «так» і картки 🟡, с — налаштування `security.voiceConfirm`. */
  readonly voiceSec: number;
}

/**
 * Як підтверджувати дію рівня level (05-safety.md, «Підтвердження»):
 * 🟢 — без питань, якщо немає чужого вмісту; 🟡 — голосом «так» у вікні voiceSec, кліком або Enter;
 * 🔴 — лише клік або клавіша, 60 с, кнопка активна через 1 с.
 */
export function confirmationFor(level: ActionLevel, context: ConfirmationContext): Confirmation {
  if (level === 'red') {
    return {
      required: true,
      methods: ['click', 'key'],
      timeoutSec: RED_TIMEOUT_SEC,
      armDelaySec: RED_ARM_DELAY_SEC,
    };
  }
  if (level === 'green' && !context.tainted) {
    return { required: false, methods: ['auto'], timeoutSec: 0, armDelaySec: 0 };
  }
  return {
    required: true,
    methods: context.voiceAllowed ? ['voice', 'click', 'key'] : ['click', 'key'],
    timeoutSec: context.voiceSec,
    armDelaySec: 0,
  };
}
