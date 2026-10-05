// Що Banshee каже після дії без ШІ (.claude/logic/02-voice.md, «Готові фрази»): коротко й українською,
// ті самі фрази щоразу — їх голос можна приготувати заздалегідь.
import type { RoutineStep } from './basic/builtins.ts';

const DATE = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

function parse(content: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      )
    : [];
/** «8.1» → «8,1»: так число читає озвучка українською. */
const decimal = (value: unknown): string => String(value).replace('.', ',');

/**
 * Відповідь `system_info` голосом. Інструмент простий (`final`): хід завершується без другого виклику
 * моделі, тож дані озвучує core — інакше власник почув би лише «Готово».
 */
export function systemInfoPhrase(kind: string, data: Record<string, unknown>, now: Date): string {
  switch (kind) {
    case 'time':
      return `Зараз ${str(data.time) || now.toTimeString().slice(0, 5)}.`;
    case 'date':
      return `Сьогодні ${DATE.format(now)}.`;
    case 'disk': {
      const disks = records(data.disk);
      if (disks.length === 0) return 'Не вдалося прочитати диски.';
      return `Вільно: ${disks.map((disk) => `${str(disk.drive).replace(':', '')} — ${decimal(disk.freeGb)} гігабайт`).join(', ')}.`;
    }
    case 'network': {
      const online = records(data.network).find((adapter) => adapter.connected === true);
      return online
        ? `Інтернет є: ${str(online.adapter)}, адреса ${str(online.ipv4)}.`
        : 'Інтернету немає.';
    }
    case 'battery': {
      const battery = data.battery;
      if (battery === null || typeof battery !== 'object')
        return 'Батареї немає: це стаціонарний ПК.';
      const info = battery as Record<string, unknown>;
      return `Заряд ${String(info.charge)} відсотків${info.charging === true ? ', заряджається' : ''}.`;
    }
    default:
      return 'Готово.';
  }
}

/** Фраза після успішного кроку рутини; result — відповідь інструмента (JSON). */
export function routinePhrase(step: RoutineStep, result: string, now: Date): string {
  const args = step.args;
  const data = parse(result);
  switch (step.tool) {
    case 'open_app':
      return `Відкриваю ${str(data.opened) || str(args.app)}.`;
    case 'close_app':
      return `Закриваю ${str(args.app)}.`;
    case 'volume':
      if (args.mute === true) return 'Звук вимкнено.';
      if (args.mute === false) return 'Звук увімкнено.';
      if (typeof data.level === 'number') return `Гучність ${String(data.level)} відсотків.`;
      return 'Готово.';
    case 'media':
      return (
        {
          play: 'Відтворюю.',
          pause: 'Пауза.',
          next: 'Наступний трек.',
          previous: 'Попередній трек.',
        }[str(args.action)] ?? 'Готово.'
      );
    case 'open_target':
      return 'Відкриваю.';
    case 'lock_pc':
      return "Блокую комп'ютер.";
    case 'system_info':
      return systemInfoPhrase(str(args.kind), data, now);
    case 'settings.set':
      if (args.key === 'ai.enabled')
        return args.value === true ? 'ШІ увімкнено.' : 'Базовий режим: ШІ вимкнено.';
      return 'Готово.';
    default:
      return 'Готово.';
  }
}

/** Фраза, коли хід через ШІ не вдався. */
export const FAILURE_PHRASES = {
  timeout: 'Модель не відповіла вчасно.',
  refusal: 'Модель відмовилася це робити.',
  failed: 'Не вийшло. Скажи інакше.',
  busy: 'Секунду, закінчую попереднє.',
  voiceRejected: 'Голос не впізнано',
  denied: 'Добре, не роблю.',
  nothingToUndo: 'Немає чого скасувати.',
  help: 'Відкриваю довідку.',
  undone: 'Скасовано.',
  done: 'Готово.',
} as const;
