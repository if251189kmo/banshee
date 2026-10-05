// npm run voiceprint — крок 0.6: чи відрізняє відбиток голосу власника від чужих голосів.
// Профіль — 5 фраз запису, як у майстрі; власник — 50 команд, чужі — 20 кліпів ТБ і відео, усе з .data/recordings.
// Кожна модель відбитків з .data/models/voiceprint: похибки в обидва боки, поріг і час. Лише читає записи.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { clipStats, pcmOf } from '../recorder/analyze.ts';
import { loadManifest, type ManifestEntry } from '../recorder/storage.ts';
import { percentile } from '../../scripts/lib/evals/report.ts';
import { cosine, equalErrorRate, profileOf, ratesAt, thresholdForFar } from './score.ts';

const RECORDINGS = resolve('.data/recordings');
const MODELS = resolve('.data/models/voiceprint');
const RESULTS = resolve('.data/voiceprint');
const SAMPLE_RATE = 16_000;
/** Ціль F9: власника не впізнано ≤ 5 %, чужих прийнято ≤ 5 % (07-quality.md). */
const TARGET = 0.05;
/** Поля навколо мови: фраза в продукті — відрізок VAD, а не запис з тишею по краях. */
const MARGIN_MS = 100;

interface Clip {
  readonly id: string;
  readonly samples: Float32Array;
}

async function loadClips(entries: readonly ManifestEntry[], trim: boolean): Promise<Clip[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const path = join(RECORDINGS, entry.set, entry.file);
      const pcm = pcmOf(await readFile(path));
      let from = 0;
      let to = pcm.length;
      const speech = trim ? clipStats(pcm).speech : null;
      if (speech) {
        from = Math.max(0, ((speech.startMs - MARGIN_MS) * SAMPLE_RATE) / 1000);
        to = Math.min(pcm.length, ((speech.endMs + MARGIN_MS) * SAMPLE_RATE) / 1000);
      }
      const samples = Float32Array.from(pcm.subarray(from, to), (value) => value / 32768);
      return { id: `${entry.set}/${entry.file}`, samples };
    }),
  );
}

function embedder(model: string): (clip: Clip) => Float32Array {
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: 2, debug: 0 });
  return (clip) => {
    const stream = extractor.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: clip.samples });
    stream.inputFinished();
    if (!extractor.isReady(stream)) throw new Error(`Закороткий запис: ${clip.id}`);
    return Float32Array.from(extractor.compute(stream));
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(0)} %`;

async function main(): Promise<void> {
  const manifest = await loadManifest(RECORDINGS);
  const bySet = (set: string): ManifestEntry[] =>
    manifest.entries.filter((entry) => entry.set === set);
  const profile = await loadClips(bySet('profile'), true);
  const owner = await loadClips(bySet('commands'), true);
  const others = await loadClips(bySet('foreign'), false);
  if (profile.length === 0 || owner.length === 0 || others.length === 0) {
    throw new Error('Потрібні записи profile, commands і foreign (npm run recorder)');
  }
  console.log(
    `Профіль — ${String(profile.length)} фраз, власник — ${String(owner.length)} команд, чужі — ${String(others.length)} кліпів`,
  );

  const models = (await readdir(MODELS)).filter((name) => name.endsWith('.onnx')).sort();
  const results = [];
  for (const name of models) {
    const embed = embedder(join(MODELS, name));
    const enrolled = profileOf(profile.map(embed));
    const times: number[] = [];
    const score = (clip: Clip): { id: string; score: number } => {
      const started = performance.now();
      const value = cosine(enrolled, embed(clip));
      times.push(performance.now() - started);
      return { id: clip.id, score: value };
    };
    const ownerScores = owner.map(score);
    const otherScores = others.map(score);
    const o = ownerScores.map((item) => item.score);
    const x = otherScores.map((item) => item.score);
    const eer = equalErrorRate(o, x);
    const strict = thresholdForFar(o, x, TARGET);
    const atEer = ratesAt(o, x, eer.threshold);
    const meetsTarget = strict.frr <= TARGET && strict.far <= TARGET;
    const lowestOwner = [...ownerScores].sort((a, b) => a.score - b.score).slice(0, 3);
    const highestOther = [...otherScores].sort((a, b) => b.score - a.score).slice(0, 3);
    results.push({
      model: name,
      eer: eer.eer,
      eerThreshold: eer.threshold,
      atEer,
      forFar5: strict,
      meetsTarget,
      ownerMin: Math.min(...o),
      othersMax: Math.max(...x),
      embedMsP50: percentile(times, 0.5),
      lowestOwner,
      highestOther,
    });
    console.log(
      `\n${name}\n  рівна похибка ${pct(eer.eer)} на порозі ${eer.threshold.toFixed(3)}; ` +
        `за чужих ≤ 5 %: поріг ${strict.threshold.toFixed(3)}, власника не впізнано ${pct(strict.frr)}, чужих прийнято ${pct(strict.far)} — ` +
        `${meetsTarget ? 'ціль F9 виконано' : 'ціль F9 НЕ виконано'}\n` +
        `  власник: найнижча схожість ${Math.min(...o).toFixed(3)}; чужі: найвища ${Math.max(...x).toFixed(3)}; ` +
        `відбиток фрази — ${percentile(times, 0.5).toFixed(0)} мс (p50)\n` +
        `  найгірші фрази власника: ${lowestOwner.map((item) => `${item.id} ${item.score.toFixed(3)}`).join(', ')}\n` +
        `  найсхожіші чужі: ${highestOther.map((item) => `${item.id} ${item.score.toFixed(3)}`).join(', ')}`,
    );
  }
  await mkdir(RESULTS, { recursive: true });
  await writeFile(
    join(RESULTS, 'results.json'),
    `${JSON.stringify({ startedAt: new Date().toISOString(), counts: { profile: profile.length, owner: owner.length, others: others.length }, results }, null, 2)}\n`,
  );
  console.log('\nЗвіт: .data/voiceprint/results.json');
}

await main();
