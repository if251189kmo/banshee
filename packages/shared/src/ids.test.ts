import { describe, expect, it } from 'vitest';
import { isUlid, ulid, ulidTime } from './ids.ts';

describe('ULID', () => {
  it('26 символів Crockford base32, час читається назад', () => {
    const at = Date.UTC(2026, 9, 5, 10, 30);
    const id = ulid(at);
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)).toBe(at);
  });

  it('сортується за часом створення', () => {
    const earlier = ulid(1_000);
    const later = ulid(2_000);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('різні при тому самому часі', () => {
    expect(ulid(5)).not.toBe(ulid(5));
  });

  it('відкидає чуже', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
    expect(() => ulid(-1)).toThrow('поза межами');
  });
});
