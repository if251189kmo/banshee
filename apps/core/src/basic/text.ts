// Нормалізація команди для розпізнавання без LLM (.claude/logic/04-memory.md, «Рутини»): нижній
// регістр, без розділових знаків, числа словами → цифри. Обидві сторони порівняння — команда й
// шаблони рутин — проходять ту саму нормалізацію, тож «тєлєгу» й «телегу» збігаються.

/** Літери, які розпізнавання й суржик пишуть по-різному: для порівняння вони однакові. */
const FOLD: Readonly<Record<string, string>> = {
  є: 'е',
  ї: 'і',
  ё: 'е',
  э: 'е',
  ы: 'и',
  ъ: '',
  ґ: 'г',
};

const UNITS: Readonly<Record<string, number>> = {
  нуль: 0,
  ноль: 0,
  один: 1,
  одна: 1,
  одне: 1,
  одну: 1,
  два: 2,
  дві: 2,
  две: 2,
  три: 3,
  чотири: 4,
  четире: 4,
  "п'ять": 5,
  пять: 5,
  шість: 6,
  шесть: 6,
  сім: 7,
  семь: 7,
  вісім: 8,
  восемь: 8,
  "дев'ять": 9,
  девять: 9,
};
const TEENS: Readonly<Record<string, number>> = {
  десять: 10,
  одинадцять: 11,
  одиннадцать: 11,
  дванадцять: 12,
  двенадцать: 12,
  тринадцять: 13,
  тринадцать: 13,
  чотирнадцять: 14,
  четирнадцать: 14,
  "п'ятнадцять": 15,
  пятнадцать: 15,
  шістнадцять: 16,
  шестнадцать: 16,
  сімнадцять: 17,
  семнадцать: 17,
  вісімнадцять: 18,
  восемнадцать: 18,
  "дев'ятнадцять": 19,
  девятнадцать: 19,
};
const TENS: Readonly<Record<string, number>> = {
  двадцять: 20,
  двадцать: 20,
  тридцять: 30,
  тридцать: 30,
  сорок: 40,
  "п'ятдесят": 50,
  пятьдесят: 50,
  шістдесят: 60,
  шестьдесят: 60,
  сімдесят: 70,
  семьдесят: 70,
  вісімдесят: 80,
  восемьдесят: 80,
  "дев'яносто": 90,
  девяносто: 90,
};
const HUNDREDS: Readonly<Record<string, number>> = {
  сто: 100,
  двісті: 200,
  двести: 200,
  триста: 300,
  чотириста: 400,
  "п'ятсот": 500,
  пятьсот: 500,
  шістсот: 600,
  сімсот: 700,
  вісімсот: 800,
  "дев'ятсот": 900,
};

function fold(word: string): string {
  let out = '';
  for (const char of word) out += FOLD[char] ?? char;
  return out;
}

/** Таблиці чисел — у тій самій нормалізованій формі, що й слова команди. */
const folded = (table: Readonly<Record<string, number>>): ReadonlyMap<string, number> =>
  new Map(Object.entries(table).map(([word, value]) => [fold(word), value]));
const UNITS_F = folded(UNITS);
const TEENS_F = folded(TEENS);
const TENS_F = folded(TENS);
const HUNDREDS_F = folded(HUNDREDS);

/** «сто двадцять п'ять» → «125»: сотні, десятки й одиниці поспіль складаються в одне число. */
function numbersToDigits(words: readonly string[]): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < words.length) {
    let value = 0;
    let used = 0;
    const at = (offset: number): string => words[index + offset] ?? '';
    const hundreds = HUNDREDS_F.get(at(used));
    if (hundreds !== undefined) {
      value += hundreds;
      used += 1;
    }
    const teens = TEENS_F.get(at(used));
    if (teens !== undefined) {
      value += teens;
      used += 1;
    } else {
      const tens = TENS_F.get(at(used));
      if (tens !== undefined) {
        value += tens;
        used += 1;
      }
      const units = UNITS_F.get(at(used));
      if (units !== undefined) {
        value += units;
        used += 1;
      }
    }
    if (used === 0) {
      out.push(at(0));
      index += 1;
    } else {
      out.push(String(value));
      index += used;
    }
  }
  return out;
}

/** Слова, які не змінюють суті команди: ввічливість, слово активації, «відсотків», «давай». */
export const FILLER_WORDS: ReadonlySet<string> = new Set(
  [
    'будь',
    'ласка',
    'пожалуйста',
    'please',
    'банші',
    'банши',
    'banshee',
    'відсотків',
    'відсотки',
    'відсоток',
    'процентів',
    'процентов',
    'процента',
    'давай',
    'ну',
    'мені',
  ].map(fold),
);

/** Слова команди без розділових знаків, з цифрами замість чисел словами. */
export function words(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[’ʼ`ʹ]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/(^|\s)'+|'+(?=\s|$)/g, '$1');
  const raw = cleaned
    .split(' ')
    .filter((word) => word !== '')
    .map(fold);
  return numbersToDigits(raw);
}

export function normalize(text: string): string {
  return words(text).join(' ');
}

/** Відстань Левенштейна між рядками. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/** Схожість 0…1: 1 — однакові. */
export function similarity(a: string, b: string): number {
  const length = Math.max(Array.from(a).length, Array.from(b).length);
  return length === 0 ? 1 : 1 - levenshtein(a, b) / length;
}
