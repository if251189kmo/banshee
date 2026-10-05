// Ознаки звуку для власної моделі слова (крок 0.5): мел-спектрограма й ознаки мовлення openWakeWord.
// Моделі: melspectrogram.onnx (перетворення без навчання) і embedding_model.onnx — перенесена Google
// speech_embedding (Apache 2.0). 96 чисел кожні 80 мс; вікно класифікатора — 16 таких кроків, ≈ 2 с звуку.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ort from 'onnxruntime-node';

const MODELS = resolve('.data/models/oww');
/** Кадри мел-спектрограми — 10 мс; вікно моделі ознак — 76 кадрів, крок — 8 (80 мс). */
export const MEL_WINDOW = 76;
export const MEL_STEP = 8;
export const MEL_BINS = 32;
export const EMBEDDING_DIM = 96;
export const SEQUENCE = 16;
const BATCH = 256;

export interface FeatureModels {
  readonly mel: ort.InferenceSession;
  readonly embedding: ort.InferenceSession;
}

/** threads — потоки процесора на модель: 2 у продукті, більше — для перерахунку годин подкастів. */
export async function loadFeatureModels(threads = 2): Promise<FeatureModels> {
  const options: ort.InferenceSession.SessionOptions = { intraOpNumThreads: threads };
  return {
    mel: await ort.InferenceSession.create(join(MODELS, 'melspectrogram.onnx'), options),
    embedding: await ort.InferenceSession.create(join(MODELS, 'embedding_model.onnx'), options),
  };
}

/** Кінець вікна ознаки з номером index, секунди від початку звуку. */
export function embeddingEndSec(index: number): number {
  return (index * MEL_STEP + MEL_WINDOW) / 100;
}

/**
 * Ознаки мовлення звуку: масив по EMBEDDING_DIM чисел на кожні 80 мс.
 * samples — PCM 16 біт, 16 кГц, значення від −32768 до 32767 (так їх чекає openWakeWord).
 */
export async function embeddingsOf(
  models: FeatureModels,
  samples: Float32Array,
): Promise<Float32Array[]> {
  if (samples.length < 16_000) return [];
  const melOut = await models.mel.run({
    input: new ort.Tensor('float32', samples, [1, samples.length]),
  });
  const melTensor = Object.values(melOut)[0];
  if (!melTensor) throw new Error('melspectrogram: немає виходу');
  const melData = melTensor.data as Float32Array;
  const frames = melData.length / MEL_BINS;
  // Як в openWakeWord: x / 10 + 2.
  const mel = Float32Array.from(melData, (value) => value / 10 + 2);
  const windows: number[] = [];
  for (let start = 0; start + MEL_WINDOW <= frames; start += MEL_STEP) windows.push(start);
  const result: Float32Array[] = [];
  for (let offset = 0; offset < windows.length; offset += BATCH) {
    const chunk = windows.slice(offset, offset + BATCH);
    const batch = new Float32Array(chunk.length * MEL_WINDOW * MEL_BINS);
    chunk.forEach((start, index) => {
      batch.set(
        mel.subarray(start * MEL_BINS, (start + MEL_WINDOW) * MEL_BINS),
        index * MEL_WINDOW * MEL_BINS,
      );
    });
    const out = await models.embedding.run({
      input_1: new ort.Tensor('float32', batch, [chunk.length, MEL_WINDOW, MEL_BINS, 1]),
    });
    const tensor = Object.values(out)[0];
    if (!tensor) throw new Error('embedding_model: немає виходу');
    const data = tensor.data as Float32Array;
    for (let index = 0; index < chunk.length; index += 1) {
      result.push(data.slice(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM));
    }
  }
  return result;
}

/**
 * Вхід класифікатора: SEQUENCE ознак поспіль, що закінчуються ознакою last, одним вектором.
 * out — готовий масив, щоб прохід по годинах звуку не виділяв пам'ять на кожен крок.
 */
export function sequenceAt(
  embeddings: readonly Float32Array[],
  last: number,
  out = new Float32Array(SEQUENCE * EMBEDDING_DIM),
): Float32Array | null {
  const first = last - SEQUENCE + 1;
  if (first < 0 || last >= embeddings.length) return null;
  for (let index = 0; index < SEQUENCE; index += 1) {
    const embedding = embeddings[first + index];
    if (!embedding) return null;
    out.set(embedding, index * EMBEDDING_DIM);
  }
  return out;
}

const CACHE = resolve('.data/wakeword/cache');

/**
 * Ознаки з кешу на диску (.data/wakeword/cache/<key>.f32) або пораховані й збережені туди:
 * повторні прогони експерименту не рахують години подкастів наново.
 */
export async function cachedEmbeddings(
  models: FeatureModels,
  key: string,
  load: () => Float32Array,
): Promise<Float32Array[]> {
  const file = join(CACHE, `${key}.f32`);
  if (existsSync(file)) {
    const buffer = await readFile(file);
    const all = new Float32Array(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    const result: Float32Array[] = [];
    for (let offset = 0; offset + EMBEDDING_DIM <= all.length; offset += EMBEDDING_DIM) {
      result.push(all.slice(offset, offset + EMBEDDING_DIM));
    }
    return result;
  }
  const result = await embeddingsOf(models, load());
  await mkdir(CACHE, { recursive: true });
  const all = new Float32Array(result.length * EMBEDDING_DIM);
  result.forEach((embedding, index) => {
    all.set(embedding, index * EMBEDDING_DIM);
  });
  await writeFile(file, Buffer.from(all.buffer));
  return result;
}

/** Звуку на крок потоку: 80 мс нового й 30 мс попереднього — мел-кадри стикуються без розриву. */
export const STREAM_STEP = 1280;
const STREAM_OVERLAP = 480;

/**
 * Потокові ознаки, як в openWakeWord: кожні 80 мс — мел-кадри лише нового звуку (8 кадрів по 10 мс,
 * вікно 512 відліків) і одна нова ознака мовлення. Ознака береться з 76 кадрів без найновішого: тоді
 * вікна збігаються з пакетними (embeddingsOf), на яких навчено класифікатор; інакше зсув на 10 мс
 * утричі зменшує влучання. Повертає послідовність для класифікатора, коли її вже набралося.
 */
export function createStreamingFeatures(models: FeatureModels) {
  let tail = new Float32Array(STREAM_OVERLAP);
  let mel: Float32Array = new Float32Array(0);
  const embeddings: Float32Array[] = [];
  return async (chunk: Float32Array): Promise<Float32Array | null> => {
    if (chunk.length !== STREAM_STEP)
      throw new Error(`Крок потоку — ${String(STREAM_STEP)} відліків`);
    const audio = new Float32Array(STREAM_OVERLAP + STREAM_STEP);
    audio.set(tail);
    audio.set(chunk, STREAM_OVERLAP);
    tail = chunk.slice(STREAM_STEP - STREAM_OVERLAP);
    const melOut = await models.mel.run({
      input: new ort.Tensor('float32', audio, [1, audio.length]),
    });
    const tensor = Object.values(melOut)[0];
    if (!tensor) throw new Error('melspectrogram: немає виходу');
    const frames = Float32Array.from(tensor.data as Float32Array, (value) => value / 10 + 2);
    const joined = new Float32Array(mel.length + frames.length);
    joined.set(mel);
    joined.set(frames, mel.length);
    mel = joined.slice(Math.max(0, joined.length - (MEL_WINDOW + 1) * MEL_BINS));
    if (mel.length < (MEL_WINDOW + 1) * MEL_BINS) return null;
    const window = mel.slice(0, MEL_WINDOW * MEL_BINS);
    const out = await models.embedding.run({
      input_1: new ort.Tensor('float32', window, [1, MEL_WINDOW, MEL_BINS, 1]),
    });
    const embedding = Object.values(out)[0];
    if (!embedding) throw new Error('embedding_model: немає виходу');
    embeddings.push(Float32Array.from(embedding.data as Float32Array));
    if (embeddings.length > SEQUENCE) embeddings.shift();
    return sequenceAt(embeddings, embeddings.length - 1);
  };
}
