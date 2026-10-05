// Подкасти UK-PODS для кроку 0.5. Кліпи групуються в епізоди: перевірка йде на епізодах, яких модель
// не чула. Якщо ділити кліпи впереміш, ті самі диктори є і в навчанні, і в перевірці, і хибних
// спрацювань на перевірці менше, ніж буде на чужому звуці.
import { random } from './classifier.ts';

export interface Episode {
  readonly id: string;
  /** Кліпи епізоду за порядком у ньому. */
  readonly clips: readonly string[];
  readonly seconds: number;
}

/** Назва кліпу — `<епізод>_<номер>.wav`. */
export function episodeOf(clip: string): string {
  const match = /^(.+)_\d+\.wav$/.exec(clip);
  if (!match?.[1]) throw new Error(`Кліп UK-PODS без номера: ${clip}`);
  return match[1];
}

export function groupEpisodes(
  clips: readonly string[],
  secondsOf: (clip: string) => number,
): Episode[] {
  const byEpisode = new Map<string, string[]>();
  for (const clip of [...clips].sort()) {
    const id = episodeOf(clip);
    byEpisode.set(id, [...(byEpisode.get(id) ?? []), clip]);
  }
  return [...byEpisode].map(([id, list]) => ({
    id,
    clips: list,
    seconds: list.reduce((sum, clip) => sum + secondsOf(clip), 0),
  }));
}

/** Епізоди для перевірки — випадкові, поки не набереться testSec секунд; решта — для навчання. */
export function splitEpisodes(
  episodes: readonly Episode[],
  testSec: number,
  seed: number,
): { train: Episode[]; test: Episode[] } {
  const rand = random(seed);
  const shuffled = episodes
    .map((episode) => ({ episode, key: rand() }))
    .sort((a, b) => a.key - b.key)
    .map(({ episode }) => episode);
  const test: Episode[] = [];
  let total = 0;
  for (const episode of shuffled) {
    if (total >= testSec) break;
    test.push(episode);
    total += episode.seconds;
  }
  const chosen = new Set(test.map((episode) => episode.id));
  return { train: shuffled.filter((episode) => !chosen.has(episode.id)), test };
}
