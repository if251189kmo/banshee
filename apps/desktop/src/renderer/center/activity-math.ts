// Розрахунки «Активності» (.claude/logic/09-ui.md): ковзне середнє частки без ШІ за 7 днів і
// накопичення витрат за місяць. Чисті функції — перевіряються тестом.
import type { DayStats } from '@banshee/shared';

/** Частка ходів без ШІ за останні `window` днів на кожен день; null — ходів не було. */
export function movingNoAiShare(days: readonly DayStats[], window = 7): (number | null)[] {
  return days.map((_, index) => {
    let turns = 0;
    let noAi = 0;
    for (let back = Math.max(0, index - window + 1); back <= index; back += 1) {
      turns += days[back]?.turns ?? 0;
      noAi += days[back]?.noAi ?? 0;
    }
    return turns > 0 ? noAi / turns : null;
  });
}

/** Частка успішних ходів за день; null — ходів не було. */
export function successShare(days: readonly DayStats[]): (number | null)[] {
  return days.map((day) => (day.turns > 0 ? day.success / day.turns : null));
}

/** Витрати з початку поточного місяця: сума днів періоду, що належать місяцю останнього дня. */
export function monthToDate(days: readonly DayStats[]): number {
  const month = days.at(-1)?.day.slice(0, 7);
  return days
    .filter((day) => day.day.startsWith(month ?? '-'))
    .reduce((sum, day) => sum + day.costUsd, 0);
}
