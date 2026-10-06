// Озвучка (.claude/logic/02-voice.md, «Озвучка»; рішення власника 2026-10-04): Piper `tetiana` high
// через sherpa-onnx на процесорі, по реченнях. Нова фраза звучить через ≈ 0,45 с, тому кожна вже
// озвучена фраза зберігається в data\ і далі звучить одразу; часті фрази готуються в простої.
import './native.ts';
import { join } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import type { TtsVoice } from './phrases.ts';
export * from './phrases.ts';

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
        // В Electron пам'ять V8 ізольована: звук — копією, а не зовнішнім буфером sherpa-onnx.
        enableExternalBuffer: false,
        onProgress: () => (signal?.aborted ? 0 : 1),
      });
      return signal?.aborted ? null : wave.samples;
    },
  };
}
