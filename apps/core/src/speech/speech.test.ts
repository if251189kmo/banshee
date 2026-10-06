import { describe, expect, it } from 'vitest';
import { transliterate } from './latin.ts';
import { speechText } from './speech.ts';

describe('speechText', () => {
  it('читає відповіді Banshee без цифр і латиниці', () => {
    expect(speechText('Гучність 50 %.')).toBe("Гучність п'ятдесят відсотків.");
    expect(speechText('Гучність 1%.')).toBe('Гучність один відсоток.');
    expect(speechText('Відкриваю Telegram.')).toBe('Відкриваю телеграм.');
    expect(speechText('Відкриваю VS Code')).toBe('Відкриваю ві ес код');
    expect(speechText('Відкриваю Google Chrome.')).toBe('Відкриваю гугл хром.');
    expect(speechText('Зараз 10:30.')).toBe('Зараз десята тридцять.');
    expect(speechText('Зараз 9:05.')).toBe("Зараз дев'ята нуль п'ять.");
    expect(speechText('Нагадаю о 18:00.')).toBe('Нагадаю о вісімнадцятій.');
    expect(speechText('Сьогодні понеділок, 5 жовтня.')).toBe("Сьогодні понеділок, п'яте жовтня.");
    expect(speechText('Вільно: C — 8,1 гігабайт, D — 120 гігабайт.')).toBe(
      'Вільно: сі, вісім цілих одна десята гігабайта, ді, сто двадцять гігабайтів.',
    );
    expect(speechText('Заряд 85 відсотків, заряджається.')).toBe(
      "Заряд вісімдесят п'ять відсотків, заряджається.",
    );
  });

  it('узгоджує число з одиницею й прийменником', () => {
    expect(speechText('Вільно 2 ГБ')).toBe('Вільно два гігабайти');
    expect(speechText('Знайшов 21 файл.')).toBe('Знайшов двадцять один файл.');
    expect(speechText('Знайшов 5 файли.')).toBe("Знайшов п'ять файлів.");
    expect(speechText('Понад 100 файлів')).toBe('Понад ста файлів');
    expect(speechText('до 50 %')).toBe("до п'ятдесяти відсотків");
    expect(speechText('Нагадаю через 1 хвилину.')).toBe('Нагадаю через одну хвилину.');
    expect(speechText('Залишилось 2 хв.')).toBe('Залишилось дві хвилини.');
    expect(speechText('Відкрито 2 програми.')).toBe('Відкрито дві програми.');
    expect(speechText('Це займе 3–5 хвилин.')).toBe("Це займе від трьох до п'яти хвилин.");
    expect(speechText('Витрачено $1,5 сьогодні.')).toBe(
      "Витрачено одна ціла п'ять десятих долара сьогодні.",
    );
    expect(speechText('На вулиці 21 °C.')).toBe('На вулиці двадцять один градус.');
  });

  it('читає роки й порядкові', () => {
    expect(speechText('У 2026 році')).toBe('У дві тисячі двадцять шостому році');
    expect(speechText('з 1-го вересня')).toBe('з першого вересня');
    expect(speechText('5-й рядок')).toBe("п'ятий рядок");
    expect(speechText('Дата 05.10.2026.')).toBe(
      "Дата п'яте жовтня дві тисячі двадцять шостого року.",
    );
  });

  it('прибирає лапки, розмітку й емодзі', () => {
    expect(speechText('Відкрила «Блокнот» ✅')).toBe('Відкрила Блокнот');
    expect(speechText('**Готово**: файл `звіт.txt` у Кошику.')).toBe(
      'Готово: файл звіт ті екс ті у Кошику.',
    );
    expect(speechText("П'ять файлів, м'ята.")).toBe("П'ять файлів, м'ята.");
  });

  it('читає шляхи, адреси й абревіатури', () => {
    expect(speechText('Перемістив у D:\\Projects\\Banshee.')).toBe('Перемістив у банші.');
    expect(speechText('Відкриваю https://github.com/if251189kmo/banshee')).toBe(
      'Відкриваю гітхаб крапка ком',
    );
    expect(speechText('Підключіть USB або PDF')).toBe('Підключіть ю ес бі або пі ді еф');
    expect(speechText('Твій ПК готовий, ШІ увімкнено.')).toBe('Твій пе ка готовий, ші увімкнено.');
    expect(speechText('Натисни Ctrl+Shift+B.')).toBe('Натисни контрол плюс шифт плюс бі.');
    expect(speechText('Пісня в MP3')).toBe('Пісня в ем пі три');
  });

  it('бере вимови зі словника власника', () => {
    const pronunciations = new Map([['obsidian', 'обсідіан нотатки']]);
    expect(speechText('Відкриваю Obsidian.', { pronunciations })).toBe(
      'Відкриваю обсідіан нотатки.',
    );
  });

  it('читає номери з нулем цифрами', () => {
    expect(speechText('Код 007')).toBe('Код нуль нуль сім');
  });
});

describe('transliterate', () => {
  it('читає незнайомі англійські назви', () => {
    expect(transliterate('Ubuntu')).toBe('убунту');
    expect(transliterate('Steam')).toBe('стім');
    expect(transliterate('time')).toBe('тайм');
    expect(transliterate('game')).toBe('гейм');
    expect(transliterate('Blender')).toBe('блендер');
    expect(transliterate('nation')).toBe('нашн');
  });
});
