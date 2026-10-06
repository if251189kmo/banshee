// Голос власника (.claude/logic/02-voice.md, «Розпізнавання власника за голосом»): відбиток голосу
// NeMo TitaNet small через sherpa-onnx і косинусна схожість з профілем — середнім відбитком 5 фраз.
// Фільтр, а не автентифікація. Профіль — біометричні дані: лише в data\ цього ПК, не синхронізується
// й не експортується.
import './native.ts';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { SAMPLE_RATE } from './audio.ts';
export { cosine, normalized, profileOf } from './vectors.ts';

export const VOICE_MODEL = 'nemo_en_titanet_small';

/**
 * Поріг за «Суворістю перевірки». Крок 0.6: найнижча схожість власника 0,373, найвища чужих
 * 0,271; середня — посередині. Уточнюється на етапі 2 на 50 + 50 фразах.
 */
export const VOICE_THRESHOLDS = { low: 0.28, medium: 0.32, high: 0.36 } as const;

export interface VoiceProfile {
  readonly model: string;
  readonly vector: Float32Array;
  readonly phrases: number;
  readonly createdAt: string;
}

export async function readProfile(file: string): Promise<VoiceProfile | null> {
  if (!existsSync(file)) return null;
  const raw = JSON.parse(await readFile(file, 'utf8')) as {
    model?: unknown;
    vector?: unknown;
    phrases?: unknown;
    createdAt?: unknown;
  };
  if (raw.model !== VOICE_MODEL || !Array.isArray(raw.vector)) return null;
  return {
    model: VOICE_MODEL,
    vector: Float32Array.from(raw.vector as number[]),
    phrases: Number(raw.phrases),
    createdAt: String(raw.createdAt),
  };
}

/** Запис через тимчасовий файл: обірваний запис не псує попередній профіль. */
export async function writeProfile(file: string, profile: VoiceProfile): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(
    temp,
    JSON.stringify({
      model: profile.model,
      vector: Array.from(profile.vector),
      phrases: profile.phrases,
      createdAt: profile.createdAt,
    }),
  );
  await rename(temp, file);
}

export interface VoicePrinter {
  /** Відбиток звуку (−1…1) або null, якщо звуку замало. ≈ 20 мс на фразу. */
  embed(samples: Float32Array): Float32Array | null;
}

export function loadVoicePrinter(modelPath: string): VoicePrinter {
  const extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: modelPath,
    numThreads: 1,
    debug: 0,
  });
  return {
    embed(samples) {
      const stream = extractor.createStream();
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
      stream.inputFinished();
      return extractor.isReady(stream) ? Float32Array.from(extractor.compute(stream)) : null;
    },
  };
}
