// Текст після розпізнавання — без нативних модулів.

/**
 * Слово активації на початку розпізнаного тексту: спрацювання настає наприкінці слова, і його
 * хвіст інколи потрапляє в команду — «Bunch, відкрий…», «ші відкрий…». Core його не чекає.
 */
const WAKE_PREFIX =
  /^\s*(?:банші|банши|банчі|банч|бенші|banshee|banshi|bunch|bunchy|ші|shi)(?!\p{L})[\s,.!?:;-]*/iu;

export function stripWakeWord(text: string): string {
  return text.replace(WAKE_PREFIX, '').trim();
}

/**
 * Що Parakeet пише на шумі й коротких уривках: англійські вигуки. Команди Banshee такими
 * не бувають, тож це не команда — Banshee слухає далі.
 */
const NOISE = new Set([
  'yeah',
  'yes',
  'okay',
  'ok',
  'mm',
  'mhm',
  'hmm',
  'uh',
  'um',
  'so',
  'oh',
  'thank you',
  'thanks',
  'bye',
  'you',
]);

export function isNoise(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return words === '' || NOISE.has(words);
}

/** Одне слово, схоже на «Banshee»: «Бан», «Ші», «Банчі» — це не команда. */
function isWakeFragment(word: string): boolean {
  if (word.length <= 4 && ('банші'.startsWith(word) || 'банші'.endsWith(word))) return true;
  return ['банші', 'банчі', 'banshee', 'bunch'].some((form) => distance(word, form) <= 2);
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1)
      current.push(
        Math.min(
          (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
          (previous[j] ?? 0) + 1,
          (current[j - 1] ?? 0) + 1,
        ),
      );
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Текст команди з розпізнаного: без слова активації; шум і саме слово — порожній рядок. */
export function commandText(raw: string): string {
  const text = stripWakeWord(raw);
  if (isNoise(text)) return '';
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
  const [only] = words;
  if (words.length === 1 && only !== undefined && isWakeFragment(only)) return '';
  return text;
}
