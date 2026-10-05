// Перевірка записів етапу 0 без розпізнавання мови: шум, рівень мови, перевантаження, смуга частот,
// де в кліпі мова, скільки слів у серії «Banshee» і чи сказані вони за підказками.
import { percentile } from '../../scripts/lib/evals/report.ts';
import { SAMPLE_RATE } from './public/wav.js';
import { wavDurationSec } from './storage.ts';

/** Кадр 20 мс. */
export const FRAME_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
const SILENCE_DB = -100;
/** Відлік, вищий за цей, вважаємо перевантаженням. */
const CLIP_SAMPLE = 32_000;
/**
 * Мова — кадри, гучніші за шум на 12 дБ і не тихіші за пік мови більш ніж на 30 дБ.
 * Друга умова потрібна, бо шумозаглушення між словами дає цифрову тишу, і тоді «шум + 12 дБ»
 * ловить клацання пробілу й подих.
 */
const SPEECH_OVER_NOISE_DB = 12;
const SPEECH_UNDER_PEAK_DB = 30;
/** Паузи коротші за 200 мс не розривають фразу; сплески коротші за 100 мс — не мова. */
const MERGE_GAP_FRAMES = 10;
const MIN_SEGMENT_FRAMES = 5;
const FFT_SIZE = 512;
/** Верхня смуга: 4–8 кГц. У вузькосмуговому звуці (8 кГц) її немає зовсім. */
const HIGH_BAND_HZ = 4000;

export interface Segment {
  readonly startMs: number;
  readonly endMs: number;
}

export interface ClipStats {
  readonly durationSec: number;
  /** Шум — 10-й процентиль рівня кадрів, dBFS. */
  readonly noiseDb: number;
  /** Мова — 95-й процентиль рівня кадрів, dBFS. */
  readonly speechDb: number;
  readonly snrDb: number;
  readonly clippedPct: number;
  readonly speech: Segment | null;
  /** Частка енергії мови в смузі 4–8 кГц, %. */
  readonly highBandPct: number;
  /** Найвища частота, де спектр мови не нижчий за пік на 60 дБ. */
  readonly cutoffHz: number;
}

export function pcmOf(wav: Buffer): Int16Array {
  wavDurationSec(wav);
  const samples = new Int16Array((wav.length - 44) / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = wav.readInt16LE(44 + i * 2);
  return samples;
}

export function frameLevels(samples: Int16Array): number[] {
  const levels: number[] = [];
  for (let start = 0; start + FRAME_SAMPLES <= samples.length; start += FRAME_SAMPLES) {
    let sum = 0;
    for (const value of samples.subarray(start, start + FRAME_SAMPLES)) sum += value * value;
    const rms = Math.sqrt(sum / FRAME_SAMPLES) / 32768;
    levels.push(rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB);
  }
  return levels;
}

export function speechSegments(levels: readonly number[], thresholdDb: number): Segment[] {
  const segments: [number, number][] = [];
  levels.forEach((level, index) => {
    if (level < thresholdDb) return;
    const last = segments.at(-1);
    if (last && index - last[1] <= MERGE_GAP_FRAMES) last[1] = index + 1;
    else segments.push([index, index + 1]);
  });
  return segments
    .filter(([start, end]) => end - start >= MIN_SEGMENT_FRAMES)
    .map(([start, end]) => ({ startMs: start * FRAME_MS, endMs: end * FRAME_MS }));
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const tr = br * wr - bi * wi;
        const ti = br * wi + bi * wr;
        re[b] = (re[a] ?? 0) - tr;
        im[b] = (im[a] ?? 0) - ti;
        re[a] = (re[a] ?? 0) + tr;
        im[a] = (im[a] ?? 0) + ti;
      }
    }
  }
}

/** Середній спектр потужності відрізків мови: FFT_SIZE / 2 смуг по 31,25 Гц. */
export function speechSpectrum(samples: Int16Array, segments: readonly Segment[]): Float64Array {
  const power = new Float64Array(FFT_SIZE / 2);
  const window = Float64Array.from(
    { length: FFT_SIZE },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)),
  );
  for (const segment of segments) {
    const from = (segment.startMs * SAMPLE_RATE) / 1000;
    const to = Math.min(samples.length, (segment.endMs * SAMPLE_RATE) / 1000);
    for (let start = from; start + FFT_SIZE <= to; start += FFT_SIZE) {
      const re = Float64Array.from(
        samples.subarray(start, start + FFT_SIZE),
        (value, i) => (value / 32768) * (window[i] ?? 0),
      );
      const im = new Float64Array(FFT_SIZE);
      fft(re, im);
      for (let bin = 0; bin < power.length; bin += 1) {
        power[bin] = (power[bin] ?? 0) + (re[bin] ?? 0) ** 2 + (im[bin] ?? 0) ** 2;
      }
    }
  }
  return power;
}

export function bandwidth(power: Float64Array): { highBandPct: number; cutoffHz: number } {
  const binHz = SAMPLE_RATE / FFT_SIZE;
  // Нижче 100 Гц — гул і постійна складова, не мова.
  const fromBin = Math.ceil(100 / binHz);
  let total = 0;
  let high = 0;
  let peak = 0;
  for (let bin = fromBin; bin < power.length; bin += 1) {
    const value = power[bin] ?? 0;
    total += value;
    if (bin * binHz >= HIGH_BAND_HZ) high += value;
    peak = Math.max(peak, value);
  }
  let cutoffBin = fromBin;
  for (let bin = fromBin; bin < power.length; bin += 1) {
    if ((power[bin] ?? 0) >= peak * 1e-6) cutoffBin = bin;
  }
  return {
    highBandPct: total > 0 ? (100 * high) / total : 0,
    cutoffHz: Math.round(cutoffBin * binHz),
  };
}

function speechThreshold(noiseDb: number, peakDb: number): number {
  return Math.max(noiseDb + SPEECH_OVER_NOISE_DB, peakDb - SPEECH_UNDER_PEAK_DB);
}

export function clipStats(samples: Int16Array): ClipStats {
  const levels = frameLevels(samples);
  const noiseDb = percentile(levels, 0.1);
  const speechDb = percentile(levels, 0.95);
  const segments = speechSegments(levels, speechThreshold(noiseDb, speechDb));
  const first = segments.at(0);
  const last = segments.at(-1);
  let clipped = 0;
  for (const value of samples) if (Math.abs(value) >= CLIP_SAMPLE) clipped += 1;
  return {
    durationSec: samples.length / SAMPLE_RATE,
    noiseDb,
    speechDb,
    snrDb: speechDb - noiseDb,
    clippedPct: samples.length > 0 ? (100 * clipped) / samples.length : 0,
    speech: first && last ? { startMs: first.startMs, endMs: last.endMs } : null,
    ...bandwidth(speechSpectrum(samples, segments)),
  };
}

/** Відрізок мови такої довжини схожий на одне слово «Banshee». */
const WORD_MIN_MS = 250;
const WORD_MAX_MS = 1500;
/** Слово «за підказкою» — почалося не далі 1 с від неї. */
export const CUE_TOLERANCE_MS = 1000;
/** Тло з медіаною гучнішою за це — музика чи мова: слова за рівнем від нього не відділити. */
const LOUD_BACKGROUND_DB = -60;

export interface WakeStats {
  readonly words: readonly Segment[];
  /** Скільки підказок мають слово, що почалося не далі CUE_TOLERANCE_MS від них. */
  readonly cuesWithWord: number;
  /** Медіана рівня кадрів — тло, dBFS. */
  readonly backgroundDb: number;
  /** 95-й процентиль рівня кадрів — піки слів або тла, dBFS. */
  readonly peakDb: number;
  /** Тло гучне: слова знайде лише розпізнавання, рівень не допоможе. */
  readonly loudBackground: boolean;
}

export function wakeStats(levels: readonly number[], cuesMs: readonly number[]): WakeStats {
  const noiseDb = percentile(levels, 0.1);
  const backgroundDb = percentile(levels, 0.5);
  const peakDb = percentile(levels, 0.95);
  const words = speechSegments(levels, speechThreshold(noiseDb, peakDb)).filter((segment) => {
    const length = segment.endMs - segment.startMs;
    return length >= WORD_MIN_MS && length <= WORD_MAX_MS;
  });
  const cuesWithWord = cuesMs.filter((cue) =>
    words.some((word) => Math.abs(word.startMs - cue) <= CUE_TOLERANCE_MS),
  ).length;
  return {
    words,
    cuesWithWord,
    backgroundDb,
    peakDb,
    loudBackground: backgroundDb > LOUD_BACKGROUND_DB,
  };
}
