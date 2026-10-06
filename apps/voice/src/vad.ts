// Кінець фрази (.claude/logic/02-voice.md, «Ланки»): Silero VAD через sherpa-onnx. VAD лише каже,
// чи звучить мова в кожному кроці 80 мс; паузу кінця фрази й спекулятивний старт розпізнавання
// рахує listener.ts — так пауза налаштовується без перезапуску моделі.
import './native.ts';
import sherpa from 'sherpa-onnx-node';
import { SAMPLE_RATE } from './audio.ts';

/** Вікно Silero VAD — 512 відліків (32 мс). */
const WINDOW = 512;

export interface SpeechDetector {
  /** Чи є мова в цьому кроці звуку (−1…1). */
  push(samples: Float32Array): boolean;
  reset(): void;
}

export function loadSpeechDetector(modelPath: string, threshold = 0.5): SpeechDetector {
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: modelPath,
        threshold,
        // Короткі межі: власну паузу кінця фрази рахує listener.ts.
        minSilenceDuration: 0.1,
        minSpeechDuration: 0.1,
        windowSize: WINDOW,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      debug: 0,
    },
    30,
  );
  let pending = new Float32Array(0);
  return {
    push(samples) {
      const joined = new Float32Array(pending.length + samples.length);
      joined.set(pending);
      joined.set(samples, pending.length);
      let offset = 0;
      let speech = false;
      for (; offset + WINDOW <= joined.length; offset += WINDOW) {
        vad.acceptWaveform(joined.subarray(offset, offset + WINDOW));
        speech ||= vad.isDetected();
      }
      pending = joined.slice(offset);
      // Готові відрізки мови не потрібні: звук команди збирає listener.ts.
      while (!vad.isEmpty()) vad.pop();
      return speech;
    },
    reset() {
      vad.reset();
      pending = new Float32Array(0);
    },
  };
}
