// Синтетичні вимови «Банші» локальними голосами (крок 0.5): різні голоси, темп і інтонація,
// щоб модель вчила слово, а не голос власника. Звук — PCM 16 кГц у шкалі −32768…32767.
import { join, resolve } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { random } from './classifier.ts';

const PIPER = resolve('.data/models/piper');
const RATE = 16_000;

interface Voice {
  readonly id: string;
  readonly dir: string;
  readonly model: string;
  readonly espeak: boolean;
}

const VOICES: readonly Voice[] = [
  {
    id: 'tetiana',
    dir: 'piper-uk_UA-tetiana-high',
    model: 'uk_UA-tetiana-high.onnx',
    espeak: true,
  },
  { id: 'lada', dir: 'vits-piper-uk_UA-lada-x_low', model: 'uk_UA-lada-x_low.onnx', espeak: true },
  { id: 'olena', dir: 'vits-coqui-uk-mai', model: 'model.onnx', espeak: false },
  { id: 'mms', dir: 'vits-mms-ukr', model: 'model.onnx', espeak: false },
];
/** Як кажуть «Banshee»: повне слово з різною інтонацією й коротке «банш», як у власника. */
const TEXTS = ['Банші.', 'Банші!', 'Банші?', 'Банш.'];
const SPEEDS = [0.85, 1, 1.15];
const REPEATS = 2;
/** Тиша перед словом: вікну моделі слова потрібно ≈ 2 с звуку. */
const LEAD_SEC = 1.4;

/** Лінійне перетворення частоти: для ознак до 8 кГц цього досить. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.floor((samples.length * to) / from);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = (index * from) / to;
    const left = Math.floor(position);
    const fraction = position - left;
    out[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[left + 1] ?? 0) * fraction;
  }
  return out;
}

/** Кінець мови: останній кадр 10 мс, не тихіший за пік більш ніж на 35 дБ. */
export function speechEndSec(samples: Float32Array): number {
  const frame = RATE / 100;
  let peak = 0;
  const levels: number[] = [];
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let sum = 0;
    for (const value of samples.subarray(start, start + frame)) sum += value * value;
    const level = Math.sqrt(sum / frame);
    levels.push(level);
    peak = Math.max(peak, level);
  }
  const floor = peak * 10 ** (-35 / 20);
  let last = 0;
  levels.forEach((level, index) => {
    if (level >= floor) last = index;
  });
  return (last + 1) / 100;
}

export interface SyntheticWord {
  readonly id: string;
  readonly samples: Float32Array;
  readonly endSec: number;
}

function ttsOf(voice: Voice) {
  const dir = join(PIPER, voice.dir);
  return new sherpa.OfflineTts({
    model: {
      vits: {
        model: join(dir, voice.model),
        tokens: join(dir, 'tokens.txt'),
        ...(voice.espeak ? { dataDir: join(dir, 'espeak-ng-data') } : {}),
      },
      numThreads: 2,
      debug: 0,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  });
}

/** Слово з тишею LEAD_SEC перед ним і 0,5 с після, 16 кГц. */
function wordOf(id: string, audio: { samples: Float32Array; sampleRate: number }): SyntheticWord {
  const speech = resample(Float32Array.from(audio.samples), audio.sampleRate, RATE);
  const lead = Math.round(LEAD_SEC * RATE);
  const samples = new Float32Array(lead + speech.length + RATE / 2);
  speech.forEach((value, index) => {
    samples[lead + index] = Math.max(-32768, Math.min(32767, value * 32767));
  });
  return { id, samples, endSec: LEAD_SEC + speechEndSec(speech) };
}

export function syntheticWords(): SyntheticWord[] {
  const out: SyntheticWord[] = [];
  for (const voice of VOICES) {
    const tts = ttsOf(voice);
    for (const text of TEXTS) {
      for (const speed of SPEEDS) {
        for (let repeat = 0; repeat < REPEATS; repeat += 1) {
          const audio = tts.generate({ text, sid: 0, speed });
          out.push(wordOf(`${voice.id}-${text}-${String(speed)}-${String(repeat)}`, audio));
        }
      }
    }
  }
  return out;
}

/** Англійська модель LibriTTS-R: 904 диктори, тож модель слова не може спертися на тембр. */
const MANY: Voice = {
  id: 'libritts',
  dir: 'vits-piper-en_US-libritts_r-medium',
  model: 'en_US-libritts_r-medium.onnx',
  espeak: true,
};
const MANY_SPEAKERS = 904;
/** Англійське «Banshee» близьке до «Ба́нші»; «Bansh» — коротка вимова, як у власника. */
const MANY_TEXTS = ['Banshee.', 'Banshee!', 'Banshee?', 'Bansh.'];

/** count вимов випадковими дикторами, темпом 0,8–1,2 і текстами; набір повторюваний за seed. */
export function manySpeakerWords(count: number, seed: number): SyntheticWord[] {
  const tts = ttsOf(MANY);
  const rand = random(seed);
  const out: SyntheticWord[] = [];
  for (let index = 0; index < count; index += 1) {
    const sid = Math.floor(rand() * MANY_SPEAKERS);
    const text = MANY_TEXTS[Math.floor(rand() * MANY_TEXTS.length)] ?? 'Banshee.';
    const speed = 0.8 + rand() * 0.4;
    out.push(wordOf(`libritts-${String(sid)}-${text}`, tts.generate({ text, sid, speed })));
  }
  return out;
}
