// Розпізнавання (.claude/logic/02-voice.md, «Розпізнавання мови»; рішення власника 2026-10-04):
// Parakeet TDT 0.6B v3 int8 через sherpa-onnx на процесорі. Модель тримається в RAM (≈ 0,8 ГБ),
// розпізнавання — у потоці libuv (decodeAsync), тож слово й VAD тим часом рахуються далі.
import './native.ts';
import { join } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { SAMPLE_RATE } from './audio.ts';
export { stripWakeWord } from './text.ts';

export interface Recognizer {
  /** Текст фрази (−1…1). */
  recognize(samples: Float32Array): Promise<string>;
}

export async function loadRecognizer(dir: string, threads = 4): Promise<Recognizer> {
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        joiner: join(dir, 'joiner.int8.onnx'),
      },
      tokens: join(dir, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  return {
    async recognize(samples) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
      const result = await recognizer.decodeAsync(stream);
      return result.text.trim();
    },
  };
}
