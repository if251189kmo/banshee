import { describe, expect, it } from 'vitest';
import { aiStatus, limitWarning, type AiInputs } from './state.ts';

const NOW = new Date(2026, 9, 5, 14, 30);
const BASE: AiInputs = {
  enabled: true,
  hasKey: true,
  spentTodayUsd: 0.2,
  spentMonthUsd: 4,
  limits: { dayUsd: 1, monthUsd: 20 },
  extraTodayUsd: 0,
};

describe('стан ШІ', () => {
  it('активний, коли ключ є й ліміти не вичерпано', () => {
    expect(aiStatus(BASE, NOW)).toEqual({ state: 'active' });
  });

  it('спершу те, що власник виправляє сам', () => {
    expect(aiStatus({ ...BASE, enabled: false, hasKey: false }, NOW).state).toBe('off');
    expect(aiStatus({ ...BASE, hasKey: false }, NOW).state).toBe('no_key');
    expect(
      aiStatus({ ...BASE, spentTodayUsd: 5, apiProblem: { problem: 'billing' } }, NOW).state,
    ).toBe('billing');
  });

  it('денний ліміт — до 00:00; «ще $1» його піднімає', () => {
    expect(aiStatus({ ...BASE, spentTodayUsd: 1 }, NOW)).toEqual({
      state: 'day_limit',
      until: '2026-10-06T00:00',
    });
    expect(aiStatus({ ...BASE, spentTodayUsd: 1, extraTodayUsd: 1 }, NOW).state).toBe('active');
  });

  it('місячний ліміт — до 1-го числа, і він важливіший за денний', () => {
    expect(aiStatus({ ...BASE, spentTodayUsd: 3, spentMonthUsd: 20 }, NOW)).toEqual({
      state: 'month_limit',
      until: '2026-11-01T00:00',
    });
    expect(aiStatus({ ...BASE, spentMonthUsd: 20 }, new Date(2026, 11, 31, 23, 59)).until).toBe(
      '2027-01-01T00:00',
    );
  });

  it("немає зв'язку — лише коли решта в порядку; ліміт Console — з датою з повідомлення", () => {
    expect(aiStatus({ ...BASE, apiProblem: { problem: 'offline' } }, NOW).state).toBe('offline');
    expect(
      aiStatus({ ...BASE, spentTodayUsd: 1, apiProblem: { problem: 'offline' } }, NOW).state,
    ).toBe('day_limit');
    expect(
      aiStatus(
        { ...BASE, apiProblem: { problem: 'console_limit', until: '2026-11-01T00:00' } },
        NOW,
      ),
    ).toEqual({ state: 'console_limit', until: '2026-11-01T00:00' });
  });

  it('попередження з 80 % ліміту: спершу місячного', () => {
    expect(limitWarning(BASE)).toBeNull();
    expect(limitWarning({ ...BASE, spentTodayUsd: 0.8 })).toBe('day');
    expect(limitWarning({ ...BASE, spentTodayUsd: 0.8, extraTodayUsd: 1 })).toBeNull();
    expect(limitWarning({ ...BASE, spentTodayUsd: 0.9, spentMonthUsd: 16 })).toBe('month');
  });
});
