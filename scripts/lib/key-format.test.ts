import { describe, expect, it } from 'vitest';
import {
  isClaudeKeyFormat,
  looksLikeOtherSecret,
  maskKey,
  normalizeKeyInput,
} from './key-format.ts';

// Вигаданий ключ, складений із частин, щоб у коді не було рядка, схожого на справжній.
const FAKE_KEY = ['sk', 'ant', 'api03', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4_x-Yz'].join('-');

describe('normalizeKeyInput', () => {
  it('прибирає пробіли, переноси й лапки навколо вставленого ключа', () => {
    expect(normalizeKeyInput(`  "${FAKE_KEY}"\r\n`)).toBe(FAKE_KEY);
    expect(normalizeKeyInput(`'${FAKE_KEY}'`)).toBe(FAKE_KEY);
  });
});

describe('isClaudeKeyFormat', () => {
  it('приймає ключ потрібного формату', () => {
    expect(isClaudeKeyFormat(FAKE_KEY)).toBe(true);
  });

  it('відкидає порожнє, обрізане й чуже', () => {
    expect(isClaudeKeyFormat('')).toBe(false);
    expect(isClaudeKeyFormat('sk-ant-')).toBe(false);
    expect(isClaudeKeyFormat(FAKE_KEY.slice(0, 20))).toBe(false);
    expect(isClaudeKeyFormat(`${FAKE_KEY} extra`)).toBe(false);
    expect(isClaudeKeyFormat(['glpat', 'x'.repeat(20)].join('-'))).toBe(false);
  });
});

describe('looksLikeOtherSecret', () => {
  it('помічає секрет іншого сервісу', () => {
    expect(looksLikeOtherSecret(['glpat', 'x'.repeat(20)].join('-'))).toBe(true);
    expect(looksLikeOtherSecret(FAKE_KEY)).toBe(false);
    expect(looksLikeOtherSecret('')).toBe(false);
  });
});

describe('maskKey', () => {
  it('показує лише останні 4 символи', () => {
    const masked = maskKey(FAKE_KEY);
    expect(masked).toBe(`••••${FAKE_KEY.slice(-4)}`);
    expect(masked).not.toContain(FAKE_KEY.slice(0, 10));
  });
});
