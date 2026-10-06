// Латиниця для озвучки (.claude/logic/02-voice.md, «Текст для озвучки»): Piper `tetiana` читає
// латиницю погано або пропускає її. Назви — зі словника вимов, абревіатури — назвами літер,
// решта — приблизним читанням англійських буквосполучень.

/** Вимови назв, які Banshee каже найчастіше: програми й сайти словника назв, клавіші, техніка. */
export const PRONUNCIATIONS: Readonly<Record<string, string>> = {
  'visual studio code': 'віжуал студіо код',
  'visual studio': 'віжуал студіо',
  'vs code': 'ві ес код',
  vscode: 'ві ес код',
  'google chrome': 'гугл хром',
  chrome: 'хром',
  google: 'гугл',
  'microsoft edge': 'майкрософт едж',
  'microsoft teams': 'майкрософт тімс',
  microsoft: 'майкрософт',
  edge: 'едж',
  firefox: 'фаєрфокс',
  telegram: 'телеграм',
  spotify: 'спотіфай',
  discord: 'діскорд',
  steam: 'стім',
  notepad: 'нотпед',
  calculator: 'калькулятор',
  'file explorer': 'провідник',
  explorer: 'провідник',
  'task manager': 'диспетчер завдань',
  word: 'ворд',
  excel: 'ексель',
  powerpoint: 'пауерпоінт',
  outlook: 'аутлук',
  teams: 'тімс',
  zoom: 'зум',
  viber: 'вайбер',
  whatsapp: 'вотсап',
  signal: 'сігнал',
  slack: 'слек',
  skype: 'скайп',
  paint: 'пейнт',
  youtube: 'ютуб',
  github: 'гітхаб',
  gitlab: 'гітлаб',
  gmail: 'джимейл',
  wikipedia: 'вікіпедія',
  netflix: 'нетфлікс',
  twitch: 'твіч',
  photoshop: 'фотошоп',
  figma: 'фігма',
  notion: 'ноушн',
  obsidian: 'обсідіан',
  onedrive: 'ван драйв',
  windows: 'віндовс',
  powershell: 'павершел',
  bluetooth: 'блютуз',
  'wi-fi': 'вай-фай',
  wifi: 'вайфай',
  claude: 'клод',
  haiku: 'хайку',
  sonnet: 'сонет',
  banshee: 'банші',
  piper: 'пайпер',
  parakeet: 'паракіт',
  ok: 'окей',
  email: 'імейл',
  'e-mail': 'імейл',
  online: 'онлайн',
  offline: 'офлайн',
  ctrl: 'контрол',
  shift: 'шифт',
  alt: 'альт',
  enter: 'ентер',
  esc: 'ескейп',
  escape: 'ескейп',
  tab: 'таб',
  delete: 'ділейт',
  space: 'пробіл',
  node: 'ноуд',
  git: 'гіт',
  electron: 'електрон',
  python: 'пайтон',
  java: 'джава',
  javascript: 'джаваскрипт',
  typescript: 'тайпскрипт',
};

/** Назви латинських літер, як їх кажуть в абревіатурах: PDF — «пі ді еф». */
const LETTER_NAMES: Readonly<Record<string, string>> = {
  a: 'ей',
  b: 'бі',
  c: 'сі',
  d: 'ді',
  e: 'і',
  f: 'еф',
  g: 'джі',
  h: 'ейч',
  i: 'ай',
  j: 'джей',
  k: 'кей',
  l: 'ел',
  m: 'ем',
  n: 'ен',
  o: 'оу',
  p: 'пі',
  q: "к'ю",
  r: 'ар',
  s: 'ес',
  t: 'ті',
  u: 'ю',
  v: 'ві',
  w: 'дабл ю',
  x: 'екс',
  y: 'вай',
  z: 'зед',
};

/** Абревіатура латиницею, назвами літер: «USB» → «ю ес бі». */
export function spellLatin(word: string): string {
  return (word.toLowerCase().match(/[a-z]/g) ?? [])
    .map((letter) => LETTER_NAMES[letter] ?? '')
    .join(' ');
}

// Буквосполучення — від довших до коротших; «_e» — німе e в кінці слова після приголосної.
const COMBINATIONS: readonly (readonly [string, string])[] = [
  ['tion', 'шн'],
  ['sion', 'жн'],
  ['ight', 'айт'],
  ['augh', 'о'],
  ['ough', 'оу'],
  ['sch', 'ск'],
  ['tch', 'ч'],
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['th', 'т'],
  ['ph', 'ф'],
  ['ck', 'к'],
  ['qu', 'кв'],
  ['wh', 'в'],
  ['kn', 'н'],
  ['ee', 'і'],
  ['ea', 'і'],
  ['oo', 'у'],
  ['ou', 'ау'],
  ['ow', 'оу'],
  ['ai', 'ей'],
  ['ay', 'ей'],
  ['ey', 'ей'],
  ['oy', 'ой'],
  ['oi', 'ой'],
  ['au', 'о'],
  ['aw', 'о'],
  ['ew', 'ью'],
  ['ie', 'і'],
  ['ng', 'нг'],
];

const SINGLE: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'б',
  d: 'д',
  e: 'е',
  f: 'ф',
  h: 'г',
  i: 'і',
  j: 'дж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  z: 'з',
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Приблизне читання англійського слова кирилицею: «Steam» → «стім», «Ubuntu» → «убунту».
 * Не словник вимови — лише щоб незнайома назва звучала, а не зникала.
 */
export function transliterate(word: string): string {
  const lower = word.toLowerCase();
  let result = '';
  let index = 0;
  while (index < lower.length) {
    const rest = lower.slice(index);
    const char = lower[index] ?? '';
    const next = lower[index + 1] ?? '';
    // Німе e в кінці: «code» → «код», «time» → «тайм» (i перед приголосною й німим e — «ай»).
    if (
      char === 'e' &&
      index === lower.length - 1 &&
      index > 1 &&
      !VOWELS.has(lower[index - 1] ?? '')
    ) {
      index += 1;
      continue;
    }
    if (
      char === 'i' &&
      index + 2 === lower.length - 1 &&
      lower.endsWith('e') &&
      !VOWELS.has(next)
    ) {
      result += 'ай';
      index += 1;
      continue;
    }
    if (
      char === 'a' &&
      index + 2 === lower.length - 1 &&
      lower.endsWith('e') &&
      !VOWELS.has(next)
    ) {
      result += 'ей';
      index += 1;
      continue;
    }
    const combination = COMBINATIONS.find(([letters]) => rest.startsWith(letters));
    if (combination) {
      result += combination[1];
      index += combination[0].length;
      continue;
    }
    if (char === 'c') result += next === 'e' || next === 'i' || next === 'y' ? 'с' : 'к';
    else if (char === 'g') result += (next === 'e' || next === 'i') && index > 0 ? 'дж' : 'г';
    else if (char === 'y') {
      if (index === 0 && VOWELS.has(next)) result += 'й';
      else if (index === lower.length - 1 && index > 0) result += lower.length <= 3 ? 'ай' : 'і';
      else result += VOWELS.has(next) ? 'й' : 'і';
    } else result += SINGLE[char] ?? '';
    index += 1;
  }
  return result;
}

/** Абревіатура: 2–5 великих літер, можливо з цифрами («USB», «PDF», «MP3»), — читається літерами. */
export function isLatinAcronym(word: string): boolean {
  return /^[A-Z][A-Z0-9]{1,4}$/.test(word) && /[A-Z].*[A-Z]|[A-Z]\d/.test(word);
}
