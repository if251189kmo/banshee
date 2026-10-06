import { describe, expect, it } from 'vitest';
import { cardinal, decimal, digitsOf, ordinal, plural, pluralForm } from './numbers.ts';

describe('pluralForm', () => {
  it('узгоджує іменник з числом', () => {
    const forms = ['відсоток', 'відсотки', 'відсотків'] as const;
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => plural(n, forms))).toEqual([
      'відсотків',
      'відсоток',
      'відсотки',
      'відсотки',
      'відсотків',
      'відсотків',
      'відсотків',
      'відсотків',
      'відсоток',
      'відсотки',
      'відсотків',
      'відсоток',
      'відсотків',
    ]);
    expect(pluralForm(1.5)).toBe(0);
  });
});

describe('cardinal', () => {
  it('пише числа словами', () => {
    expect(cardinal(0)).toBe('нуль');
    expect(cardinal(7)).toBe('сім');
    expect(cardinal(15)).toBe("п'ятнадцять");
    expect(cardinal(50)).toBe("п'ятдесят");
    expect(cardinal(99)).toBe("дев'яносто дев'ять");
    expect(cardinal(120)).toBe('сто двадцять');
    expect(cardinal(245)).toBe("двісті сорок п'ять");
    expect(cardinal(1000)).toBe('тисяча');
    expect(cardinal(1024)).toBe('тисяча двадцять чотири');
    expect(cardinal(2026)).toBe('дві тисячі двадцять шість');
    expect(cardinal(21_000)).toBe('двадцять одна тисяча');
    expect(cardinal(1_500_000)).toBe("мільйон п'ятсот тисяч");
    expect(cardinal(3_000_000_000)).toBe('три мільярди');
    expect(cardinal(-5)).toBe("мінус п'ять");
  });

  it('узгоджує рід', () => {
    expect(cardinal(1, 'f')).toBe('одна');
    expect(cardinal(2, 'f')).toBe('дві');
    expect(cardinal(1, 'n')).toBe('одне');
    expect(cardinal(22, 'f')).toBe('двадцять дві');
  });

  it('відмінює в родовому й місцевому', () => {
    expect(cardinal(5, 'm', 'gen')).toBe("п'яти");
    expect(cardinal(50, 'm', 'gen')).toBe("п'ятдесяти");
    expect(cardinal(40, 'm', 'gen')).toBe('сорока');
    expect(cardinal(90, 'm', 'gen')).toBe("дев'яноста");
    expect(cardinal(1, 'm', 'gen')).toBe('одного');
    expect(cardinal(1, 'f', 'gen')).toBe('однієї');
    expect(cardinal(12, 'm', 'gen')).toBe('дванадцяти');
    expect(cardinal(200, 'm', 'gen')).toBe('двохсот');
    expect(cardinal(2000, 'm', 'gen')).toBe('двох тисяч');
    expect(cardinal(3, 'm', 'loc')).toBe('трьох');
  });

  it('понад трильйон читає цифрами', () => {
    expect(cardinal(1_000_000_000_000)).toBe(
      'один нуль нуль нуль нуль нуль нуль нуль нуль нуль нуль нуль нуль',
    );
    expect(() => cardinal(1.5)).toThrow();
  });
});

describe('ordinal', () => {
  it('змінює лише останнє слово', () => {
    expect(ordinal(1)).toBe('перший');
    expect(ordinal(3)).toBe('третій');
    expect(ordinal(3, 'f')).toBe('третя');
    expect(ordinal(3, 'n')).toBe('третє');
    expect(ordinal(3, 'm', 'gen')).toBe('третього');
    expect(ordinal(5, 'n')).toBe("п'яте");
    expect(ordinal(10, 'f')).toBe('десята');
    expect(ordinal(10, 'f', 'loc')).toBe('десятій');
    expect(ordinal(21, 'f')).toBe('двадцять перша');
    expect(ordinal(30, 'n')).toBe('тридцяте');
    expect(ordinal(40)).toBe('сороковий');
    expect(ordinal(100)).toBe('сотий');
    expect(ordinal(125)).toBe("сто двадцять п'ятий");
    expect(ordinal(2026, 'm', 'gen')).toBe('дві тисячі двадцять шостого');
    expect(ordinal(2026, 'm', 'loc')).toBe('дві тисячі двадцять шостому');
    expect(ordinal(2000)).toBe('двохтисячний');
    expect(ordinal(1000)).toBe('тисячний');
    expect(() => ordinal(0)).toThrow();
  });
});

describe('decimal', () => {
  it('читає дроби', () => {
    expect(decimal('8,1')).toBe('вісім цілих одна десята');
    expect(decimal('1.5')).toBe("одна ціла п'ять десятих");
    expect(decimal('2,25')).toBe("дві цілі двадцять п'ять сотих");
    expect(decimal('0,02')).toBe('нуль цілих дві соті');
    expect(decimal('3,0')).toBe('три');
  });
});

describe('digitsOf', () => {
  it('читає цифри по одній', () => {
    expect(digitsOf('05')).toBe("нуль п'ять");
  });
});
