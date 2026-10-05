// npm run stt -- --engine whisper [--audio-ctx 384] [--prompt] [--label назва]
// npm run stt -- --engine parakeet [--threads 4] — Parakeet TDT 0.6B v3 через sherpa-onnx на процесорі.
// Крок 0.3: розпізнає 50 записаних команд власника, міряє час кожної й пише результат у .data/stt/:
// <label>.json — тексти, час і WER; <label>.texts.json — { id: текст } для `npm run evals -- --texts`.
// Нікуди не відправляє: розпізнавання локальне, сервер whisper.cpp слухає лише 127.0.0.1 і живе, поки йде прогін.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { percentile } from '../../scripts/lib/evals/report.ts';
import { loadManifest } from '../recorder/storage.ts';
import sherpa from 'sherpa-onnx-node';
import { normalize, wordErrorRate } from './text.ts';

const RECORDINGS = resolve('.data/recordings');
const RESULTS = resolve('.data/stt');
const WHISPER_DIR = resolve('.data/tools/whisper-b5130-cuda12.4/Release');
const WHISPER_MODEL = resolve('.data/models/whisper/ggml-large-v3-turbo-q5_0.bin');
const PARAKEET_DIR = resolve('.data/models/parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
const PORT = 47822;
/** Назви, які найчастіше звучать у командах: підказка Whisper (initial prompt), 02-voice.md. */
const NAMES_PROMPT = 'Banshee, Chrome, Firefox, Spotify, Telegram, VS Code, YouTube, PowerShell.';
/** Ціль кроку 0.3 стосується фрази ~5 с; довгими вважаємо записи від 4 с. */
const LONG_SEC = 4;

interface Sample {
  readonly id: string;
  readonly reference: string;
  readonly path: string;
  readonly durationSec: number;
}

interface Engine {
  transcribe(path: string): Promise<string>;
  close(): void;
}

async function loadSamples(): Promise<Sample[]> {
  const manifest = await loadManifest(RECORDINGS);
  return manifest.entries
    .filter((entry) => entry.set === 'commands')
    .map((entry) => ({
      id: entry.file.replace(/\.wav$/, ''),
      reference: entry.text ?? '',
      path: join(RECORDINGS, entry.set, entry.file),
      durationSec: entry.durationSec,
    }));
}

function vramUsedMb(): number | undefined {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      { encoding: 'utf8' },
    );
    return Number(out.trim().split('\n')[0]);
  } catch {
    return undefined;
  }
}

async function waitReady(url: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`whisper-server завершився з кодом ${String(server.exitCode)}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // ще не слухає
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('whisper-server не відповів за 120 с');
}

async function whisperEngine(audioCtx: number, prompt: boolean): Promise<Engine> {
  const args = ['-m', WHISPER_MODEL, '-l', 'uk', '-nt', '-bs', '1', '-bo', '1'];
  args.push('--host', '127.0.0.1', '--port', String(PORT), '-ac', String(audioCtx));
  if (prompt) args.push('--prompt', NAMES_PROMPT);
  const server = spawn(join(WHISPER_DIR, 'whisper-server.exe'), args, {
    cwd: WHISPER_DIR,
    stdio: 'ignore',
    env: { ...process.env, CUDA_CACHE_MAXSIZE: String(4 * 1024 ** 3) },
  });
  const base = `http://127.0.0.1:${String(PORT)}`;
  await waitReady(`${base}/`, server);
  return {
    async transcribe(path) {
      const form = new FormData();
      form.append('file', new Blob([await readFile(path)], { type: 'audio/wav' }), 'audio.wav');
      form.append('response_format', 'json');
      form.append('temperature', '0.0');
      const response = await fetch(`${base}/inference`, { method: 'POST', body: form });
      const body = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || typeof body.text !== 'string') {
        throw new Error(`whisper-server: ${body.error ?? String(response.status)}`);
      }
      return body.text.trim();
    },
    close: () => server.kill(),
  };
}

function parakeetEngine(threads: number): Engine {
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(PARAKEET_DIR, 'encoder.int8.onnx'),
        decoder: join(PARAKEET_DIR, 'decoder.int8.onnx'),
        joiner: join(PARAKEET_DIR, 'joiner.int8.onnx'),
      },
      tokens: join(PARAKEET_DIR, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  return {
    transcribe(path) {
      const stream = recognizer.createStream();
      stream.acceptWaveform(sherpa.readWave(path));
      recognizer.decode(stream);
      return Promise.resolve(recognizer.getResult(stream).text.trim());
    },
    close: () => undefined,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      engine: { type: 'string', default: 'whisper' },
      'audio-ctx': { type: 'string', default: '0' },
      prompt: { type: 'boolean', default: false },
      label: { type: 'string' },
      threads: { type: 'string', default: '4' },
    },
  });
  if (values.engine !== 'whisper' && values.engine !== 'parakeet') {
    throw new Error(`Невідомий рушій: ${values.engine}`);
  }
  const audioCtx = Number(values['audio-ctx']);
  const threads = Number(values.threads);
  const label =
    values.label ??
    (values.engine === 'parakeet'
      ? `parakeet-v3-int8-t${String(threads)}`
      : `whisper-turbo-q5-ac${String(audioCtx)}${values.prompt ? '-prompt' : ''}`);
  const samples = await loadSamples();
  if (samples.length === 0) throw new Error(`Записів команд немає: ${RECORDINGS}`);

  const vramBefore = vramUsedMb();
  const engine =
    values.engine === 'parakeet'
      ? parakeetEngine(threads)
      : await whisperEngine(audioCtx, values.prompt);
  try {
    // Перший виклик розганяє відеокарту й завантажує ядра — його не рахуємо.
    const first = samples[0];
    if (first) await engine.transcribe(first.path);
    const vramAfter = vramUsedMb();

    const items = [];
    for (const sample of samples) {
      const started = performance.now();
      const text = await engine.transcribe(sample.path);
      const ms = Math.round(performance.now() - started);
      const wer = wordErrorRate(sample.reference, text);
      items.push({ ...sample, text, ms, wer });
      console.log(
        `${String(ms).padStart(5)} мс  ${wer === 0 ? '=' : '≠'} ${sample.id}: «${text}»` +
          (wer === 0 ? '' : ` — мало бути «${sample.reference}»`),
      );
    }

    const times = items.map((item) => item.ms);
    const long = items.filter((item) => item.durationSec >= LONG_SEC).map((item) => item.ms);
    const summary = {
      count: items.length,
      p50Ms: percentile(times, 0.5),
      p90Ms: percentile(times, 0.9),
      longCount: long.length,
      longP50Ms: percentile(long, 0.5),
      werMean: items.reduce((sum, item) => sum + item.wer, 0) / items.length,
      exact: items.filter((item) => normalize(item.text) === normalize(item.reference)).length,
      vramMb:
        vramBefore !== undefined && vramAfter !== undefined ? vramAfter - vramBefore : undefined,
    };
    await mkdir(RESULTS, { recursive: true });
    const report = {
      label,
      engine: values.engine,
      audioCtx,
      prompt: values.prompt ? NAMES_PROMPT : null,
      startedAt: new Date().toISOString(),
      summary,
      items: items.map(({ id, reference, durationSec, text, ms, wer }) => ({
        id,
        reference,
        durationSec,
        text,
        ms,
        wer,
      })),
    };
    await writeFile(join(RESULTS, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
    const texts = Object.fromEntries(items.map((item) => [item.id, item.text]));
    await writeFile(join(RESULTS, `${label}.texts.json`), `${JSON.stringify(texts, null, 2)}\n`);
    console.log(
      `\n${label}: ${String(summary.count)} команд · час p50 ${String(summary.p50Ms)} мс, p90 ${String(summary.p90Ms)} мс · ` +
        `фрази від ${String(LONG_SEC)} с (${String(summary.longCount)}): p50 ${String(summary.longP50Ms)} мс · ` +
        `WER ${(summary.werMean * 100).toFixed(0)} % · дослівно ${String(summary.exact)} з ${String(summary.count)}` +
        (summary.vramMb === undefined ? '' : ` · відеопам'ять +${String(summary.vramMb)} МБ`),
    );
    console.log(`Тексти для Haiku: npm run evals -- --texts .data/stt/${label}.texts.json`);
  } finally {
    engine.close();
  }
}

await main();
