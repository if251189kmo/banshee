// Розбіжність потокових і пакетних ознак слова на серії «Banshee» з 3 м (крок 0.5, ітерація 5).
// Пакетні — як у навчанні (вся серія одним входом), потокові — як у продукті (кроки по 80 мс).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CHUNK,
  createStreamingFeatures,
  decodeWav,
  loadFeatureSessions,
  parseWakeModel,
  wakeScorer,
} from '../src/index.ts';
import { embeddingsOf, loadFeatureModels, sequenceAt } from '../../../prototypes/wakeword/features.ts';
import { frameLevels, wakeStats } from '../../../prototypes/recorder/analyze.ts';

const DATA = resolve('.data');
const series = decodeWav(readFileSync(join(DATA, 'recordings/wake/far-quiet.wav'))).samples;
const pcm = Float32Array.from(series, (value) => value * 32768);
const words = wakeStats(frameLevels(Int16Array.from(pcm)), []).words;
const score = wakeScorer(parseWakeModel(readFileSync(join(DATA, 'wakeword/model-owner-near.json'), 'utf8')));

const batch = await embeddingsOf(await loadFeatureModels(2), pcm);
const batchScores = batch.map((_, index) => {
  const sequence = sequenceAt(batch, index);
  return sequence ? score(sequence) : 0;
});
const sessions = await loadFeatureSessions(
  join(DATA, 'models/oww/melspectrogram.onnx'),
  join(DATA, 'models/oww/embedding_model.onnx'),
);
for (const context of [0, 38, 1000]) {
  const stream = createStreamingFeatures(sessions, { contextChunks: context });
  const streamScores: number[] = [];
  const streamEmbeddings: Float32Array[] = [];
  for (let offset = 0; offset + CHUNK <= pcm.length; offset += CHUNK) {
    const sequence = await stream.push(pcm.slice(offset, offset + CHUNK));
    streamScores.push(sequence ? score(sequence) : 0);
    if (sequence) streamEmbeddings.push(sequence.slice(15 * 96));
  }
  // Крок потоку k (кінець звуку (k+1)·80 мс) ↔ пакетна ознака з тим самим кінцем вікна.
  const at = (scores: number[], word: { endMs: number }, shift: number) => {
    let peak = 0;
    for (let ms = word.endMs - 400; ms <= word.endMs + 800; ms += 80) {
      const index = Math.round(ms / 80) + shift;
      peak = Math.max(peak, scores[index] ?? 0);
    }
    return peak;
  };
  let batchHits = 0;
  let streamHits = 0;
  const rows: string[] = [];
  for (const word of words) {
    const b = at(batchScores, word, -10);
    const s = at(streamScores, word, -1);
    if (b >= 0.97) batchHits += 1;
    if (s >= 0.97) streamHits += 1;
    rows.push(`${b.toFixed(2)}/${s.toFixed(2)}`);
  }
  console.log(`context ${String(context)}: пакетні ${String(batchHits)} з ${String(words.length)}, потокові ${String(streamHits)}`);
  console.log(rows.join(' '));
}
