// Числа й дати для інтерфейсу українською: кома в дробах, пробіл перед «%», місцевий час.

const comma = (value: string): string => value.replace('.', ',');

/** $0,37; дрібні суми — з потрібною точністю: $0,0012. */
export function usd(value: number): string {
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return `$${comma(value.toFixed(digits))}`;
}

export function percent(share: number | null): string {
  return share === null ? '—' : `${String(Math.round(share * 100))} %`;
}

/** 430 мс; 1,25 с. */
export function duration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${String(Math.round(ms))} мс` : `${comma((ms / 1000).toFixed(2))} с`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** 05.10 18:20 — час події в журналі. */
export function dateTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «2026-10-06T00:00» → «06.10 о 00:00». */
export function until(local: string): string {
  const [day, time] = local.split('T');
  const [, month, date] = (day ?? '').split('-');
  return `${date ?? ''}.${month ?? ''} о ${time ?? ''}`;
}

/** «2026-10-05» → «5.10». */
export function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${String(Number(date))}.${month ?? ''}`;
}

/** Зміна проти попереднього періоду: «+12 %», «−3», «без змін». */
export function change(current: number | null, previous: number | null, asShare = false): string {
  if (current === null || previous === null) return '—';
  const delta = current - previous;
  if (Math.abs(delta) < (asShare ? 0.005 : 1e-9)) return 'без змін';
  const sign = delta > 0 ? '+' : '−';
  const value = asShare
    ? `${String(Math.round(Math.abs(delta) * 100))} п. п.`
    : comma(String(Math.round(Math.abs(delta) * 100) / 100));
  return `${sign}${value}`;
}
