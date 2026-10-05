// Словник назв (.claude/logic/04-memory.md, `aliases`): як власник називає програму, теку чи сайт →
// що відкривати. Вбудований словник працює з першого дня; назви власника з БД мають перевагу.
// Фрази — у нормалізованій формі (text.ts), з поширеними відмінками: «телеграм», «телеграму».
import { normalize, similarity } from './text.ts';

export type AliasKind = 'app' | 'folder' | 'contact' | 'site';

export interface Alias {
  readonly phrase: string;
  /** app — назва в меню «Пуск» англійською; site — https-адреса; folder — відома тека або шлях. */
  readonly target: string;
  readonly kind: AliasKind;
}

function entries(kind: AliasKind, target: string, phrases: readonly string[]): Alias[] {
  return phrases.map((phrase) => ({ phrase: normalize(phrase), target, kind }));
}

export const BUILTIN_ALIASES: readonly Alias[] = [
  ...entries('app', 'Telegram', [
    'телеграм',
    'телеграма',
    'телеграму',
    'телега',
    'телегу',
    'telegram',
  ]),
  ...entries('app', 'Google Chrome', ['хром', 'хрома', 'гугл хром', 'google chrome', 'chrome']),
  ...entries('app', 'Firefox', ['фаєрфокс', 'файрфокс', 'мозилу', 'мозілу', 'firefox']),
  ...entries('app', 'Microsoft Edge', ['едж', 'edge']),
  ...entries('app', 'Visual Studio Code', [
    'вс код',
    'вскод',
    'vs code',
    'віжуал студіо код',
    'візуал студіо код',
    'visual studio code',
  ]),
  ...entries('app', 'Spotify', ['спотіфай', 'спотифай', 'spotify']),
  ...entries('app', 'Discord', ['діскорд', 'дискорд', 'discord']),
  ...entries('app', 'Steam', ['стім', 'стим', 'steam']),
  ...entries('app', 'Notepad', ['блокнот', 'notepad']),
  ...entries('app', 'Calculator', ['калькулятор', 'calculator']),
  ...entries('app', 'File Explorer', ['провідник', 'проводник', 'explorer']),
  ...entries('app', 'Word', ['ворд', 'word']),
  ...entries('app', 'Excel', ['ексель', 'эксель', 'excel']),
  ...entries('app', 'Microsoft Teams', ['тімс', 'тимс', 'teams']),
  ...entries('app', 'Zoom', ['зум', 'zoom']),
  ...entries('app', 'Viber', ['вайбер', 'viber']),
  ...entries('app', 'Task Manager', ['диспетчер задач', 'диспетчер завдань']),
  ...entries('app', 'Paint', ['пейнт', 'paint']),
  ...entries('site', 'https://www.youtube.com', ['ютуб', 'ютюб', 'youtube']),
  ...entries('site', 'https://github.com', ['гітхаб', 'гитхаб', 'github']),
  ...entries('site', 'https://www.google.com', ['гугл', 'google']),
  ...entries('site', 'https://mail.google.com', ['пошту', 'пошта', 'джимейл', 'gmail']),
  ...entries('site', 'https://uk.wikipedia.org', [
    'вікіпедію',
    'вікіпедія',
    'википедию',
    'wikipedia',
  ]),
  ...entries('site', 'https://translate.google.com', ['перекладач', 'гугл перекладач']),
  ...entries('folder', 'Downloads', ['завантаження', 'загрузки', 'downloads']),
  ...entries('folder', 'Documents', ['документи', 'документы', 'documents']),
  ...entries('folder', 'Desktop', ['робочий стіл', 'рабочий стол', 'desktop']),
  ...entries('folder', 'Pictures', ['зображення', 'картинки', 'pictures']),
  ...entries('folder', 'Music', ['теку музика', 'папку музика', 'music']),
  ...entries('folder', 'Videos', ['відео', 'видео', 'videos']),
];

/** Нижче цієї схожості назва не впізнається: «хром» не стане «хрома» випадково в іншому слові. */
export const ALIAS_SIMILARITY = 0.8;

export interface AliasMatch {
  readonly alias: Alias;
  readonly score: number;
}

/**
 * Назва виду kind для фрази з команди: спершу точний збіг, далі найсхожіша (≥ 0,8). Назви власника
 * (owner) переважають вбудовані. Короткі назви (≤ 3 літери) — лише точно: «зум» ≠ «сум».
 */
export function findAlias(
  phrase: string,
  kind: AliasKind,
  owner: readonly Alias[] = [],
): AliasMatch | null {
  const text = normalize(phrase);
  let best: AliasMatch | null = null;
  for (const alias of [...owner, ...BUILTIN_ALIASES]) {
    if (alias.kind !== kind) continue;
    if (alias.phrase === text) return { alias, score: 1 };
    if (alias.phrase.length <= 3) continue;
    const score = similarity(alias.phrase, text);
    if (score >= ALIAS_SIMILARITY && (best === null || score > best.score)) best = { alias, score };
  }
  return best;
}
