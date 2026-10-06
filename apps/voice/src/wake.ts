// Слово «Banshee» (.claude/logic/02-voice.md, «Слово "Banshee"»; рішення власника 2026-10-05):
// ознаки openWakeWord — мел-спектрограма й ознаки мовлення (Google speech_embedding, Apache 2.0)
// через onnxruntime-node — і мала нейромережа над 16 ознаками поспіль (≈ 2 с звуку).
// Друга сходинка — голос власника на «слово + команда» — у listener.ts і speaker.ts.
import { readFile } from 'node:fs/promises';
import ort from 'onnxruntime-node';
import { CHUNK } from './audio.ts';
export { WAKE_THRESHOLDS } from './thresholds.ts';

const MEL_WINDOW = 76;
const MEL_BINS = 32;
const MEL_STEP = 8;
const EMBEDDING_DIM = 96;
export const WAKE_SEQUENCE = 16;
/** 30 мс попереднього звуку до кожного кроку: мел-кадри стикуються без розриву. */
const OVERLAP = 480;

export interface WakeModel {
  readonly dim: number;
  readonly hidden: number;
  readonly w1: Float32Array;
  readonly b1: Float32Array;
  readonly w2: Float32Array;
  readonly b2: number;
  readonly mean: Float32Array;
  readonly scale: Float32Array;
}

/** Модель слова з JSON, який пише навчання (prototypes/wakeword, у продукті — «Навчити слово»). */
export function parseWakeModel(json: string): WakeModel {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const floats = (key: string): Float32Array => {
    const value = raw[key];
    if (!Array.isArray(value)) throw new Error(`Модель слова: немає ${key}`);
    return Float32Array.from(value as number[]);
  };
  const dim = Number(raw.dim);
  const hidden = Number(raw.hidden);
  const model = {
    dim,
    hidden,
    w1: floats('w1'),
    b1: floats('b1'),
    w2: floats('w2'),
    b2: Number(raw.b2),
    mean: floats('mean'),
    scale: floats('scale'),
  };
  if (dim !== WAKE_SEQUENCE * EMBEDDING_DIM || model.w1.length !== dim * hidden)
    throw new Error('Модель слова не під ознаки openWakeWord');
  return model;
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

/** Оцінка 0…1 для послідовності ознак; без виділення пам'яті на кожен виклик. */
export function wakeScorer(model: WakeModel): (sequence: Float32Array) => number {
  const input = new Float32Array(model.dim);
  return (sequence) => {
    for (let index = 0; index < model.dim; index += 1)
      input[index] =
        ((sequence[index] ?? 0) - (model.mean[index] ?? 0)) * (model.scale[index] ?? 1);
    let out = model.b2;
    for (let unit = 0; unit < model.hidden; unit += 1) {
      let sum = model.b1[unit] ?? 0;
      const offset = unit * model.dim;
      for (let index = 0; index < model.dim; index += 1)
        sum += (model.w1[offset + index] ?? 0) * (input[index] ?? 0);
      if (sum > 0) out += (model.w2[unit] ?? 0) * sum;
    }
    return sigmoid(out);
  };
}

export interface FeatureSessions {
  readonly mel: ort.InferenceSession;
  readonly embedding: ort.InferenceSession;
}

export async function loadFeatureSessions(
  melPath: string,
  embeddingPath: string,
  threads = 1,
): Promise<FeatureSessions> {
  const options: ort.InferenceSession.SessionOptions = {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
  };
  return {
    mel: await ort.InferenceSession.create(melPath, options),
    embedding: await ort.InferenceSession.create(embeddingPath, options),
  };
}

export interface StreamingOptions {
  /**
   * Скільки останніх кроків задають поріг обрізання тихих кадрів. Мел-модель openWakeWord обрізає
   * кадри на 80 дБ нижче найгучнішого кадру входу; модель слова вчилась на пакетних ознаках
   * (серії по 78 с, кліпи по 3 с, епізоди подкастів), де поріг — від найгучнішого звуку кліпу,
   * а потік бачить лише 110 мс. Тут поріг — від найгучнішого кадру за стільки кроків; коли він росте,
   * 16 ознак вікна класифікатора перераховуються з новим порогом — як пакетні на цьому відрізку.
   * 0 — лише вікно кроку, як у openWakeWord.
   */
  readonly contextChunks: number;
}

/** 80 дБ у шкалі ознак (x / 10 + 2). */
const FLOOR_RANGE = 8;
/** Кадрів на 16 ознак: вікно 76 і 15 кроків по 8, плюс найновіший кадр, який ознака не бере. */
const HISTORY_FRAMES = MEL_WINDOW + (WAKE_SEQUENCE - 1) * MEL_STEP + 1;
/** Поріг виріс більше ніж на 3 дБ — ознаки вікна перераховуються. */
const FLOOR_STEP = 0.3;

/**
 * Потокові ознаки, як в openWakeWord: кожні 80 мс — 8 мел-кадрів нового звуку й одна нова ознака
 * мовлення з 76 кадрів без найновішого (так вікна збігаються з пакетними, на яких навчено модель).
 * Повертає послідовність 16 ознак для класифікатора, коли їх уже набралося.
 * samples — PCM у шкалі −32768…32767, як чекає openWakeWord.
 */
export function createStreamingFeatures(
  sessions: FeatureSessions,
  options: StreamingOptions = { contextChunks: 0 },
) {
  let tail = new Float32Array(OVERLAP);
  let frames = new Float32Array(0);
  const chunkPeaks: number[] = [];
  const embeddings: Float32Array[] = [];
  let floor = Number.NEGATIVE_INFINITY;
  const sequence = new Float32Array(WAKE_SEQUENCE * EMBEDDING_DIM);

  /** Ознака вікна, що закінчується перед кадром end (не включно), з порогом обрізання. */
  const embed = async (end: number, floorValue: number): Promise<Float32Array> => {
    const window = frames.slice((end - MEL_WINDOW) * MEL_BINS, end * MEL_BINS);
    if (floorValue > Number.NEGATIVE_INFINITY)
      for (let index = 0; index < window.length; index += 1)
        if ((window[index] ?? 0) < floorValue) window[index] = floorValue;
    const out = await sessions.embedding.run({
      input_1: new ort.Tensor('float32', window, [1, MEL_WINDOW, MEL_BINS, 1]),
    });
    const embedding = Object.values(out)[0];
    if (!embedding) throw new Error('embedding_model: немає виходу');
    return Float32Array.from(embedding.data as Float32Array);
  };

  return {
    async push(samples: Float32Array): Promise<Float32Array | null> {
      if (samples.length !== CHUNK) throw new Error(`Крок потоку — ${String(CHUNK)} відліків`);
      const audio = new Float32Array(OVERLAP + CHUNK);
      audio.set(tail);
      audio.set(samples, OVERLAP);
      tail = samples.slice(CHUNK - OVERLAP);
      const melOut = await sessions.mel.run({
        input: new ort.Tensor('float32', audio, [1, audio.length]),
      });
      const melTensor = Object.values(melOut)[0];
      if (!melTensor) throw new Error('melspectrogram: немає виходу');
      const fresh = Float32Array.from(melTensor.data as Float32Array, (value) => value / 10 + 2);
      const joined = new Float32Array(frames.length + fresh.length);
      joined.set(frames);
      joined.set(fresh, frames.length);
      frames = joined.slice(Math.max(0, joined.length - HISTORY_FRAMES * MEL_BINS));
      const total = frames.length / MEL_BINS;
      if (options.contextChunks > 0) {
        let peak = Number.NEGATIVE_INFINITY;
        for (const value of fresh) if (value > peak) peak = value;
        chunkPeaks.push(peak);
        if (chunkPeaks.length > options.contextChunks) chunkPeaks.shift();
      }
      if (total < MEL_WINDOW + 1) return null;
      const nextFloor =
        options.contextChunks > 0
          ? Math.max(...chunkPeaks) - FLOOR_RANGE
          : Number.NEGATIVE_INFINITY;
      if (nextFloor > floor + FLOOR_STEP) {
        // Гучніший звук: попередні ознаки вікна — з тим самим порогом, що й нова.
        for (let back = embeddings.length; back >= 1; back -= 1) {
          const end = total - 1 - back * MEL_STEP;
          if (end - MEL_WINDOW >= 0)
            embeddings[embeddings.length - back] = await embed(end, nextFloor);
        }
      }
      floor = nextFloor;
      embeddings.push(await embed(total - 1, floor));
      if (embeddings.length > WAKE_SEQUENCE) embeddings.shift();
      if (embeddings.length < WAKE_SEQUENCE) return null;
      embeddings.forEach((item, index) => {
        sequence.set(item, index * EMBEDDING_DIM);
      });
      return sequence;
    },
    reset(): void {
      tail = new Float32Array(OVERLAP);
      frames = new Float32Array(0);
      chunkPeaks.length = 0;
      embeddings.length = 0;
      floor = Number.NEGATIVE_INFINITY;
    },
  };
}

/** Поріг обрізання — від найгучнішого кадру за останні 3 с, як у доповнених кліпах навчання. */
export const WAKE_CONTEXT_CHUNKS = 38;

export interface WakeDetector {
  /** Оцінка слова для кроку 80 мс (−1…1) або null, поки ознак замало. */
  push(samples: Float32Array): Promise<number | null>;
  reset(): void;
}

export async function loadWakeDetector(
  paths: { readonly mel: string; readonly embedding: string; readonly model: string },
  options: StreamingOptions = { contextChunks: WAKE_CONTEXT_CHUNKS },
): Promise<WakeDetector> {
  const sessions = await loadFeatureSessions(paths.mel, paths.embedding);
  const features = createStreamingFeatures(sessions, options);
  const score = wakeScorer(parseWakeModel(await readFile(paths.model, 'utf8')));
  const scaled = new Float32Array(CHUNK);
  return {
    async push(samples) {
      for (let index = 0; index < CHUNK; index += 1) scaled[index] = (samples[index] ?? 0) * 32768;
      const sequence = await features.push(scaled);
      return sequence ? score(sequence) : null;
    },
    reset() {
      features.reset();
    },
  };
}
