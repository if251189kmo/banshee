import { describe, expect, it } from 'vitest';
import { clipStats, frameLevels, speechSegments, wakeStats } from './analyze.ts';
import { SAMPLE_RATE } from './public/wav.js';

const at = (ms: number): number => (ms * SAMPLE_RATE) / 1000;

/** Тиша з тоновими сплесками: [початок мс, кінець мс, частота Гц, амплітуда]. */
function signal(totalMs: number, bursts: [number, number, number, number][]): Int16Array {
  const samples = new Int16Array(at(totalMs));
  for (const [from, to, hz, amplitude] of bursts) {
    for (let i = at(from); i < at(to); i += 1) {
      const value = Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
      samples[i] = Math.max(-32768, Math.min(32767, value));
    }
  }
  return samples;
}

describe('рівні й відрізки мови', () => {
  it('синус з амплітудою 0,5 — це −9 dBFS, тиша — −100 dBFS', () => {
    const levels = frameLevels(signal(100, [[0, 40, 1000, 16384]]));
    expect(levels).toHaveLength(5);
    expect(levels[0]).toBeCloseTo(-9.03, 1);
    expect(levels[4]).toBe(-100);
  });

  it('паузи до 200 мс не розривають фразу, сплески до 100 мс — не мова', () => {
    const levels = [...Array<number>(10).fill(-20), ...Array<number>(8).fill(-100)];
    levels.push(...Array<number>(10).fill(-20), ...Array<number>(20).fill(-100));
    levels.push(...Array<number>(3).fill(-20));
    expect(speechSegments(levels, -50)).toEqual([{ startMs: 0, endMs: 560 }]);
  });
});

describe('кліп', () => {
  it('межі мови, рівень і смуга частот', () => {
    const low = clipStats(signal(2000, [[500, 1000, 1000, 8000]]));
    expect(low.speech).toEqual({ startMs: 500, endMs: 1000 });
    expect(low.noiseDb).toBe(-100);
    expect(low.clippedPct).toBe(0);
    expect(low.highBandPct).toBeLessThan(1);
    const high = clipStats(signal(2000, [[500, 1000, 6000, 8000]]));
    expect(high.highBandPct).toBeGreaterThan(90);
    expect(high.cutoffHz).toBeGreaterThanOrEqual(6000);
  });

  it('рахує перевантаження й тишу без мови', () => {
    expect(clipStats(signal(1000, [[0, 1000, 1000, 40000]])).clippedPct).toBeGreaterThan(10);
    expect(clipStats(new Int16Array(at(1000))).speech).toBeNull();
  });
});

describe('серія «Banshee»', () => {
  it('слова шукає за звуком, а підказки лише звіряє', () => {
    const pcm = signal(10_000, [
      [1200, 1700, 800, 8000],
      [4000, 4500, 800, 8000],
      [8600, 9100, 800, 8000],
    ]);
    const stats = wakeStats(frameLevels(pcm), [1000, 4000, 7000]);
    expect(stats.words).toHaveLength(3);
    expect(stats.cuesWithWord).toBe(2);
    expect(stats.loudBackground).toBe(false);
  });

  it('гучне тло — слова за рівнем не відділити', () => {
    const pcm = signal(5000, [[0, 5000, 300, 2000]]);
    expect(wakeStats(frameLevels(pcm), [1000]).loudBackground).toBe(true);
  });
});
