// Текст ходу власника для Claude: рядок контексту з датою, часом і джерелом, далі команда.
// Дата й час стоять тут, а не в системному промпті, — після останньої точки кешу (03-brain.md).

import type { TurnSource } from '@banshee/shared';

export type { TurnSource } from '@banshee/shared';

/** Місцеві дата й час без часового поясу: «2026-10-05» і «10:30». */
export interface LocalDateTime {
  readonly date: string;
  readonly time: string;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (value: number): string => String(value).padStart(2, '0');

export function localDateTime(now: Date): LocalDateTime {
  return {
    date: `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

/** «2026-10-05T10:30» → дата й час; помилка, якщо формат інший. */
export function parseLocalDateTime(value: string): LocalDateTime {
  const [date = '', time = ''] = value.split('T');
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) {
    throw new Error(`Очікується дата й час у форматі 2026-10-05T10:30, отримано «${value}»`);
  }
  return { date, time };
}

export function weekday(date: string): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Очікується дата у форматі 2026-10-05, отримано «${date}»`);
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return WEEKDAYS[parsed.getUTCDay()] ?? '';
}

/** «[2026-10-05 10:30 Monday · voice]» і команда з нового рядка. */
export function formatOwnerTurn(text: string, at: LocalDateTime, source: TurnSource): string {
  return `[${at.date} ${at.time} ${weekday(at.date)} · ${source}]\n${text.trim()}`;
}
