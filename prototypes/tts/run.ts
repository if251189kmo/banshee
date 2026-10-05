// npm run tts — крок 0.4: українські голоси через sherpa-onnx на процесорі.
// Для кожного варіанта голосу: час до першого звуку; чіткість — Parakeet розпізнає синтезовані відповіді
// Banshee з прогонів еталонного набору (лише кирилиця, без цифр), рахуємо помилки в словах;
// WAV і сторінка .data/tts/index.html.
// Приємність голосу оцінює власник на слух; чіткість і швидкість — числа.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sherpa, { type Wave } from 'sherpa-onnx-node';
import { percentile } from '../../scripts/lib/evals/report.ts';
import { normalize, wordErrorRate } from '../stt/text.ts';
import { unknownLetters } from './letters.ts';

const MODELS = resolve('.data/models/piper');
const PARAKEET_DIR = resolve('.data/models/parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
const EVAL_RESULTS = resolve('evals/results');
const OUT = resolve('.data/tts');
/** Ціль кроку 0.4: перший звук ≤ 0,2 с (07-quality.md). */
const FIRST_SOUND_TARGET_MS = 200;

interface Variant {
  readonly id: string;
  readonly label: string;
  readonly dir: string;
  readonly model: string;
  /** Вимова через espeak-ng (Piper); інакше модель читає літери й пропускає все, чого немає в tokens.txt. */
  readonly espeak: boolean;
  /** Темп: 1 — як навчено, менше — повільніше. */
  readonly speed: number;
  /** Випадковість вимови VITS: менше — рівніше й чіткіше, але монотонніше. Типово 0,667 і 0,8. */
  readonly noiseScale?: number;
  readonly noiseScaleW?: number;
}

const TETIANA = { dir: 'piper-uk_UA-tetiana-high', model: 'uk_UA-tetiana-high.onnx', espeak: true };

/**
 * Жіночі голоси. Piper tetiana high — з rhasspy/piper-voices, підготовлений prepare-piper.ts.
 * Piper ukrainian_tts medium тут немає: модель читає літери, а sherpa-onnx 1.13.8 подає їй фонеми espeak.
 * Meta MMS прибрано: 0,7 с на фразу й ліцензія лише некомерційна.
 */
const VARIANTS: readonly Variant[] = [
  { id: 'tetiana', label: 'tetiana · Piper high', ...TETIANA, speed: 1 },
  {
    id: 'lada',
    label: 'lada · Piper x_low',
    dir: 'vits-piper-uk_UA-lada-x_low',
    model: 'uk_UA-lada-x_low.onnx',
    espeak: true,
    speed: 1,
  },
  {
    id: 'olena',
    label: 'olena · Coqui',
    dir: 'vits-coqui-uk-mai',
    model: 'model.onnx',
    espeak: false,
    speed: 1,
  },
];

/**
 * Типові відповіді Banshee для прослуховування: перша — фраза перед дією, від неї залежить перший звук.
 * Без лапок: голоси espeak читають «» уголос («відкриті лапки»), core їх прибирає перед озвученням.
 */
export const PHRASES = [
  'Відкриваю Телеграм.',
  'Гучність — п’ятдесят відсотків.',
  'Не знайшов файл з такою назвою. У якій теці шукати?',
  'Сьогодні понеділок, п’яте жовтня, десята тридцять.',
  'Перемістив два скріншоти в теку Звіти на робочому столі.',
  'Надсилати повідомлення я поки не вмію.',
] as const;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${String(char.charCodeAt(0))};`);
}

function recognizer(): (wave: Wave) => string {
  const asr = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(PARAKEET_DIR, 'encoder.int8.onnx'),
        decoder: join(PARAKEET_DIR, 'decoder.int8.onnx'),
        joiner: join(PARAKEET_DIR, 'joiner.int8.onnx'),
      },
      tokens: join(PARAKEET_DIR, 'tokens.txt'),
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  return (wave) => {
    const stream = asr.createStream();
    stream.acceptWaveform(wave);
    asr.decode(stream);
    return asr.getResult(stream).text.trim();
  };
}

/**
 * Справжні відповіді Banshee з прогонів еталонного набору — те, що голос читатиме щодня.
 * Лапки прибираємо, як core перед озвученням; цифри й латиницю розпізнавач пише по-своєму — без них.
 */
async function clarityTexts(): Promise<string[]> {
  const texts = new Set<string>();
  for (const name of (await readdir(EVAL_RESULTS)).filter((file) => file.endsWith('.json'))) {
    const report = JSON.parse(await readFile(join(EVAL_RESULTS, name), 'utf8')) as {
      cases?: { finalText?: string }[];
    };
    for (const item of report.cases ?? []) {
      const text = (item.finalText ?? '')
        .replace(/["«»“”]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text && !/[A-Za-z0-9\\:]/.test(text)) texts.add(text);
    }
  }
  return [...texts].sort();
}

interface Row {
  readonly id: string;
  readonly label: string;
  readonly sampleRate: number;
  readonly firstMs: number;
  /** Помилки в словах на 100 слів, коли Parakeet розпізнає синтезовані команди. */
  readonly errorsPer100: number;
  readonly exact: number;
  readonly clarityCount: number;
  readonly heard: readonly string[];
  readonly files: readonly string[];
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { threads: { type: 'string', default: '4' } } });
  const threads = Number(values.threads);
  await mkdir(OUT, { recursive: true });
  const recognize = recognizer();
  const texts = await clarityTexts();
  const rows: Row[] = [];

  for (const variant of VARIANTS) {
    const dir = join(MODELS, variant.dir);
    const tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: join(dir, variant.model),
          tokens: join(dir, 'tokens.txt'),
          ...(variant.espeak ? { dataDir: join(dir, 'espeak-ng-data') } : {}),
          ...(variant.noiseScale === undefined ? {} : { noiseScale: variant.noiseScale }),
          ...(variant.noiseScaleW === undefined ? {} : { noiseScaleW: variant.noiseScaleW }),
        },
        numThreads: threads,
        debug: 0,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    });
    if (!variant.espeak) {
      const tokens = await readFile(join(dir, 'tokens.txt'), 'utf8');
      const missing = unknownLetters([...PHRASES, ...texts].join(' '), tokens);
      if (missing.length > 0) {
        console.log(`${variant.id}: пропускає літери, яких не знає: ${missing.join(' ')}`);
      }
    }
    const speak = (text: string): Wave => {
      const audio = tts.generate({ text, sid: 0, speed: variant.speed });
      return { samples: Float32Array.from(audio.samples), sampleRate: audio.sampleRate };
    };
    // Перший виклик завантажує ядра й словник вимови — його не рахуємо.
    speak('Перевірка.');
    const firstTimes: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now();
      speak(PHRASES[0]);
      firstTimes.push(performance.now() - started);
    }
    const files: string[] = [];
    const heard: string[] = [];
    for (const [index, text] of PHRASES.entries()) {
      const wave = speak(text);
      const file = `${variant.id}-${String(index + 1)}.wav`;
      sherpa.writeWave(join(OUT, file), wave);
      files.push(file);
      heard.push(recognize(wave));
    }
    let words = 0;
    let errors = 0;
    let exact = 0;
    for (const text of texts) {
      const recognized = recognize(speak(text));
      const length = normalize(text).split(' ').filter(Boolean).length;
      words += length;
      errors += wordErrorRate(text, recognized) * length;
      if (normalize(recognized) === normalize(text)) exact += 1;
    }
    const row: Row = {
      id: variant.id,
      label: variant.label,
      sampleRate: tts.sampleRate,
      firstMs: percentile(firstTimes, 0.5),
      errorsPer100: (100 * errors) / words,
      exact,
      clarityCount: texts.length,
      heard,
      files,
    };
    rows.push(row);
    console.log(
      `${variant.label} (${String(tts.sampleRate)} Гц): перший звук ${row.firstMs.toFixed(0)} мс` +
        `${row.firstMs <= FIRST_SOUND_TARGET_MS ? '' : ' — понад ціль'}; чіткість: ` +
        `${row.errorsPer100.toFixed(0)} помилок на 100 слів, дослівно ${String(exact)} з ${String(texts.length)}`,
    );
  }

  const header = rows
    .map(
      (row) =>
        `<th>${escapeHtml(row.label)}<br><small>перший звук ${row.firstMs.toFixed(0)} мс · ` +
        `${row.errorsPer100.toFixed(0)} помилок на 100 слів</small></th>`,
    )
    .join('');
  const body = PHRASES.map(
    (text, index) =>
      `<tr><td>${escapeHtml(text)}</td>${rows
        .map(
          (row) =>
            `<td><audio controls preload="none" src="${row.files[index] ?? ''}"></audio>` +
            `<br><small>чує: ${escapeHtml(row.heard[index] ?? '')}</small></td>`,
        )
        .join('')}</tr>`,
  ).join('\n');
  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Голоси Banshee</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f7; --fg: #1d2424; --line: #d5dcdb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141a1a; --fg: #e6eceb; --line: #2c3636; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, "Segoe UI", sans-serif; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { max-width: 78ch; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; }
  th, td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
  th small, td small { font-weight: normal; opacity: .75; }
  audio { width: 190px; }
</style>
</head>
<body>
<h1>Голоси Banshee — крок 0.4</h1>
<p>Жіночі українські голоси, що працюють на цьому ПК без інтернету. Новий — tetiana (Piper high): найчіткіший і найякісніший серед відкритих українських голосів. lada й olena — колишні, для порівняння.</p>
<p>«Перший звук» — скільки синтезується перша фраза на цьому ПК; ціль ≤ 200 мс, а часті фрази («Відкриваю Телеграм») Banshee зберігатиме готовими, і вони звучатимуть одразу. «Помилки на 100 слів» — розпізнавач мови Parakeet слухає відповіді Banshee (${String(rows[0]?.clarityCount ?? 0)}), сказані цим голосом: менше помилок — чіткіша вимова. Під кожним записом — що він почув. Приємність — на твій слух.</p>
<div class="wrap"><table>
<thead><tr><th>Фраза</th>${header}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>
</body>
</html>
`;
  await writeFile(join(OUT, 'index.html'), html);
  await writeFile(
    join(OUT, 'results.json'),
    `${JSON.stringify({ startedAt: new Date().toISOString(), threads, rows }, null, 2)}\n`,
  );
  console.log(`\nПрослухати: ${join(OUT, 'index.html')}`);
}

await main();
