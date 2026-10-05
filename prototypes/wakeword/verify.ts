// Друга сходинка пробудження: чи це голос власника (TitaNet small, крок 0.6).
// Перша сходинка — модель слова — чутлива й дешева; спрацювання стає пробудженням,
// лише коли звук останніх 1,6 с схожий на профіль власника.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { clipStats, pcmOf } from '../recorder/analyze.ts';
import { loadManifest } from '../recorder/storage.ts';
import { cosine, profileOf } from '../voiceprint/score.ts';

const MODEL = resolve('.data/models/voiceprint/nemo_en_titanet_small.onnx');
const RECORDINGS = resolve('.data/recordings');
const RATE = 16_000;
/** Поріг з кроку 0.6: посередині між найнижчою схожістю власника (0,373) і найвищою чужих (0,271). */
export const VOICE_THRESHOLD = 0.32;
/** Скільки звуку перед спрацюванням іде на перевірку голосу. */
export const VERIFY_SEC = 1.6;

/** Повертає схожість звуку (PCM −32768…32767) на профіль власника з 5 фраз запису. */
export async function createVerifier(): Promise<(samples: Float32Array) => number> {
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: MODEL, numThreads: 2, debug: 0 });
  const embed = (samples: Float32Array): Float32Array | null => {
    const stream = extractor.createStream();
    stream.acceptWaveform({
      sampleRate: RATE,
      samples: Float32Array.from(samples, (value) => value / 32768),
    });
    stream.inputFinished();
    return extractor.isReady(stream) ? Float32Array.from(extractor.compute(stream)) : null;
  };
  const manifest = await loadManifest(RECORDINGS);
  const profile = profileOf(
    manifest.entries
      .filter((entry) => entry.set === 'profile')
      .flatMap((entry) => {
        const pcm = pcmOf(readFileSync(join(RECORDINGS, entry.set, entry.file)));
        const speech = clipStats(pcm).speech;
        const from = speech ? Math.max(0, ((speech.startMs - 100) * RATE) / 1000) : 0;
        const to = speech ? Math.min(pcm.length, ((speech.endMs + 100) * RATE) / 1000) : pcm.length;
        const embedding = embed(Float32Array.from(pcm.subarray(from, to)));
        return embedding ? [embedding] : [];
      }),
  );
  return (samples) => {
    const embedding = embed(samples);
    return embedding ? cosine(profile, embedding) : 0;
  };
}
