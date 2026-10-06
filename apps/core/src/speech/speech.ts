// Текст для озвучки (.claude/logic/02-voice.md, «Текст для озвучки», крок 2.3): core перед озвученням
// прибирає лапки й розмітку, назви латиницею пише кирилицею зі словника вимов, числа й знаки — словами.
// Оверлей показує вихідний текст; голос читає цей.
import { PRONUNCIATIONS, isLatinAcronym, spellLatin, transliterate } from './latin.ts';
import {
  cardinal,
  decimal,
  digitsOf,
  ordinal,
  plural,
  type Case,
  type Forms,
  type Gender,
} from './numbers.ts';

export interface SpeechOptions {
  /** Вимови назв зі словника власника: «obsidian» → «обсідіан». Ключі — малими літерами. */
  readonly pronunciations?: ReadonlyMap<string, string>;
}

interface Unit {
  readonly gender: Gender;
  readonly nom: Forms;
  readonly gen: Forms;
  /** Після дробу: «вісім цілих одна десята гігабайта». */
  readonly fraction: string;
  /** Знахідний однини жіночого роду: «через одну хвилину». */
  readonly acc?: string;
}

function unit(gender: Gender, nom: Forms, gen: Forms, fraction: string, acc?: string): Unit {
  return acc === undefined ? { gender, nom, gen, fraction } : { gender, nom, gen, fraction, acc };
}

const PERCENT = unit(
  'm',
  ['відсоток', 'відсотки', 'відсотків'],
  ['відсотка', 'відсотків', 'відсотків'],
  'відсотка',
);
const GIGABYTE = unit(
  'm',
  ['гігабайт', 'гігабайти', 'гігабайтів'],
  ['гігабайта', 'гігабайтів', 'гігабайтів'],
  'гігабайта',
);
const MEGABYTE = unit(
  'm',
  ['мегабайт', 'мегабайти', 'мегабайтів'],
  ['мегабайта', 'мегабайтів', 'мегабайтів'],
  'мегабайта',
);
const KILOBYTE = unit(
  'm',
  ['кілобайт', 'кілобайти', 'кілобайтів'],
  ['кілобайта', 'кілобайтів', 'кілобайтів'],
  'кілобайта',
);
const TERABYTE = unit(
  'm',
  ['терабайт', 'терабайти', 'терабайтів'],
  ['терабайта', 'терабайтів', 'терабайтів'],
  'терабайта',
);
const MINUTE = unit(
  'f',
  ['хвилина', 'хвилини', 'хвилин'],
  ['хвилини', 'хвилин', 'хвилин'],
  'хвилини',
  'хвилину',
);
const SECOND = unit(
  'f',
  ['секунда', 'секунди', 'секунд'],
  ['секунди', 'секунд', 'секунд'],
  'секунди',
  'секунду',
);
const HOUR = unit(
  'f',
  ['година', 'години', 'годин'],
  ['години', 'годин', 'годин'],
  'години',
  'годину',
);
const DEGREE = unit(
  'm',
  ['градус', 'градуси', 'градусів'],
  ['градуса', 'градусів', 'градусів'],
  'градуса',
);
const DOLLAR = unit(
  'm',
  ['долар', 'долари', 'доларів'],
  ['долара', 'доларів', 'доларів'],
  'долара',
);
const CENT = unit('m', ['цент', 'центи', 'центів'], ['цента', 'центів', 'центів'], 'цента');
const HRYVNIA = unit(
  'f',
  ['гривня', 'гривні', 'гривень'],
  ['гривні', 'гривень', 'гривень'],
  'гривні',
  'гривню',
);
const EURO = unit('m', ['євро', 'євро', 'євро'], ['євро', 'євро', 'євро'], 'євро');
const FILE = unit('m', ['файл', 'файли', 'файлів'], ['файлу', 'файлів', 'файлів'], 'файлу');
const DAY = unit('m', ['день', 'дні', 'днів'], ['дня', 'днів', 'днів'], 'дня');
const TIMES = unit('m', ['раз', 'рази', 'разів'], ['разу', 'разів', 'разів'], 'разу');
const WINDOW = unit('n', ['вікно', 'вікна', 'вікон'], ['вікна', 'вікон', 'вікон'], 'вікна');
const PROGRAM = unit(
  'f',
  ['програма', 'програми', 'програм'],
  ['програми', 'програм', 'програм'],
  'програми',
  'програму',
);

/**
 * Одиниці після числа: знаки й скорочення («50 %», «120 ГБ», «5 хв») і іменники словами — тоді
 * число узгоджується з іменником, а форма іменника виправляється («5 відсотки» → «п'ять відсотків»).
 */
const UNITS: readonly (readonly [string, Unit])[] = [
  ['%', PERCENT],
  ['(?:ГБ|Гб|GB)(?![\\p{L}\\d])', GIGABYTE],
  ['(?:МБ|Мб|MB)(?![\\p{L}\\d])', MEGABYTE],
  ['(?:КБ|Кб|KB)(?![\\p{L}\\d])', KILOBYTE],
  ['(?:ТБ|Тб|TB)(?![\\p{L}\\d])', TERABYTE],
  ['хв\\.?(?![\\p{L}\\d])', MINUTE],
  ['(?:сек|с)\\.?(?![\\p{L}\\d])', SECOND],
  ['год\\.?(?![\\p{L}\\d])', HOUR],
  ['°[\\s\\u00a0]?[CС]?(?![\\p{L}\\d])', DEGREE],
  ['грн\\.?(?![\\p{L}\\d])', HRYVNIA],
  ['\\$', DOLLAR],
  ['€', EURO],
  ['₴', HRYVNIA],
  ['відсот\\p{L}*', PERCENT],
  ['гігабайт\\p{L}*', GIGABYTE],
  ['мегабайт\\p{L}*', MEGABYTE],
  ['кілобайт\\p{L}*', KILOBYTE],
  ['терабайт\\p{L}*', TERABYTE],
  ['хвилин\\p{L}*', MINUTE],
  ['секунд\\p{L}*', SECOND],
  ['годин\\p{L}*', HOUR],
  ['градус\\p{L}*', DEGREE],
  ['долар\\p{L}*', DOLLAR],
  ['цент(?:и|ів|а)?(?!\\p{L})', CENT],
  ['грив(?:ня|ні|ень|ню)(?!\\p{L})', HRYVNIA],
  ['євро(?!\\p{L})', EURO],
  ['файл(?:и|ів|у|а)?(?!\\p{L})', FILE],
  ['(?:день|дні|днів|дня)(?!\\p{L})', DAY],
  ['раз(?:и|ів|у)?(?!\\p{L})', TIMES],
  ['вік(?:на|он|но)(?!\\p{L})', WINDOW],
  ['програм(?:а|и|у)?(?!\\p{L})', PROGRAM],
];
const UNIT_PATTERNS = UNITS.map(
  ([source, target]) => [new RegExp(`^(?:${source})$`, 'u'), target] as const,
);
const UNIT_SOURCE = UNITS.map(([source]) => source).join('|');

function unitOf(text: string): Unit | undefined {
  return UNIT_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];
}

const GEN_PREPOSITIONS = new Set([
  'до',
  'від',
  'з',
  'із',
  'зі',
  'понад',
  'близько',
  'більше',
  'менше',
  'біля',
  'без',
  'після',
  'протягом',
  'замість',
  'крім',
  'для',
  'серед',
]);
const LOC_PREPOSITIONS = new Set(['о', 'об', 'при']);
const ACC_PREPOSITIONS = new Set(['через', 'на', 'за', 'про']);

type SpeechCase = Case | 'acc';

/** Відмінок числа за прийменником перед ним: «до 50 %» → родовий, «о 10:30» → місцевий. */
function caseBefore(text: string, index: number): SpeechCase {
  const before = /(\p{L}+)[\s\u00a0]*$/u.exec(text.slice(Math.max(0, index - 20), index));
  const word = before?.[1]?.toLowerCase() ?? '';
  if (GEN_PREPOSITIONS.has(word)) return 'gen';
  if (LOC_PREPOSITIONS.has(word)) return 'loc';
  if (ACC_PREPOSITIONS.has(word)) return 'acc';
  return 'nom';
}

/** Ціле число з одиницею: «двох гігабайтів», «через одну хвилину». */
function countWithUnit(value: number, target: Unit, grammarCase: SpeechCase): string {
  const lastOne = value % 10 === 1 && value % 100 !== 11;
  if (grammarCase === 'acc' && target.gender === 'f' && lastOne && target.acc)
    return `${cardinal(value, 'f').replace(/одна$/u, 'одну')} ${target.acc}`;
  const numberCase: Case = grammarCase === 'acc' ? 'nom' : grammarCase;
  const forms = numberCase === 'nom' ? target.nom : target.gen;
  return `${cardinal(value, target.gender, numberCase)} ${plural(value, forms)}`;
}

/** Число з одиницею; дріб — «вісім цілих одна десята гігабайта». */
function numberWithUnit(
  whole: string,
  fraction: string | undefined,
  target: Unit,
  grammarCase: SpeechCase,
): string {
  const value = Number(whole.replace(/[\s\u00a0]/gu, ''));
  if (fraction !== undefined && /[1-9]/u.test(fraction))
    return `${decimal(`${String(value)},${fraction}`)} ${target.fraction}`;
  return countWithUnit(value, target, grammarCase);
}

/** Іменники жіночого роду в множині, після яких «2» — «дві». */
const FEMININE_PLURALS = new Set([
  'програми',
  'команди',
  'теки',
  'папки',
  'вкладки',
  'сторінки',
  'пісні',
  'фрази',
  'дії',
  'задачі',
  'тисячі',
]);

/** Рід іменника після числа — за закінченням: «1 програма» → «одна», «1 вікно» → «одне». */
function genderOfNext(rest: string): Gender {
  const word = /^[\s\u00a0]*([\p{L}'’]+)/u.exec(rest)?.[1]?.toLowerCase() ?? '';
  if (word === '') return 'm';
  if (FEMININE_PLURALS.has(word)) return 'f';
  if (/(?:ння|ття|сся|ччя|лля|о|е)$/u.test(word)) return 'n';
  if (/[ая]$/u.test(word)) return 'f';
  return 'm';
}

const MONTHS = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

/** Година й хвилини: «о 10:30» → «о десятій тридцять», «10:05» → «десята нуль п'ять». */
function timeWords(hours: number, minutes: number, grammarCase: SpeechCase): string {
  const hourCase: Case = grammarCase === 'acc' ? 'nom' : grammarCase;
  const hour = hours === 0 ? 'нуль' : ordinal(hours, 'f', hourCase);
  if (minutes === 0) return hourCase === 'nom' ? `${hour} рівно` : hour;
  const minuteWords = minutes < 10 ? `нуль ${cardinal(minutes)}` : cardinal(minutes, 'f');
  return `${hour} ${minuteWords}`;
}

const ORDINAL_SUFFIX: Readonly<Record<string, readonly [Gender, Case]>> = {
  ий: ['m', 'nom'],
  й: ['m', 'nom'],
  ого: ['m', 'gen'],
  го: ['m', 'gen'],
  ому: ['m', 'loc'],
  му: ['m', 'loc'],
  ша: ['f', 'nom'],
  га: ['f', 'nom'],
  тя: ['f', 'nom'],
  та: ['f', 'nom'],
  а: ['f', 'nom'],
  ої: ['f', 'gen'],
  ї: ['f', 'gen'],
  ій: ['f', 'loc'],
  ше: ['n', 'nom'],
  ге: ['n', 'nom'],
  тє: ['n', 'nom'],
  те: ['n', 'nom'],
  е: ['n', 'nom'],
};

const CYRILLIC_LETTERS: Readonly<Record<string, string>> = {
  А: 'а',
  Б: 'бе',
  В: 'ве',
  Г: 'ге',
  Ґ: 'ґе',
  Д: 'де',
  Е: 'е',
  Є: 'є',
  Ж: 'же',
  З: 'зе',
  И: 'и',
  І: 'і',
  Ї: 'ї',
  Й: 'йот',
  К: 'ка',
  Л: 'ел',
  М: 'ем',
  Н: 'ен',
  О: 'о',
  П: 'пе',
  Р: 'ер',
  С: 'ес',
  Т: 'те',
  У: 'у',
  Ф: 'еф',
  Х: 'ха',
  Ц: 'це',
  Ч: 'че',
  Ш: 'ша',
  Щ: 'ща',
  Ю: 'ю',
  Я: 'я',
};
/** Абревіатури, які читають словом або усталено. */
const CYRILLIC_ACRONYMS: Readonly<Record<string, string>> = {
  ШІ: 'ші',
  ООН: 'оон',
  ГБ: 'гігабайт',
  МБ: 'мегабайт',
  ТБ: 'терабайт',
  КБ: 'кілобайт',
};

/** «ПК» → «пе ка»; довгі з голосними («НАТО») — словом. */
function cyrillicAcronym(word: string): string {
  const known = CYRILLIC_ACRONYMS[word];
  if (known) return known;
  const letters = word.match(/\p{L}/gu) ?? [];
  const vowels = letters.filter((letter) => /[АЕЄИІЇОУЮЯ]/u.test(letter)).length;
  if (letters.length >= 4 && vowels >= 2) return word.toLowerCase();
  return letters.map((letter) => CYRILLIC_LETTERS[letter] ?? letter.toLowerCase()).join(' ');
}

type Lookup = (phrase: string) => string | undefined;

/** Одне латинське слово: частини «PowerShell», абревіатура «MP3», решта — читанням. */
function latinWord(word: string, lookup: Lookup): string {
  const known = lookup(word.toLowerCase());
  if (known !== undefined) return known;
  if (isLatinAcronym(word) || /^[A-Z]$/u.test(word)) {
    return (word.match(/[A-Za-z]+|\d+/gu) ?? [])
      .map((piece) => (/\d/u.test(piece) ? cardinal(Number(piece)) : spellLatin(piece)))
      .join(' ');
  }
  const parts = word.split(/(?<=[a-z])(?=[A-Z])|[-'’.]/u).filter(Boolean);
  if (parts.length > 1) return parts.map((part) => latinWord(part, lookup)).join(' ');
  return (word.match(/[A-Za-z]+|\d+/gu) ?? [])
    .map((piece) =>
      /\d/u.test(piece) ? cardinal(Number(piece)) : transliterate(piece.replace(/(.)\1/gu, '$1')),
    )
    .join(' ');
}

/** Латинська фраза: найдовші збіги зі словником (до трьох слів), решта — по слову. */
function latinSpan(span: string, options: SpeechOptions): string {
  const lookup: Lookup = (phrase) => options.pronunciations?.get(phrase) ?? PRONUNCIATIONS[phrase];
  const words = span.split(/[\s\u00a0]+/u).filter(Boolean);
  const out: string[] = [];
  let index = 0;
  while (index < words.length) {
    let length = Math.min(3, words.length - index);
    for (; length > 1; length -= 1) {
      const spoken = lookup(
        words
          .slice(index, index + length)
          .join(' ')
          .toLowerCase(),
      );
      if (spoken !== undefined) {
        out.push(spoken);
        break;
      }
    }
    if (length === 1) out.push(latinWord(words[index] ?? '', lookup));
    index += length;
  }
  return out.join(' ');
}

/** Адреса сайту голосом: «github.com» → «гітхаб крапка ком». */
function hostWords(host: string, options: SpeechOptions): string {
  return host
    .replace(/^www\./iu, '')
    .split('.')
    .map((label) => latinSpan(label, options))
    .join(' крапка ');
}

const NUMBER = String.raw`(\d{1,3}(?:[\s\u00a0]\d{3})+|\d+)(?:[.,](\d+))?`;

/** \u0420\u043e\u0437\u0448\u0438\u0440\u0435\u043d\u043d\u044f \u0444\u0430\u0439\u043b\u0456\u0432, \u044f\u043a\u0456 \u043a\u0430\u0436\u0443\u0442\u044c \u0441\u043b\u043e\u0432\u043e\u043c; \u0440\u0435\u0448\u0442\u0430 \u2014 \u043b\u0456\u0442\u0435\u0440\u0430\u043c\u0438. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  docx: '\u0434\u043e\u043a\u0441',
  doc: '\u0434\u043e\u043a',
  xlsx: '\u0435\u043a\u0441\u0435\u043b\u044c',
  pptx: '\u043f\u0430\u0432\u0435\u0440 \u043f\u043e\u0456\u043d\u0442',
  jpg: '\u0434\u0436\u0435\u0439\u043f\u0435\u0433',
  jpeg: '\u0434\u0436\u0435\u0439\u043f\u0435\u0433',
  exe: '\u0435\u043a\u0437\u0435',
  zip: '\u0437\u0456\u043f',
  rar: '\u0440\u0430\u0440',
};

/**
 * Текст відповіді → текст для голосу. Зберігає зміст і пунктуацію речень: озвучка ділить
 * текст на речення й робить паузи на розділових знаках.
 */
export function speechText(text: string, options: SpeechOptions = {}): string {
  let out = text;

  // Розмітка Markdown, емодзі, позначки рівнів, лапки.
  out = out
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/`+/gu, '')
    .replace(/\*\*|__|~~/gu, '')
    .replace(/^\s*#{1,6}\s+/gmu, '')
    .replace(/^\s*[-*•]\s+/gmu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\u200d|\ufe0f/gu, '')
    .replace(/[«»„“”"]/gu, '')
    .replace(/(^|[\s(])['‘’]([^'‘’\n]+)['‘’](?=[\s.,!?;:)]|$)/gu, '$1$2');

  // Адреси сайтів і пошти.
  out = out
    .replace(/\bhttps?:\/\/([^\s/]+)\S*/giu, (_match, host: string) => hostWords(host, options))
    .replace(
      /\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b/gu,
      (_match, user: string, host: string) =>
        `${latinSpan(user.replace(/[._+-]/gu, ' '), options)} ет ${hostWords(host, options)}`,
    )
    .replace(
      /(?<![\p{L}\d@./])((?:[a-z0-9-]+\.)+(?:com|org|net|ua|io|dev|app|ai))(?![\p{L}\d])/giu,
      (_match, host: string) => hostWords(host, options),
    );

  // Шляхи Windows — лише остання частина: «D:\Projects\Banshee» → «Banshee»; корінь — «диск ді».
  out = out.replace(
    /(?<![\p{L}\d])([A-Za-z]):\\(?:[^\\\s,;]+\\)*([^\\\s,;]*)/gu,
    (_match, drive: string, last: string) => (last === '' ? `диск ${spellLatin(drive)}` : last),
  );

  // Розширення файлів: «звіт.txt» → «звіт ті екс ті», «фото.jpg» → «фото джейпег».
  out = out.replace(
    /(?<=[\p{L}\d])\.([A-Za-z][A-Za-z0-9]{1,3})(?![\p{L}\d])/gu,
    (_match, extension: string) =>
      ` ${EXTENSIONS[extension.toLowerCase()] ?? latinWord(extension.toUpperCase(), () => undefined)}`,
  );

  // Дати «05.10.2026» і «05.10».
  out = out.replace(
    /(?<![\p{L}\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?![\d.]*\d)/gu,
    (match, day: string, month: string, year: string | undefined, offset: number, all: string) => {
      const monthName = MONTHS[Number(month) - 1];
      const dayNumber = Number(day);
      if (!monthName || dayNumber < 1 || dayNumber > 31) return match;
      const dayCase: Case = caseBefore(all, offset) === 'gen' ? 'gen' : 'nom';
      const yearWords = year ? ` ${ordinal(Number(year), 'm', 'gen')} року` : '';
      return `${ordinal(dayNumber, 'n', dayCase)} ${monthName}${yearWords}`;
    },
  );

  // Час «10:30».
  out = out.replace(
    /(?<![\p{L}\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/gu,
    (_match, hours: string, minutes: string, offset: number, all: string) =>
      timeWords(Number(hours), Number(minutes), caseBefore(all, offset)),
  );

  // Роки: «2026 року», «у 2026 році», «2026 р.».
  out = out.replace(
    /(?<![\p{L}\d])(\d{4})[\s\u00a0]*(рік|року|році|р\.)(?!\p{L})/gu,
    (_match, year: string, word: string) => {
      const yearCase: Case = word === 'рік' ? 'nom' : word === 'році' ? 'loc' : 'gen';
      return `${ordinal(Number(year), 'm', yearCase)} ${word === 'р.' ? 'року' : word}`;
    },
  );

  // День місяця: «5 жовтня» → «п'яте жовтня», «до 5 жовтня» → «до п'ятого жовтня».
  out = out.replace(
    new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})[\\s\\u00a0]+(${MONTHS.join('|')})(?!\\p{L})`, 'gu'),
    (match, day: string, month: string, offset: number, all: string) => {
      const dayNumber = Number(day);
      if (dayNumber < 1 || dayNumber > 31) return match;
      const dayCase: Case = caseBefore(all, offset) === 'gen' ? 'gen' : 'nom';
      return `${ordinal(dayNumber, 'n', dayCase)} ${month}`;
    },
  );

  // Порядкові з закінченням: «1-й», «5-го», «2-га», «3-тя».
  out = out.replace(
    /(?<![\p{L}\d])(\d+)-(ий|й|ого|го|ому|му|ша|га|тя|та|а|ої|ї|ій|ше|ге|тє|те|е)(?!\p{L})/gu,
    (match, digits: string, suffix: string) => {
      const value = Number(digits);
      const form = ORDINAL_SUFFIX[suffix];
      if (!form || value <= 0 || value >= 1e6) return match;
      return ordinal(value, form[0], form[1]);
    },
  );

  // Діапазони: «3–5 хвилин» → «від трьох до п'яти хвилин».
  out = out.replace(
    new RegExp(
      String.raw`(?<![\p{L}\d.,])(\d+)[\s\u00a0]*[–—-][\s\u00a0]*(\d+)(?![\d.,]*\d)(?:[\s\u00a0]*(${UNIT_SOURCE}))?`,
      'gu',
    ),
    (_match, from: string, to: string, unitText: string | undefined) => {
      const target = unitText === undefined ? undefined : unitOf(unitText);
      const gender = target?.gender ?? 'm';
      const range = `від ${cardinal(Number(from), gender, 'gen')} до ${cardinal(Number(to), gender, 'gen')}`;
      return target ? `${range} ${plural(Number(to), target.gen)}` : range;
    },
  );

  // Валюта перед числом: «$1,5» → «одна ціла п'ять десятих долара».
  out = out.replace(
    new RegExp(String.raw`([$€₴])[\s\u00a0]?${NUMBER}`, 'gu'),
    (
      _match,
      sign: string,
      whole: string,
      fraction: string | undefined,
      offset: number,
      all: string,
    ) => {
      const target = sign === '$' ? DOLLAR : sign === '€' ? EURO : HRYVNIA;
      return numberWithUnit(whole, fraction, target, caseBefore(all, offset));
    },
  );

  // Числа з одиницями й без: «50 %», «120 ГБ», «2 файли», «8,1».
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d.,])${NUMBER}(?!\d)(?:[\s\u00a0]*(${UNIT_SOURCE}))?`, 'gu'),
    (
      match: string,
      whole: string,
      fraction: string | undefined,
      unitText: string | undefined,
      offset: number,
      all: string,
    ) => {
      const grammarCase = caseBefore(all, offset);
      const target = unitText === undefined ? undefined : unitOf(unitText);
      if (target) {
        // «2 хв.» у кінці речення: крапка скорочення — водночас кінець речення.
        const rest = all.slice(offset + match.length);
        const sentenceEnd = unitText?.endsWith('.') === true && /^(?:\s+\p{Lu}|\s*$)/u.test(rest);
        return numberWithUnit(whole, fraction, target, grammarCase) + (sentenceEnd ? '.' : '');
      }
      const digits = whole.replace(/[\s\u00a0]/gu, '');
      if (fraction !== undefined) return decimal(`${digits},${fraction}`);
      // Коди й номери з нулем на початку — цифрами по одній.
      if (/^0\d/u.test(digits)) return digitsOf(digits);
      const numberCase: Case = grammarCase === 'acc' ? 'nom' : grammarCase;
      return cardinal(Number(digits), genderOfNext(all.slice(offset + match.length)), numberCase);
    },
  );

  // Знаки.
  out = out
    .replace(/(?<=[\p{L}\d])\+(?=[\p{L}\d])/gu, ' плюс ')
    .replace(/\s\+\s/gu, ' плюс ')
    .replace(/\s=\s/gu, ' дорівнює ')
    .replace(/&/gu, ' і ')
    .replace(/№\s?/gu, 'номер ')
    .replace(/%/gu, ' відсотків')
    .replace(/°/gu, ' градусів')
    .replace(/\s[—–]\s/gu, ', ')
    .replace(/…/gu, '.')
    .replace(/[\\/|_#*<>{}[\]^~]/gu, ' ');

  // Латиниця: фрази й слова — кирилицею.
  out = out.replace(
    /[A-Za-z][A-Za-z0-9'’.-]*(?:[\s\u00a0]+[A-Za-z][A-Za-z0-9'’.-]*)*/gu,
    (span: string) => {
      const dot = span.endsWith('.') ? '.' : '';
      return latinSpan(dot ? span.slice(0, -1) : span, options) + dot;
    },
  );

  // Абревіатури кирилицею: «ПК» → «пе ка».
  out = out.replace(/(?<![\p{L}\d'’])[А-ЯҐЄІЇ]{2,5}(?![\p{L}\d'’])/gu, cyrillicAcronym);

  return out
    .replace(/[\s\u00a0]+/gu, ' ')
    .replace(/\s+([.,!?;:])/gu, '$1')
    .replace(/,\s*(?=[.,!?;:])/gu, '')
    .trim();
}
