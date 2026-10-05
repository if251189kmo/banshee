import { describe, expect, it } from 'vitest';
import { episodeOf, groupEpisodes, splitEpisodes } from './pods.ts';

describe('епізоди подкастів', () => {
  it('бере епізод з назви кліпу', () => {
    expect(episodeOf('14e1f1fc-769a_0014.wav')).toBe('14e1f1fc-769a');
    expect(() => episodeOf('clip.wav')).toThrow('без номера');
  });

  it('групує кліпи за епізодами в порядку номерів', () => {
    const episodes = groupEpisodes(['b_0002.wav', 'a_0001.wav', 'b_0001.wav'], () => 10);
    expect(episodes).toEqual([
      { id: 'a', clips: ['a_0001.wav'], seconds: 10 },
      { id: 'b', clips: ['b_0001.wav', 'b_0002.wav'], seconds: 20 },
    ]);
  });

  it('ділить на перевірку й навчання без спільних епізодів', () => {
    const episodes = Array.from({ length: 20 }, (_, index) => ({
      id: `e${String(index)}`,
      clips: [],
      seconds: 100,
    }));
    const { train, test } = splitEpisodes(episodes, 450, 5);
    expect(test).toHaveLength(5);
    expect(train).toHaveLength(15);
    const testIds = new Set(test.map((episode) => episode.id));
    expect(train.some((episode) => testIds.has(episode.id))).toBe(false);
    expect(splitEpisodes(episodes, 450, 5)).toEqual({ train, test });
  });
});
