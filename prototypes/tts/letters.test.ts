import { describe, expect, it } from 'vitest';
import { unknownLetters } from './letters.ts';

const TOKENS = [
  '<PAD> 0',
  '  1',
  'в 2',
  'і 3',
  'д 4',
  'к 5',
  'р 6',
  'и 7',
  'й 8',
  'а 9',
  'ю 10',
].join('\r\n');

describe('літери, яких не знає голос', () => {
  it('латиницю й незнайомі літери видно, пробіли й розділові знаки — ні', () => {
    // Велика «В» — окремий символ; латинська «a» в Telegram — не кирилична «а».
    expect(unknownLetters('Відкриваю Telegram.', TOKENS)).toEqual([
      'В',
      'T',
      'e',
      'l',
      'g',
      'r',
      'a',
      'm',
    ]);
    expect(unknownLetters('відкрий', TOKENS)).toEqual([]);
  });
});
