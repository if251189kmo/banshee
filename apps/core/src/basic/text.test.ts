import { describe, expect, it } from 'vitest';
import { findAlias } from './aliases.ts';
import { levenshtein, normalize, similarity } from './text.ts';

describe('нормалізація команди', () => {
  it('нижній регістр, без розділових знаків, апостроф — один', () => {
    expect(normalize('Відкрий,  VS Code!')).toBe('відкрий vs code');
    expect(normalize('заблокуй комп’ютер')).toBe("заблокуй комп'ютер");
    expect(normalize("«Банші», 'стоп'")).toBe('банші стоп');
  });

  it('суржик і розпізнавання пишуть літери по-різному — для порівняння вони однакові', () => {
    expect(normalize('запусти тєлєгу')).toBe(normalize('запусти телегу'));
    expect(normalize('Её')).toBe('ее');
  });

  it('числа словами → цифри', () => {
    expect(normalize('зроби гучність на тридцять')).toBe('зроби гучність на 30');
    expect(normalize("сто двадцять п'ять")).toBe('125');
    expect(normalize('двадцять один')).toBe('21');
    expect(normalize("п'ятнадцять")).toBe('15');
    expect(normalize('гучность пятьдесят')).toBe('гучность 50');
    expect(normalize('сорок і два')).toBe('40 і 2');
  });

  it('схожість рядків', () => {
    expect(levenshtein('телеграм', 'телеграму')).toBe(1);
    expect(similarity('', '')).toBe(1);
    expect(similarity('гучність', 'гучності')).toBeCloseTo(0.75);
  });
});

describe('словник назв', () => {
  it('точний збіг, відмінок і своя назва власника', () => {
    expect(findAlias('телеграму', 'app')?.alias.target).toBe('Telegram');
    expect(findAlias('вс код', 'app')?.alias.target).toBe('Visual Studio Code');
    expect(findAlias('ютуб', 'app')).toBeNull();
    expect(findAlias('ютуб', 'site')?.alias.target).toBe('https://www.youtube.com');
    const owner = [
      { phrase: 'робочий проект', target: 'D:\\work-project\\banshee', kind: 'folder' as const },
    ];
    expect(findAlias('робочий проект', 'folder', owner)?.alias.target).toBe(
      'D:\\work-project\\banshee',
    );
  });

  it('короткі назви — лише точно', () => {
    expect(findAlias('зум', 'app')?.alias.target).toBe('Zoom');
    expect(findAlias('сум', 'app')).toBeNull();
  });
});
