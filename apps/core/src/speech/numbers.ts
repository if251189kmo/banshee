// Числа словами для озвучки (.claude/logic/02-voice.md, «Текст для озвучки»): голоси Piper читають
// цифри погано або пропускають, тож core пише їх словами — з родом, відмінком і узгодженим іменником.

export type Gender = 'm' | 'f' | 'n';
/** Відмінки, які трапляються у відповідях Banshee: «п'ять», «до п'яти», «о п'ятій». */
export type Case = 'nom' | 'gen' | 'loc';
/** Форми іменника після числа: один відсоток, два відсотки, п'ять відсотків. */
export type Forms = readonly [one: string, few: string, many: string];

/** 1 → one, 2–4 → few, решта, а також 11–14 → many. */
export function pluralForm(count: number): 0 | 1 | 2 {
  const whole = Math.abs(Math.trunc(count));
  const lastTwo = whole % 100;
  const last = whole % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 2;
  if (last === 1) return 0;
  if (last >= 2 && last <= 4) return 1;
  return 2;
}

export function plural(count: number, forms: Forms): string {
  return forms[pluralForm(count)];
}

const ONES: Record<Case, readonly string[]> = {
  nom: ['нуль', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"],
  gen: [
    'нуля',
    'одного',
    'двох',
    'трьох',
    'чотирьох',
    "п'яти",
    'шести',
    'семи',
    'восьми',
    "дев'яти",
  ],
  loc: [
    'нулі',
    'одному',
    'двох',
    'трьох',
    'чотирьох',
    "п'яти",
    'шести',
    'семи',
    'восьми',
    "дев'яти",
  ],
};
const TEENS_NOM = [
  'десять',
  'одинадцять',
  'дванадцять',
  'тринадцять',
  'чотирнадцять',
  "п'ятнадцять",
  'шістнадцять',
  'сімнадцять',
  'вісімнадцять',
  "дев'ятнадцять",
];
const TENS_NOM = [
  '',
  '',
  'двадцять',
  'тридцять',
  'сорок',
  "п'ятдесят",
  'шістдесят',
  'сімдесят',
  'вісімдесят',
  "дев'яносто",
];
const HUNDREDS: Record<Case, readonly string[]> = {
  nom: [
    '',
    'сто',
    'двісті',
    'триста',
    'чотириста',
    "п'ятсот",
    'шістсот',
    'сімсот',
    'вісімсот',
    "дев'ятсот",
  ],
  gen: [
    '',
    'ста',
    'двохсот',
    'трьохсот',
    'чотирьохсот',
    "п'ятисот",
    'шестисот',
    'семисот',
    'восьмисот',
    "дев'ятисот",
  ],
  loc: [
    '',
    'стах',
    'двохстах',
    'трьохстах',
    'чотирьохстах',
    "п'ятистах",
    'шестистах',
    'семистах',
    'восьмистах',
    "дев'ятистах",
  ],
};

/** «десять» → «десяти»: десятки й 10–19 у родовому й місцевому — на «-и», «сорок» → «сорока». */
function obliqueTen(word: string): string {
  if (word === 'сорок') return 'сорока';
  if (word === "дев'яносто") return "дев'яноста";
  // «двадцять» → «двадцяти», «п'ятдесят» → «п'ятдесяти».
  return word.endsWith('ь') ? `${word.slice(0, -1)}и` : `${word}и`;
}

function one(digit: number, gender: Gender, grammarCase: Case): string {
  if (digit === 1) {
    if (grammarCase === 'nom') return gender === 'f' ? 'одна' : gender === 'n' ? 'одне' : 'один';
    if (gender === 'f') return grammarCase === 'gen' ? 'однієї' : 'одній';
  }
  if (digit === 2 && grammarCase === 'nom') return gender === 'f' ? 'дві' : 'два';
  return ONES[grammarCase][digit] ?? '';
}

/** Слова числа 1–999. */
function belowThousand(value: number, gender: Gender, grammarCase: Case): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) words.push(HUNDREDS[grammarCase][hundreds] ?? '');
  if (rest >= 10 && rest < 20) {
    const teen = TEENS_NOM[rest - 10] ?? '';
    words.push(grammarCase === 'nom' ? teen : obliqueTen(teen));
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens > 0) {
      const ten = TENS_NOM[tens] ?? '';
      words.push(grammarCase === 'nom' ? ten : obliqueTen(ten));
    }
    if (ones > 0) words.push(one(ones, gender, grammarCase));
  }
  return words;
}

interface Scale {
  readonly value: number;
  readonly gender: Gender;
  readonly nom: Forms;
  readonly gen: Forms;
  readonly loc: Forms;
}

const SCALES: readonly Scale[] = [
  {
    value: 1e9,
    gender: 'm',
    nom: ['мільярд', 'мільярди', 'мільярдів'],
    gen: ['мільярда', 'мільярдів', 'мільярдів'],
    loc: ['мільярді', 'мільярдах', 'мільярдах'],
  },
  {
    value: 1e6,
    gender: 'm',
    nom: ['мільйон', 'мільйони', 'мільйонів'],
    gen: ['мільйона', 'мільйонів', 'мільйонів'],
    loc: ['мільйоні', 'мільйонах', 'мільйонах'],
  },
  {
    value: 1e3,
    gender: 'f',
    nom: ['тисяча', 'тисячі', 'тисяч'],
    gen: ['тисячі', 'тисяч', 'тисяч'],
    loc: ['тисячі', 'тисячах', 'тисячах'],
  },
];

/**
 * Кількісний числівник словами: 21 → «двадцять один», 2 тисячі (f) → «дві тисячі»,
 * у родовому — «двадцяти одного». Понад трильйон — цифра за цифрою.
 */
export function cardinal(value: number, gender: Gender = 'm', grammarCase: Case = 'nom'): string {
  if (!Number.isSafeInteger(value)) throw new Error(`Не ціле число: ${String(value)}`);
  if (value < 0) return `мінус ${cardinal(-value, gender, grammarCase)}`;
  if (value === 0) return ONES[grammarCase][0] ?? 'нуль';
  if (value >= 1e12) return digitsOf(String(value));
  const words: string[] = [];
  let rest = value;
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    if (count === 0) continue;
    rest %= scale.value;
    // «тисяча», а не «одна тисяча»: так кажуть, коли тисяча — на початку числа.
    if (count > 1 || words.length > 0)
      words.push(...belowThousand(count, scale.gender, grammarCase));
    // Після числівника в родовому іменник теж у родовому: «двох тисяч», «одного мільйона».
    const forms = grammarCase === 'nom' ? scale.nom : scale.gen;
    words.push(grammarCase === 'loc' ? plural(count, scale.loc) : plural(count, forms));
  }
  if (rest > 0) words.push(...belowThousand(rest, gender, grammarCase));
  return words.join(' ');
}

/** Цифри по одній: «0 5» → «нуль п'ять». Для кодів, номерів і хвилин «10:05». */
export function digitsOf(digits: string): string {
  return (digits.match(/\d/g) ?? []).map((char) => ONES.nom[Number(char)] ?? '').join(' ');
}

// Порядкові: основа + закінчення. Тверді основи — «п'ятий», м'яка — лише «третій».
const ORDINAL_ONES = [
  '',
  'перш',
  'друг',
  'трет',
  'четверт',
  "п'ят",
  'шост',
  'сьом',
  'восьм',
  "дев'ят",
];
const ORDINAL_TEENS = [
  'десят',
  'одинадцят',
  'дванадцят',
  'тринадцят',
  'чотирнадцят',
  "п'ятнадцят",
  'шістнадцят',
  'сімнадцят',
  'вісімнадцят',
  "дев'ятнадцят",
];
const ORDINAL_TENS = [
  '',
  '',
  'двадцят',
  'тридцят',
  'сороков',
  "п'ятдесят",
  'шістдесят',
  'сімдесят',
  'вісімдесят',
  "дев'яност",
];
const ORDINAL_HUNDREDS = [
  '',
  'сот',
  'двохсот',
  'трьохсот',
  'чотирьохсот',
  "п'ятисот",
  'шестисот',
  'семисот',
  'восьмисот',
  "дев'ятисот",
];

const HARD: Record<Gender, Record<Case, string>> = {
  m: { nom: 'ий', gen: 'ого', loc: 'ому' },
  n: { nom: 'е', gen: 'ого', loc: 'ому' },
  f: { nom: 'а', gen: 'ої', loc: 'ій' },
};
const SOFT: Record<Gender, Record<Case, string>> = {
  m: { nom: 'ій', gen: 'ього', loc: 'ьому' },
  n: { nom: 'є', gen: 'ього', loc: 'ьому' },
  f: { nom: 'я', gen: 'ьої', loc: 'ій' },
};

function ordinalWord(stem: string, gender: Gender, grammarCase: Case): string {
  const endings = stem === 'трет' ? SOFT : HARD;
  return stem + endings[gender][grammarCase];
}

/**
 * Порядковий числівник: змінюється лише останнє слово — «двадцять п'ятий», «дві тисячі
 * двадцять шостого». Круглі тисячі — одним словом: 2000 → «двохтисячний».
 */
export function ordinal(value: number, gender: Gender = 'm', grammarCase: Case = 'nom'): string {
  if (!Number.isSafeInteger(value) || value <= 0 || value >= 1e6)
    throw new Error(`Порядковий числівник лише для 1–999999: ${String(value)}`);
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  if (rest === 0) {
    const prefix = thousands === 1 ? '' : cardinal(thousands, 'f', 'gen').replace(/ /g, '');
    return ordinalWord(`${prefix}тисячн`, gender, grammarCase);
  }
  const head = thousands > 0 ? `${cardinal(thousands * 1000)} ` : '';
  const hundreds = Math.floor(rest / 100);
  const tail = rest % 100;
  const words: string[] = [];
  if (tail === 0) {
    words.push(ordinalWord(ORDINAL_HUNDREDS[hundreds] ?? '', gender, grammarCase));
  } else {
    if (hundreds > 0) words.push(HUNDREDS.nom[hundreds] ?? '');
    if (tail < 10) words.push(ordinalWord(ORDINAL_ONES[tail] ?? '', gender, grammarCase));
    else if (tail < 20)
      words.push(ordinalWord(ORDINAL_TEENS[tail - 10] ?? '', gender, grammarCase));
    else {
      const tens = Math.floor(tail / 10);
      const ones = tail % 10;
      if (ones === 0) words.push(ordinalWord(ORDINAL_TENS[tens] ?? '', gender, grammarCase));
      else
        words.push(
          TENS_NOM[tens] ?? '',
          ordinalWord(ORDINAL_ONES[ones] ?? '', gender, grammarCase),
        );
    }
  }
  return head + words.join(' ');
}

const FRACTION_NAMES: readonly Forms[] = [
  ['десята', 'десяті', 'десятих'],
  ['сота', 'соті', 'сотих'],
  ['тисячна', 'тисячні', 'тисячних'],
];

/**
 * Десятковий дріб: «8,1» → «вісім цілих одна десята». Іменник після дробу — у родовому однини
 * («гігабайта»), його обирає той, хто викликає. Понад три знаки після коми — округлення.
 */
export function decimal(text: string): string {
  const [whole = '0', rawFraction = ''] = text.replace('.', ',').split(',');
  const fraction = rawFraction.slice(0, 3).replace(/0+$/, '');
  const integer = Number(whole);
  if (fraction === '') return cardinal(integer);
  const wholeWords = `${cardinal(integer, 'f')} ${plural(integer, ['ціла', 'цілі', 'цілих'])}`;
  const numerator = Number(fraction);
  const name = FRACTION_NAMES[fraction.length - 1] ?? ['десята', 'десяті', 'десятих'];
  return `${wholeWords} ${cardinal(numerator, 'f')} ${plural(numerator, name)}`;
}
