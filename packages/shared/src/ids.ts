// ULID — глобальний ідентифікатор запису (`uid`, .claude/logic/11-sync.md): 48 біт часу в мс і 80 біт
// випадковості, 26 символів Crockford base32. Сортується за часом створення; посилання між ПК — через нього.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48)
    throw new Error(`ULID: час поза межами — ${String(now)}`);
  let time = '';
  let rest = now;
  for (let index = 0; index < TIME_CHARS; index += 1) {
    time = (ALPHABET[rest % 32] ?? '0') + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_CHARS));
  let random = '';
  for (const byte of bytes) random += ALPHABET[byte % 32] ?? '0';
  return time + random;
}

/** Час створення ULID, мс. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new Error(`Не ULID: ${id}`);
  let time = 0;
  for (const char of id.slice(0, TIME_CHARS)) time = time * 32 + ALPHABET.indexOf(char);
  return time;
}

export function isUlid(id: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id);
}
