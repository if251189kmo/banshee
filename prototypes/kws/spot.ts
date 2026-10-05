// Пошук слова «Banshee» через sherpa-onnx KWS (крок 0.5): модель, варіанти вимови, поріг.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sherpa from 'sherpa-onnx-node';

export const SAMPLE_RATE = 16_000;
/** Кроки по 100 мс — як блоки AudioWorklet у продукті. */
const STEP = SAMPLE_RATE / 10;

export interface KwsModel {
  readonly id: string;
  readonly dir: string;
  readonly encoder: string;
  readonly decoder: string;
  readonly joiner: string;
}

const KWS_DIR = resolve('.data/models/kws');

export const MODELS: Readonly<Record<string, KwsModel>> = {
  'zh-en': {
    id: 'zh-en',
    dir: join(KWS_DIR, 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20'),
    encoder: 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
    decoder: 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
    joiner: 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
  },
  gigaspeech: {
    id: 'gigaspeech',
    dir: join(KWS_DIR, 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'),
    encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  },
};

/**
 * Варіанти вимови «Banshee»: модель zh-en — фонеми ARPAbet, gigaspeech — частини слів (BPE).
 * Українською — «Ба́нші»: наголос на першому складі, «а» ближче до AA.
 */
export const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'zh-en': ['B AE1 N SH IY0', 'B AA1 N SH IY0', 'B AE0 N SH IY1', 'B AH1 N SH IY0'],
  gigaspeech: ['▁BA N SH E E', '▁BA N SH I', '▁BA N ▁SHE'],
};

export interface SpotterOptions {
  readonly model: KwsModel;
  readonly keywords: readonly string[];
  /** Поріг спрацювання: вище — менше хибних, більше пропусків. Типово 0,25. */
  readonly threshold: number;
  /** Підсилення ключового слова під час пошуку. Типово 1. */
  readonly score: number;
}

export type Detect = (samples: Float32Array) => number[];

/** Повертає функцію, що знаходить моменти (с від початку) слова в записі. */
export async function createSpotter(options: SpotterOptions, workDir: string): Promise<Detect> {
  await mkdir(workDir, { recursive: true });
  const keywordsFile = join(
    workDir,
    `keywords-${options.model.id}-${String(options.keywords.length)}.txt`,
  );
  await writeFile(
    keywordsFile,
    options.keywords.map((tokens, index) => `${tokens} @BANSHEE_${String(index)}`).join('\n') +
      '\n',
  );
  const { model } = options;
  const kws = new sherpa.KeywordSpotter({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(model.dir, model.encoder),
        decoder: join(model.dir, model.decoder),
        joiner: join(model.dir, model.joiner),
      },
      tokens: join(model.dir, 'tokens.txt'),
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    },
    keywordsFile,
    keywordsScore: options.score,
    keywordsThreshold: options.threshold,
    numTrailingBlanks: 1,
    maxActivePaths: 4,
  });
  return (samples) => {
    const stream = kws.createStream();
    const found: number[] = [];
    for (let start = 0; start < samples.length; start += STEP) {
      stream.acceptWaveform({
        sampleRate: SAMPLE_RATE,
        samples: samples.subarray(start, start + STEP),
      });
      while (kws.isReady(stream)) {
        kws.decode(stream);
        if (kws.getResult(stream).keyword) {
          found.push(Math.min(samples.length, start + STEP) / SAMPLE_RATE);
          kws.reset(stream);
        }
      }
    }
    // Хвіст тиші, щоб слово наприкінці запису встигло спрацювати.
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: new Float32Array(SAMPLE_RATE / 2) });
    stream.inputFinished();
    while (kws.isReady(stream)) {
      kws.decode(stream);
      if (kws.getResult(stream).keyword) {
        found.push(samples.length / SAMPLE_RATE);
        kws.reset(stream);
      }
    }
    return found;
  };
}

/** Зіставляє знайдене зі справжніми моментами слова: влучання, пропуски, зайві спрацювання. */
export function matchDetections(
  labels: readonly number[],
  detections: readonly number[],
  toleranceSec: number,
): { hits: number; misses: number; extra: number } {
  const used = new Set<number>();
  let hits = 0;
  for (const label of labels) {
    const index = detections.findIndex(
      (time, position) =>
        !used.has(position) && time >= label - 0.3 && time <= label + toleranceSec,
    );
    if (index >= 0) {
      used.add(index);
      hits += 1;
    }
  }
  return { hits, misses: labels.length - hits, extra: detections.length - used.size };
}
