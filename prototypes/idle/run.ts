// npm run idle — крок 0.8: ресурси Banshee в спокої (N6: CPU < 3 %, RAM ≤ 1,5 ГБ) і час від запуску
// до готовності слухати, коли моделі лежать на HDD. Завантажує модель слова (ознаки openWakeWord +
// класифікатор), Silero VAD, відбиток голосу (TitaNet) і Parakeet, далі 60 с слухає звук кімнати
// потоком по 80 мс, як продукт. onnxruntime-node — першим: sherpa-onnx везе власний onnxruntime.dll.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { scorer, type Model } from '../wakeword/classifier.ts';
import { createStreamingFeatures, loadFeatureModels } from '../wakeword/features.ts';
import { pcmOf } from '../recorder/analyze.ts';
import sherpa from 'sherpa-onnx-node';

const MODELS = resolve('.data/models');
const RATE = 16_000;
const STEP = 1280; // 80 мс
const WINDOW = Math.round(1.76 * RATE); // вікно ознак слова: 16 кроків по 80 мс + поле
const LISTEN_SEC = 60;

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(0);
const since = (start: number): string => ((performance.now() - start) / 1000).toFixed(2);

function loadModel(path: string): Model {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const floats = (key: string): Float32Array => Float32Array.from(raw[key] as number[]);
  return {
    dim: raw.dim as number,
    hidden: raw.hidden as number,
    w1: floats('w1'),
    b1: floats('b1'),
    w2: floats('w2'),
    b2: raw.b2 as number,
    mean: floats('mean'),
    scale: floats('scale'),
  };
}

export interface IdleReport {
  readonly loadSec: Record<string, string>;
  readonly rssMb: { readonly wake: number; readonly loaded: number; readonly peak: number };
  readonly cpu: { readonly oneCorePct: number; readonly totalPct: number; readonly cores: number };
}

export async function measureIdle(): Promise<IdleReport> {
  const started = performance.now();
  const timings: Record<string, string> = {};

  let step = performance.now();
  const features = createStreamingFeatures(await loadFeatureModels(1));
  const wake = scorer(loadModel(resolve('.data/wakeword/model-owner-near.json')));
  timings['модель слова'] = since(step);

  step = performance.now();
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: join(MODELS, 'vad/silero_vad.onnx'),
        threshold: 0.5,
        minSilenceDuration: 0.5,
        windowSize: 512,
      },
      sampleRate: RATE,
      numThreads: 1,
      debug: 0,
    },
    30,
  );
  timings['VAD'] = since(step);

  step = performance.now();
  const voice = new sherpa.SpeakerEmbeddingExtractor({
    model: join(MODELS, 'voiceprint/nemo_en_titanet_small.onnx'),
    numThreads: 1,
    debug: 0,
  });
  timings['відбиток голосу'] = since(step);
  const afterWake = process.memoryUsage().rss;

  step = performance.now();
  const parakeetDir = join(MODELS, 'parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(parakeetDir, 'encoder.int8.onnx'),
        decoder: join(parakeetDir, 'decoder.int8.onnx'),
        joiner: join(parakeetDir, 'joiner.int8.onnx'),
      },
      tokens: join(parakeetDir, 'tokens.txt'),
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  timings['Parakeet'] = since(step);
  timings['усього до готовності'] = since(started);
  const loaded = process.memoryUsage().rss;

  // Звук кімнати власника по колу — як мікрофон у спокої.
  const roomDir = resolve('.data/recordings/background');
  const room = Float32Array.from(
    pcmOf(
      readFileSync(
        join(roomDir, readdirSync(roomDir).filter((name) => name.endsWith('.wav'))[0] ?? ''),
      ),
    ),
  );
  const buffer = new Float32Array(WINDOW);
  let offset = 0;
  let maxScore = 0;
  let speech = 0;
  let peakRss = loaded;
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  for (let tick = 0; tick < (LISTEN_SEC * RATE) / STEP; tick += 1) {
    const due = wallStart + ((tick + 1) * STEP * 1000) / RATE;
    const chunk = new Float32Array(STEP);
    for (let index = 0; index < STEP; index += 1)
      chunk[index] = room[(offset + index) % room.length] ?? 0;
    offset += STEP;
    buffer.copyWithin(0, STEP);
    buffer.set(chunk, WINDOW - STEP);
    // VAD: Silero ждуть вікна по 512 відліків у шкалі −1…1.
    const scaled = Float32Array.from(chunk, (value) => value / 32768);
    for (let index = 0; index + 512 <= scaled.length; index += 512)
      vad.acceptWaveform(scaled.subarray(index, index + 512));
    while (!vad.isEmpty()) {
      speech += 1;
      vad.pop();
    }
    const sequence = await features(chunk);
    if (sequence) maxScore = Math.max(maxScore, wake(sequence));
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    const wait = due - performance.now();
    if (wait > 0) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
  }
  const wallSec = (performance.now() - wallStart) / 1000;
  const cpu = process.cpuUsage(cpuStart);
  const cpuSec = (cpu.user + cpu.system) / 1e6;
  const cores = cpus().length;
  /** Parakeet і відбиток голосу лише тримаються в пам'яті — як у продукті між командами. */
  const held = [voice, recognizer].length;

  const report: IdleReport = {
    loadSec: timings,
    rssMb: {
      wake: Math.round(afterWake / 1048576),
      loaded: Math.round(loaded / 1048576),
      peak: Math.round(peakRss / 1048576),
    },
    cpu: {
      oneCorePct: (100 * cpuSec) / wallSec,
      totalPct: (100 * cpuSec) / wallSec / cores,
      cores,
    },
  };
  writeFileSync(resolve('.data/idle.json'), JSON.stringify(report, null, 2));
  console.log('Завантаження з HDD, с:');
  for (const [name, value] of Object.entries(timings)) console.log(`  ${name}: ${value}`);
  console.log(
    `RAM: модель слова, VAD і голос — ${mb(afterWake)} МБ; разом з Parakeet — ${mb(loaded)} МБ; пік — ${mb(peakRss)} МБ`,
  );
  console.log(
    `CPU у спокої (${String(LISTEN_SEC)} с, кроки по 80 мс): ${((100 * cpuSec) / wallSec).toFixed(1)} % одного ядра, ` +
      `${((100 * cpuSec) / wallSec / cores).toFixed(1)} % усього процесора (${String(cores)} ядра)`,
  );
  console.log(
    `Слово: найвища оцінка ${maxScore.toFixed(3)}; відрізків мови за VAD: ${String(speech)}; ` +
      `моделей розпізнавання в пам'яті: ${String(held)}`,
  );
  return report;
}

if (process.argv[1]?.endsWith('run.ts')) await measureIdle();
