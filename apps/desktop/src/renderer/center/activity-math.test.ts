import type { DayStats } from '@banshee/shared';
import { describe, expect, it } from 'vitest';
import { monthToDate, movingNoAiShare, successShare } from './activity-math.ts';

const day = (
  date: string,
  turns: number,
  noAi: number,
  costUsd = 0,
  success = turns,
): DayStats => ({
  day: date,
  turns,
  noAi,
  ai: turns - noAi,
  escalated: 0,
  refused: 0,
  success,
  failed: turns - success,
  corrected: 0,
  costUsd,
});

describe('розрахунки «Активності»', () => {
  it('ковзна частка без ШІ: ходи за вікно, дні без ходів — null', () => {
    const days = [day('2026-10-01', 0, 0), day('2026-10-02', 4, 1), day('2026-10-03', 4, 3)];
    expect(movingNoAiShare(days, 2)).toEqual([null, 0.25, 0.5]);
  });

  it('частка успішних ходів за день', () => {
    expect(successShare([day('2026-10-01', 4, 0, 0, 3), day('2026-10-02', 0, 0)])).toEqual([
      0.75,
      null,
    ]);
  });

  it('витрати з початку місяця — лише дні поточного місяця', () => {
    const days = [
      day('2026-09-30', 1, 0, 0.5),
      day('2026-10-01', 1, 0, 0.2),
      day('2026-10-02', 1, 0, 0.1),
    ];
    expect(monthToDate(days)).toBeCloseTo(0.3);
  });
});
