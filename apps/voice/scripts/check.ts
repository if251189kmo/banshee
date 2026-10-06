// npm run voice:check — голосовий конвеєр продукту на записах етапу 0, без мікрофона
// (.claude/logic/02-voice.md, «Реалізація — етап 2»). Записи — біометричні дані власника: лише
// читаються з .data/, результат — числа в .data/voice-check.json.
//   А. Слово: серії «Banshee» потоком, як є, — ознаки й поріг продукту, пропуски й зайві спрацювання.
//   Б. Команди: 50 команд власника через кнопку мікрофона (без слова) — кінець фрази, Parakeet,
//      перевірка голосу, затримка.
//   В. «Слово + команда»: вимова з 1 м, якої модель не чула, і команда — передача від слова до команди.
// Тиша між фразами — з самих серій: шумоприглушення гарнітури дає там цифрову тишу ≈ −90 dBFS.
// --realtime — звук у реальному часі (≈ 10 хв): справжня затримка тексту після кінця мови.
// --map — карта кроків неточних випадків: . тиша, # мова, W слово, [стан].
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CHUNK,
  CHUNK_MS,
  DEFAULT_LISTENER,
  Listener,
  MODEL_PATHS,
  SAMPLE_RATE,
  TTS_MODEL_FILE,
  VOICE_THRESHOLDS,
  WAKE_CONTEXT_CHUNKS,
  WAKE_THRESHOLDS,
  concat,
  decodeWav,
  frequentPhrases,
  loadRecognizer,
  loadSpeechDetector,
  loadSynthesizer,
  loadVoicePrinter,
  loadWakeDetector,
  profileOf,
  type ListenerEvent,
} from '../src/index.ts';
import { frameLevels, wakeStats, type Segment } from '../../../prototypes/recorder/analyze.ts';
import { normalize, wordErrorRate } from '../../../prototypes/stt/text.ts';

const DATA = resolve('.data');
const MODELS = join(DATA, 'models');
const RECORDINGS = join(DATA, 'recordings');
const REALTIME = process.argv.includes('--realtime');
const MAP = process.argv.includes('--map');
const contextArg = process.argv.indexOf('--context');
const CONTEXT = contextArg > 0 ? Number(process.argv[contextArg + 1]) : WAKE_CONTEXT_CHUNKS;
const WAKE_MODEL = join(DATA, 'wakeword/model-owner-near.json');

interface Entry {
  readonly set: string;
  readonly file: string;
  readonly text?: string;
}

const seconds = (start: number): number => (performance.now() - start) / 1000;
const wav = (set: string, file: string): Float32Array =>
  decodeWav(readFileSync(join(RECORDINGS, set, file))).samples;
const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
};
const at = (ms: number): number => Math.round((ms * SAMPLE_RATE) / 1000);
const wordsOf = (samples: Float32Array): readonly Segment[] =>
  wakeStats(frameLevels(Int16Array.from(samples, (value) => Math.round(value * 32767))), []).words;

const manifest = JSON.parse(readFileSync(join(RECORDINGS, 'manifest.json'), 'utf8')) as {
  entries: Entry[];
};

const loads: Record<string, number> = {};
let started = performance.now();
const wakePaths = {
  mel: join(MODELS, MODEL_PATHS.mel),
  embedding: join(MODELS, MODEL_PATHS.embedding),
  model: WAKE_MODEL,
};
const wake = await loadWakeDetector(wakePaths, { contextChunks: CONTEXT });
loads.wake = seconds(started);
started = performance.now();
const vad = loadSpeechDetector(join(MODELS, MODEL_PATHS.vad));
loads.vad = seconds(started);
started = performance.now();
const printer = loadVoicePrinter(join(MODELS, MODEL_PATHS.voiceprint));
loads.voiceprint = seconds(started);
started = performance.now();
const recognizer = await loadRecognizer(join(MODELS, MODEL_PATHS.parakeet));
loads.parakeet = seconds(started);
started = performance.now();
const synthesizer = await loadSynthesizer(join(MODELS, MODEL_PATHS.tts), TTS_MODEL_FILE);
loads.tts = seconds(started);
console.log(
  `Моделі, с: ${Object.entries(loads)
    .map(([name, value]) => `${name} ${value.toFixed(2)}`)
    .join(', ')}`,
);

// Профіль голосу — з 5 фраз запису, як «Мій голос» у майстрі.
const profile = profileOf(
  manifest.entries
    .filter((entry) => entry.set === 'profile')
    .flatMap((entry) => {
      const embedding = printer.embed(wav(entry.set, entry.file));
      return embedding ? [embedding] : [];
    }),
);

// А. Слово: серії потоком. Влучання — спрацювання від 0,4 с до кінця слова до 0,8 с після.
const wakeRows: Record<string, unknown>[] = [];
for (const name of ['near-quiet', 'far-quiet', 'near-music', 'far-music']) {
  const samples = wav('wake', `${name}.wav`);
  const detector = await loadWakeDetector(wakePaths, { contextChunks: CONTEXT });
  const fired: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset + CHUNK <= samples.length; offset += CHUNK) {
    const score = await detector.push(samples.subarray(offset, offset + CHUNK));
    const ms = ((offset + CHUNK) * 1000) / SAMPLE_RATE;
    if (
      score !== null &&
      score >= WAKE_THRESHOLDS.medium &&
      ms - last >= DEFAULT_LISTENER.refractoryMs
    ) {
      fired.push(ms);
      last = ms;
    }
  }
  if (name.endsWith('quiet')) {
    const words = wordsOf(samples);
    const near = (ms: number, word: Segment): boolean =>
      ms >= word.endMs - 400 && ms <= word.endMs + 800;
    const hit = words.filter((word) => fired.some((ms) => near(ms, word))).length;
    const extra = fired.filter((ms) => !words.some((word) => near(ms, word))).length;
    wakeRows.push({ series: name, words: words.length, hit, extra });
    console.log(
      `А. Слово, ${name}: ${String(hit)} з ${String(words.length)} — пропуски ${((100 * (words.length - hit)) / words.length).toFixed(0)} %, зайвих ${String(extra)}`,
    );
  } else {
    wakeRows.push({ series: name, fired: fired.length });
    console.log(`А. Слово, ${name}: спрацювань ${String(fired.length)} на ≈ 25 вимов під музику`);
  }
}

// Тиша гарнітури між словами серії з 1 м — заповнювач пауз.
const nearSeries = wav('wake', 'near-quiet.wav');
const nearWords = wordsOf(nearSeries);
const gaps = nearWords.slice(1).flatMap((word, index) => {
  const previous = nearWords[index];
  if (!previous || word.startMs - previous.endMs < 1500) return [];
  return [nearSeries.slice(at(previous.endMs + 300), at(word.startMs - 300))];
});
const silenceBank = concat(gaps);
let silenceOffset = 0;
const silence = (ms: number): Float32Array => {
  const length = at(ms);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1)
    out[index] = silenceBank[(silenceOffset + index) % silenceBank.length] ?? 0;
  silenceOffset += length;
  return out;
};
/** Вимови з 1 м, на яких модель не вчилась: навчання брало 10 рівномірно з серії. */
const trained = new Set(
  Array.from({ length: 10 }, (_, index) => Math.floor((index * nearWords.length) / 10)),
);
const unseenWords = nearWords
  .filter((_, index) => !trained.has(index))
  .map((word) => nearSeries.slice(at(word.startMs - 150), at(word.endMs + 150)));

const events: ListenerEvent[] = [];
const probe = { speech: false };
const listener = new Listener(
  {
    wake: (chunk) => wake.push(chunk),
    speech: (chunk) => (probe.speech = vad.push(chunk)),
    recognize: (samples) => recognizer.recognize(samples),
    embed: (samples) => printer.embed(samples),
    profile: () => profile,
    now: () => performance.now(),
  },
  {
    ...DEFAULT_LISTENER,
    wakeThreshold: WAKE_THRESHOLDS.medium,
    voiceThreshold: VOICE_THRESHOLDS.medium,
  },
  (event) => {
    events.push(event);
  },
);

interface CaseResult {
  readonly part: 'Б' | 'В';
  readonly file: string;
  readonly text: string | null;
  readonly wake: boolean | null;
  readonly heard: boolean;
  readonly exact: boolean;
  readonly wer: number;
  readonly voiceScore: number | null;
  readonly owner: boolean | null;
  readonly sttMs: number | null;
  readonly textAfterSpeechMs: number | null;
  readonly speculative: boolean | null;
}

async function feed(stream: Float32Array): Promise<string> {
  let map = '';
  for (let offset = 0; offset + CHUNK <= stream.length; offset += CHUNK) {
    const due = performance.now() + CHUNK_MS;
    const before = events.length;
    await listener.push(stream.subarray(offset, offset + CHUNK));
    map += probe.speech ? '#' : '.';
    for (const event of events.slice(before)) {
      if (event.type === 'wake') map += 'W';
      if (event.type === 'state') map += `[${event.state.slice(0, 3)}]`;
    }
    if (REALTIME) {
      const wait = due - performance.now();
      if (wait > 0) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
    }
  }
  await listener.settled();
  return map;
}

function result(part: 'Б' | 'В', entry: Entry, wakeExpected: boolean): CaseResult {
  const command = events.find((event) => event.type === 'command');
  const expected = entry.text ?? '';
  return {
    part,
    file: entry.file,
    text: command?.text ?? null,
    wake: wakeExpected ? events.some((event) => event.type === 'wake') : null,
    heard: command !== undefined,
    exact: command !== undefined && normalize(command.text) === normalize(expected),
    wer: command ? wordErrorRate(expected, command.text) : 1,
    voiceScore: command?.voice?.score ?? null,
    owner: command?.voice?.owner ?? null,
    sttMs: command ? command.timing.recognizedAt - command.timing.decidedAt : null,
    textAfterSpeechMs: command ? command.timing.recognizedAt - command.timing.speechEndAt : null,
    speculative: command?.timing.speculative ?? null,
  };
}

const commands = manifest.entries.filter((entry) => entry.set === 'commands');
const results: CaseResult[] = [];
const cpuStart = process.cpuUsage();
const wallStart = performance.now();

// Б. Команди через кнопку мікрофона.
for (const entry of commands) {
  events.length = 0;
  listener.reset();
  await feed(silence(400));
  listener.listenNow();
  const map = await feed(concat([wav(entry.set, entry.file), silence(1500)]));
  results.push(result('Б', entry, false));
  if (MAP && results.at(-1)?.exact !== true) console.log(`Б ${entry.file}: ${map}`);
}

// В. «Banshee» з 1 м + команда.
for (const [index, entry] of commands.entries()) {
  events.length = 0;
  listener.reset();
  const word = unseenWords[index % unseenWords.length] ?? new Float32Array(0);
  const map = await feed(
    concat([silence(1500), word, silence(300), wav(entry.set, entry.file), silence(1500)]),
  );
  results.push(result('В', entry, true));
  if (MAP && results.at(-1)?.exact !== true) console.log(`В ${entry.file}: ${map}`);
}
const wallSec = seconds(wallStart);
const cpu = process.cpuUsage(cpuStart);

// Озвучка: перший звук нової фрази.
const voice = { id: 'tetiana', speed: 1 };
const firstSound: number[] = [];
for (const phrase of frequentPhrases().slice(0, 12)) {
  const begin = performance.now();
  await synthesizer.synthesize(phrase, voice);
  firstSound.push(performance.now() - begin);
}

function summary(part: 'Б' | 'В') {
  const rows = results.filter((row) => row.part === part);
  const heard = rows.filter((row) => row.heard);
  const values = (pick: (row: CaseResult) => number | null): number[] =>
    heard.flatMap((row) => {
      const value = pick(row);
      return value === null ? [] : [value];
    });
  return {
    cases: rows.length,
    wake: part === 'В' ? rows.filter((row) => row.wake === true).length : null,
    heard: heard.length,
    exact: rows.filter((row) => row.exact).length,
    werPct: (100 * heard.reduce((sum, row) => sum + row.wer, 0)) / Math.max(1, heard.length),
    speculative: heard.filter((row) => row.speculative === true).length,
    sttMsP50: percentile(
      values((row) => row.sttMs),
      0.5,
    ),
    sttMsP90: percentile(
      values((row) => row.sttMs),
      0.9,
    ),
    textAfterSpeechMsP50: percentile(
      values((row) => row.textAfterSpeechMs),
      0.5,
    ),
    textAfterSpeechMsP90: percentile(
      values((row) => row.textAfterSpeechMs),
      0.9,
    ),
    owner: heard.filter((row) => row.owner === true).length,
    minVoiceScore: Math.min(...heard.map((row) => row.voiceScore ?? 1)),
  };
}

const report = {
  checkedAt: new Date().toISOString(),
  mode: REALTIME ? 'realtime' : 'fast',
  wakeContextChunks: CONTEXT,
  wakeThreshold: WAKE_THRESHOLDS.medium,
  voiceThreshold: VOICE_THRESHOLDS.medium,
  loadSec: loads,
  wake: wakeRows,
  button: summary('Б'),
  wakeAndCommand: summary('В'),
  cpu: { sec: (cpu.user + cpu.system) / 1e6, wallSec },
  tts: {
    firstSoundMsP50: percentile(firstSound, 0.5),
    firstSoundMsMax: Math.max(...firstSound),
    sampleRate: synthesizer.sampleRate,
  },
  results,
};
writeFileSync(join(DATA, 'voice-check.json'), JSON.stringify(report, null, 2));
for (const [label, part] of [
  ['Б. Кнопка мікрофона', report.button],
  ['В. Слово + команда', report.wakeAndCommand],
] as const) {
  console.log(
    `${label}: ${part.wake === null ? '' : `слово ${String(part.wake)} з ${String(part.cases)}, `}почуто ${String(part.heard)} з ${String(part.cases)}, дослівно ${String(part.exact)}, WER ${part.werPct.toFixed(0)} %; ` +
      `наперед ${String(part.speculative)}; розпізнавання після паузи p50 ${part.sttMsP50.toFixed(0)} мс, p90 ${part.sttMsP90.toFixed(0)} мс; ` +
      `текст після кінця мови p50 ${part.textAfterSpeechMsP50.toFixed(0)} мс, p90 ${part.textAfterSpeechMsP90.toFixed(0)} мс; ` +
      `голос власника ${String(part.owner)} з ${String(part.heard)}, найнижча схожість ${part.minVoiceScore.toFixed(3)}`,
  );
}
console.log(
  `Озвучка нової фрази: перший звук p50 ${report.tts.firstSoundMsP50.toFixed(0)} мс, найдовше ${report.tts.firstSoundMsMax.toFixed(0)} мс`,
);
console.log(
  `Процесор: ${report.cpu.sec.toFixed(1)} с за ${wallSec.toFixed(1)} с${REALTIME ? '' : ' (подача швидша за реальний час; --realtime — справжня затримка)'}`,
);
