import { describe, expect, it } from 'vitest';
import { formatOwnerTurn, localDateTime, parseLocalDateTime, weekday } from './turn-line.ts';

describe('текст ходу власника', () => {
  it('рядок контексту з датою, часом, днем тижня й джерелом, далі команда', () => {
    expect(formatOwnerTurn('  зроби тихіше ', { date: '2026-10-05', time: '10:30' }, 'voice')).toBe(
      '[2026-10-05 10:30 Monday · voice]\nзроби тихіше',
    );
  });

  it('день тижня не залежить від часового поясу', () => {
    expect(weekday('2026-10-03')).toBe('Saturday');
    expect(weekday('2026-10-04')).toBe('Sunday');
  });

  it('місцеві дата й час з Date — з нулями попереду', () => {
    expect(localDateTime(new Date(2026, 0, 5, 9, 7))).toEqual({
      date: '2026-01-05',
      time: '09:07',
    });
  });

  it('розбирає «2026-10-05T10:30» і відкидає інші формати', () => {
    expect(parseLocalDateTime('2026-10-05T10:30')).toEqual({ date: '2026-10-05', time: '10:30' });
    expect(() => parseLocalDateTime('2026-10-05 10:30')).toThrow(/2026-10-05T10:30/);
    expect(() => parseLocalDateTime('2026-10-05T25:00')).toThrow();
  });
});
