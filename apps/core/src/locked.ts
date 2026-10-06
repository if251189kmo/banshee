// Заблокований ПК (.claude/logic/02-voice.md, «Правила»; 05-safety.md): поки ПК заблоковано, Banshee
// виконує лише дії з позначкою allowWhenLocked — і лише ті групи, що власник лишив у налаштуванні
// «Дії на заблокованому ПК»: час і дата, музика, гучність. Решта — «Розблокуй комп'ютер».
import type { LOCKED_ACTIONS } from '@banshee/shared';
import type { ToolRunner } from './brain/loop.ts';

export type LockedAction = (typeof LOCKED_ACTIONS)[number];

/** Група «Дій на заблокованому ПК» для виклику; null — поки ПК заблоковано, не можна. */
export function lockedActionOf(tool: string, args: unknown): LockedAction | null {
  if (tool === 'volume') return 'volume';
  if (tool === 'media') return 'media';
  if (tool === 'system_info') {
    const kind =
      typeof args === 'object' && args !== null ? (args as { kind?: unknown }).kind : null;
    return kind === 'time' || kind === 'date' ? 'time_date' : null;
  }
  return null;
}

export function allowedWhileLocked(
  tool: string,
  args: unknown,
  allowed: readonly LockedAction[],
): boolean {
  const group = lockedActionOf(tool, args);
  return group !== null && allowed.includes(group);
}

/** Що бачить модель замість результату, якщо дія заборонена на заблокованому ПК. */
export const LOCKED_RESULT =
  "ПК заблоковано: цю дію Banshee не виконує, доки власник не розблокує комп'ютер.";

/**
 * Інструменти з перевіркою блокування: останній рубіж для ходу через ШІ. Рутини перевіряють
 * блокування ще до кроку й одразу кажуть «Розблокуй комп'ютер».
 */
export function lockedGuard(
  tools: ToolRunner,
  state: () => { readonly locked: boolean; readonly allowed: readonly LockedAction[] },
): ToolRunner {
  return {
    assess: (name, args) => tools.assess(name, args),
    async run(name, args) {
      const { locked, allowed } = state();
      if (locked && !allowedWhileLocked(name, args, allowed))
        return { ok: false, content: LOCKED_RESULT };
      return tools.run(name, args);
    },
    undo: (record) => tools.undo(record),
  };
}
