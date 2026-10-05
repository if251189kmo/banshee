import { describe, expect, it } from 'vitest';
import { normalize, wordErrorRate } from './text.ts';

describe('порівняння тексту', () => {
  it('нормалізує регістр, апостроф і розділові знаки', () => {
    expect(normalize(' Скопіюй «Фото» — на диск D! ')).toBe('скопіюй фото на диск d');
    expect(normalize('пам’яті')).toBe("пам'яті");
  });

  it('рахує заміни, пропуски й вставки', () => {
    expect(wordErrorRate('відкрий хром', 'Відкрий хром!')).toBe(0);
    expect(wordErrorRate('відкрий хром', 'відкрай хром')).toBe(0.5);
    expect(wordErrorRate('гучність на повну', 'гучність повну')).toBeCloseTo(1 / 3);
    expect(wordErrorRate('тихіше', 'тихіше будь ласка')).toBe(2);
    expect(wordErrorRate('', '')).toBe(0);
  });
});
