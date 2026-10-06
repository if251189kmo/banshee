// Озвучка (.claude/logic/02-voice.md, «Озвучка»; рішення власника 2026-10-04): Piper `tetiana` high
// через sherpa-onnx на процесорі, по реченнях. Нова фраза звучить через ≈ 0,45 с, тому кожна вже
// озвучена фраза зберігається в data\ і далі звучить одразу; часті фрази готуються в простої.
import './native.ts';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sherpa from 'sherpa-onnx-node';

export interface TtsVoice {
  readonly id: string;
  readonly speed: number;
}

export interface Synthesizer {
  readonly sampleRate: number;
  /** Звук речення (−1…1). signal зупиняє синтез між частинами. */
  synthesize(text: string, voice: TtsVoice, signal?: AbortSignal): Promise<Float32Array | null>;
}

export async function loadSynthesizer(
  dir: string,
  model: string,
  threads = 4,
): Promise<Synthesizer> {
  const tts = await sherpa.OfflineTts.createAsync({
    model: {
      vits: {
        model: join(dir, model),
        tokens: join(dir, 'tokens.txt'),
        dataDir: join(dir, 'espeak-ng-data'),
      },
      numThreads: threads,
      debug: 0,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  });
  return {
    sampleRate: tts.sampleRate,
    async synthesize(text, voice, signal) {
      if (signal?.aborted) return null;
      const wave = await tts.generateAsync({
        text,
        sid: 0,
        // Piper: lengthScale = 1 / speed; sherpa-onnx перераховує сам.
        speed: voice.speed,
        onProgress: () => (signal?.aborted ? 0 : 1),
      });
      return signal?.aborted ? null : wave.samples;
    },
  };
}

/**
 * Речення для озвучки по одному: перше звучить, поки синтезується друге. Межа — . ! ? … перед
 * пробілом і великою літерою чи кінцем тексту; короткі уривки (до 3 слів) приєднуються до попереднього.
 */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/gu, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}\d«"(])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    if (last !== undefined && part.split(' ').length <= 3 && out.length > 1)
      out[out.length - 1] = `${last} ${part}`;
    else out.push(part);
  }
  return out;
}

/** Ключ збереженої фрази: текст, голос і темп. Зміна голосу чи темпу дає інші ключі. */
export function phraseKey(text: string, voice: TtsVoice): string {
  return createHash('sha256')
    .update(`${voice.id}\u0000${String(voice.speed)}\u0000${text}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Збережені фрази: пам'ять + файли PCM 16 біт у data\voice\phrases\<голос>-<темп>\.
 * Розмір — ≈ 44 КБ на секунду звуку; сотня частих фраз — кілька мегабайтів.
 */
export class PhraseCache {
  private readonly memory = new Map<string, Float32Array>();
  private readonly dir: string;
  private readonly limit: number;

  constructor(dir: string, limit = 300) {
    this.dir = dir;
    this.limit = limit;
  }

  private folder(voice: TtsVoice): string {
    return join(this.dir, `${voice.id}-${voice.speed.toFixed(2)}`);
  }

  async get(text: string, voice: TtsVoice): Promise<Float32Array | null> {
    const key = phraseKey(text, voice);
    const cached = this.memory.get(key);
    if (cached) return cached;
    const file = join(this.folder(voice), `${key}.pcm`);
    if (!existsSync(file)) return null;
    const buffer = await readFile(file);
    const samples = new Float32Array(buffer.length / 2);
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = buffer.readInt16LE(index * 2) / 32768;
    this.remember(key, samples);
    return samples;
  }

  async put(text: string, voice: TtsVoice, samples: Float32Array): Promise<void> {
    const key = phraseKey(text, voice);
    this.remember(key, samples);
    const folder = this.folder(voice);
    await mkdir(folder, { recursive: true });
    const buffer = Buffer.alloc(samples.length * 2);
    samples.forEach((value, index) => {
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), index * 2);
    });
    const file = join(folder, `${key}.pcm`);
    await writeFile(`${file}.tmp`, buffer);
    await rename(`${file}.tmp`, file);
  }

  has(text: string, voice: TtsVoice): boolean {
    const key = phraseKey(text, voice);
    return this.memory.has(key) || existsSync(join(this.folder(voice), `${key}.pcm`));
  }

  private remember(key: string, samples: Float32Array): void {
    this.memory.delete(key);
    this.memory.set(key, samples);
    while (this.memory.size > this.limit) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }
}

/** Фрази, які Banshee каже найчастіше (02-voice.md, «Готові фрази»), — у тексті для голосу. */
export function frequentPhrases(): string[] {
  const apps = [
    'телеграм',
    'гугл хром',
    'фаєрфокс',
    'ві ес код',
    'спотіфай',
    'діскорд',
    'стім',
    'блокнот',
    'калькулятор',
    'провідник',
    'ворд',
    'ексель',
    'ютуб',
  ];
  const tens = [
    'нуль',
    "п'ять",
    'десять',
    "п'ятнадцять",
    'двадцять',
    "двадцять п'ять",
    'тридцять',
    "тридцять п'ять",
    'сорок',
    "сорок п'ять",
    "п'ятдесят",
    "п'ятдесят п'ять",
    'шістдесят',
    "шістдесят п'ять",
    'сімдесят',
    "сімдесят п'ять",
    'вісімдесят',
    "вісімдесят п'ять",
    "дев'яносто",
    "дев'яносто п'ять",
    'сто',
  ];
  return [
    'Готово.',
    'Добре, не роблю.',
    'Звук вимкнено.',
    'Звук увімкнено.',
    ...tens.map((value) => `Гучність ${value} відсотків.`),
    ...apps.map((app) => `Відкриваю ${app}.`),
    ...apps.map((app) => `Закриваю ${app}.`),
  ];
}
