// Моделі голосу в теку models\ (.claude/logic/01-architecture.md, «Встановлення й оновлення»):
// завантаження з перевіркою SHA-256 і докачуванням після обриву. Джерела — офіційні випуски
// sherpa-onnx і openWakeWord на GitHub і моделі на HuggingFace: без облікових записів і ключів.
// Голос Piper з rhasspy/piper-voices після перевірки готується для sherpa-onnx: метадані й tokens.txt.
// Без нативних модулів: це запускає головний процес.
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MODEL_PATHS, TTS_MODEL_FILE } from './models.ts';
import { piperTokens, withMetadata } from './onnx-meta.ts';

export interface ModelSource {
  /** Шлях у теці моделей. */
  readonly path: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

const HF = 'https://huggingface.co';
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const PARAKEET = `${HF}/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main`;
const TETIANA = `${HF}/rhasspy/piper-voices/resolve/main/uk/uk_UA/tetiana/high`;

/** Файли, що качаються як є. Розміри й SHA-256 звірено з HuggingFace і checksum.txt випусків. */
export const MODEL_SOURCES: readonly ModelSource[] = [
  {
    path: MODEL_PATHS.mel,
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx',
    size: 1_087_958,
    sha256: 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f',
  },
  {
    path: MODEL_PATHS.embedding,
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx',
    size: 1_326_578,
    sha256: '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f',
  },
  {
    path: MODEL_PATHS.vad,
    url: `${SHERPA}/asr-models/silero_vad.onnx`,
    size: 643_854,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
  },
  {
    path: MODEL_PATHS.voiceprint,
    url: `${SHERPA}/speaker-recongition-models/nemo_en_titanet_small.onnx`,
    size: 40_257_283,
    sha256: 'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e',
  },
  {
    path: `${MODEL_PATHS.parakeet}/encoder.int8.onnx`,
    url: `${PARAKEET}/encoder.int8.onnx`,
    size: 652_184_281,
    sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
  },
  {
    path: `${MODEL_PATHS.parakeet}/decoder.int8.onnx`,
    url: `${PARAKEET}/decoder.int8.onnx`,
    size: 11_845_275,
    sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
  },
  {
    path: `${MODEL_PATHS.parakeet}/joiner.int8.onnx`,
    url: `${PARAKEET}/joiner.int8.onnx`,
    size: 6_355_277,
    sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
  },
  {
    path: `${MODEL_PATHS.parakeet}/tokens.txt`,
    url: `${PARAKEET}/tokens.txt`,
    size: 93_939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
  },
];

/** Голос Piper `tetiana` high: оригінал з rhasspy/piper-voices і те, що з нього виходить. */
export const PIPER_SOURCE = {
  onnx: {
    path: `${MODEL_PATHS.tts}/${TTS_MODEL_FILE}.original`,
    url: `${TETIANA}/${TTS_MODEL_FILE}`,
    size: 114_204_024,
    sha256: '1206d8447b99632badeb63d6132241f76cf551874e5254eb8836db36aed7c85c',
  },
  config: {
    path: `${MODEL_PATHS.tts}/${TTS_MODEL_FILE}.json`,
    url: `${TETIANA}/${TTS_MODEL_FILE}.json`,
    size: 4905,
    sha256: 'c96a051028976afc74269f73470651384deb6872431f890cad3b6424d09e812b',
  },
  /** Підготовлена модель і словник звуків — та сама сума щоразу: підготовка детермінована. */
  prepared: '2678d310b6ec5433f3c5ca0691ca62d94124e5d8a32c8a3bce246b8cba59baa8',
  tokens: '055edd32f6cd472850bb293c006e6fc94af8f4952979966c6e1d0ea4c5a6ac84',
} as const;

/** Скільки байтів качати всього: оригінал Piper замінюється підготовленим, тож рахується раз. */
export const MODELS_TOTAL_BYTES =
  MODEL_SOURCES.reduce((sum, source) => sum + source.size, 0) +
  PIPER_SOURCE.onnx.size +
  PIPER_SOURCE.config.size;

/** fetch: у головному процесі — net.fetch Electron (проксі Windows), у тестах — підробка. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body: AsyncIterable<Uint8Array> | null;
}>;

export interface DownloadProgress {
  /** Скачано байтів з MODELS_TOTAL_BYTES, з урахуванням того, що вже було. */
  readonly done: number;
  readonly total: number;
  readonly file: string;
}

/** Файл є й розміру як треба. SHA-256 рахується після завантаження, а не на кожному старті. */
function present(modelsDir: string, path: string, size?: number): boolean {
  const file = join(modelsDir, path);
  if (!existsSync(file)) return false;
  return size === undefined || statSync(file).size === size;
}

const preparedModel = `${MODEL_PATHS.tts}/${TTS_MODEL_FILE}`;
const preparedTokens = `${MODEL_PATHS.tts}/tokens.txt`;

/** Чого бракує в теці моделей, у байтах завантаження. */
export function missingDownloads(modelsDir: string): { files: string[]; bytes: number } {
  const files: string[] = [];
  let bytes = 0;
  for (const source of MODEL_SOURCES) {
    if (present(modelsDir, source.path, source.size)) continue;
    files.push(source.path);
    bytes += source.size;
  }
  if (!present(modelsDir, preparedModel) || !present(modelsDir, preparedTokens)) {
    files.push(preparedModel);
    bytes += PIPER_SOURCE.onnx.size + PIPER_SOURCE.config.size;
  }
  return { files, bytes };
}

async function hashExisting(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
}

/**
 * Один файл: у `<шлях>.download`, з докачуванням (Range), далі перевірка розміру й SHA-256 і
 * перейменування. Не та сума — частковий файл стирається, помилка.
 */
export async function downloadSource(
  modelsDir: string,
  source: ModelSource,
  fetch: FetchLike,
  onBytes: (count: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const target = join(modelsDir, source.path);
  const part = `${target}.download`;
  await mkdir(dirname(target), { recursive: true });
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have > source.size) {
    await rm(part, { force: true });
    have = 0;
  }
  let hash = createHash('sha256');
  if (have > 0) await hashExisting(part, hash);
  const response = await fetch(source.url, {
    headers: have > 0 ? { Range: `bytes=${String(have)}-` } : {},
    ...(signal ? { signal } : {}),
  });
  if (have > 0 && response.status !== 206) {
    // Сервер не вміє докачувати: спочатку.
    have = 0;
    hash = createHash('sha256');
  }
  if (!response.ok || !response.body)
    throw new Error(`${source.path}: сервер відповів ${String(response.status)}`);
  onBytes(have);
  const file = await open(part, have > 0 ? 'a' : 'w');
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      await file.write(chunk);
      onBytes(chunk.length);
    }
  } finally {
    await file.close();
  }
  const size = statSync(part).size;
  const digest = hash.digest('hex');
  if (size !== source.size || digest !== source.sha256) {
    await rm(part, { force: true });
    throw new Error(`${source.path}: файл пошкоджено (розмір чи SHA-256 не збігаються)`);
  }
  await rename(part, target);
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

interface PiperConfig {
  readonly phoneme_type?: string;
  readonly espeak?: { readonly voice?: string };
  readonly audio?: { readonly sample_rate?: number };
  readonly num_speakers?: number;
  readonly language?: { readonly name_english?: string };
  readonly phoneme_id_map?: Readonly<Record<string, readonly number[]>>;
}

/**
 * Голос Piper для sherpa-onnx (як prototypes/tts/prepare-piper.ts): дописати метадані — частоту,
 * дикторів, espeak — і написати tokens.txt з phoneme_id_map. Модель і ваги не змінюються.
 */
export async function preparePiper(modelsDir: string): Promise<void> {
  const original = join(modelsDir, PIPER_SOURCE.onnx.path);
  const config = JSON.parse(
    await readFile(join(modelsDir, PIPER_SOURCE.config.path), 'utf8'),
  ) as PiperConfig;
  const rate = config.audio?.sample_rate;
  if (config.phoneme_type !== undefined && config.phoneme_type !== 'espeak')
    throw new Error(`Голос читає ${config.phoneme_type}, а не фонеми espeak`);
  if (!rate || !config.phoneme_id_map || !config.espeak?.voice)
    throw new Error('У налаштуваннях голосу Piper немає частоти чи словника звуків');
  const prepared = withMetadata(await readFile(original), {
    model_type: 'vits',
    comment: 'piper',
    language: config.language?.name_english ?? 'Ukrainian',
    voice: config.espeak.voice,
    has_espeak: 1,
    n_speakers: config.num_speakers ?? 1,
    sample_rate: rate,
  });
  const tokens = piperTokens(config.phoneme_id_map);
  if (
    sha256(prepared) !== PIPER_SOURCE.prepared ||
    sha256(Buffer.from(tokens)) !== PIPER_SOURCE.tokens
  )
    throw new Error('Голос Piper після підготовки не той, що перевірено');
  await writeFile(join(modelsDir, preparedTokens), tokens);
  await writeFile(`${join(modelsDir, preparedModel)}.download`, prepared);
  await rename(`${join(modelsDir, preparedModel)}.download`, join(modelsDir, preparedModel));
  // Оригінал більше не потрібен: 114 МБ на HDD.
  await rm(original, { force: true });
}

/** Усе, чого бракує: по черзі, з прогресом. Те, що вже є й розміру як треба, не качається. */
export async function downloadModels(
  modelsDir: string,
  options: {
    readonly fetch: FetchLike;
    readonly onProgress?: (progress: DownloadProgress) => void;
    readonly signal?: AbortSignal;
  },
): Promise<void> {
  const total = MODELS_TOTAL_BYTES;
  const missing = missingDownloads(modelsDir);
  let done = total - missing.bytes;
  const report = (file: string) => (count: number) => {
    done += count;
    options.onProgress?.({ done: Math.min(done, total), total, file });
  };
  for (const source of MODEL_SOURCES) {
    if (present(modelsDir, source.path, source.size)) continue;
    await downloadSource(modelsDir, source, options.fetch, report(source.path), options.signal);
  }
  if (!present(modelsDir, preparedModel) || !present(modelsDir, preparedTokens)) {
    for (const source of [PIPER_SOURCE.config, PIPER_SOURCE.onnx]) {
      if (present(modelsDir, source.path, source.size)) {
        // Уже скачано минулого разу; рахується як готове.
        report(source.path)(0);
        continue;
      }
      await downloadSource(modelsDir, source, options.fetch, report(source.path), options.signal);
    }
    await preparePiper(modelsDir);
  }
}
