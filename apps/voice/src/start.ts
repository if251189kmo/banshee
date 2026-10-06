// Запуск процесу voice без Electron (.claude/logic/02-voice.md, «Реалізація — етап 2»): моделі з
// теки models\, модель слова й профіль голосу власника з data\voice, прогрів Parakeet, щоб перша
// команда не чекала. Вхід utilityProcess — apps/desktop/src/voice/voice.ts.
import './native.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ControlFromVoice, DesktopMessage, VoiceToAudio } from '@banshee/shared';
import { createLog, type Log } from '@banshee/shared/log';
import { SAMPLE_RATE } from './audio.ts';
import {
  MODEL_PATHS,
  PROFILE_FILE,
  TTS_MODEL_FILE,
  WAKE_MODEL_FILE,
  missingModels,
} from './models.ts';
import { PhraseCache } from './phrases.ts';
import { loadVoicePrinter, readProfile } from './speaker.ts';
import { loadRecognizer } from './stt.ts';
import { loadSynthesizer } from './tts.ts';
import { VoiceService } from './service.ts';
import { loadSpeechDetector } from './vad.ts';
import { loadWakeDetector, type WakeDetector } from './wake.ts';

export interface StartVoiceOptions {
  readonly modelsDir: string;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly toCore: (message: DesktopMessage) => void;
  readonly toAudio: (message: VoiceToAudio) => void;
  readonly toMain: (message: ControlFromVoice) => void;
  readonly log?: Log;
}

export interface StartedVoice {
  readonly service: VoiceService;
  /** Озвучка поза ходом core: перевірка програми каже собі команду голосом. */
  synthesize(text: string): Promise<{ samples: Float32Array; sampleRate: number } | null>;
  readonly log: Log;
  readonly wakeModel: 'own' | 'base' | 'none';
  readonly profile: boolean;
}

export class MissingModels extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Немає моделей голосу: ${String(missing.length)} файлів`);
    this.missing = missing;
  }
}

/**
 * Модель слова: власна (data\voice — довчена на вимовах власника, крок 2.6) чи базова
 * (models\wakeword — без голосу власника). Без жодної працює лише кнопка мікрофона.
 */
export function wakeModelPath(
  modelsDir: string,
  dataDir: string,
): { path: string; kind: 'own' | 'base' } | null {
  const own = join(dataDir, 'voice', WAKE_MODEL_FILE);
  if (existsSync(own)) return { path: own, kind: 'own' };
  const base = join(modelsDir, 'wakeword', 'base.json');
  if (existsSync(base)) return { path: base, kind: 'base' };
  return null;
}

export async function startVoice(options: StartVoiceOptions): Promise<StartedVoice> {
  const log = options.log ?? createLog({ dir: options.logsDir, source: 'voice' });
  const missing = missingModels(options.modelsDir);
  if (missing.length > 0) throw new MissingModels(missing);
  const models = (path: string): string => join(options.modelsDir, path);

  const wakeFile = wakeModelPath(options.modelsDir, options.dataDir);
  const [wake, recognizer, synthesizer, profile] = await Promise.all([
    wakeFile
      ? loadWakeDetector({
          mel: models(MODEL_PATHS.mel),
          embedding: models(MODEL_PATHS.embedding),
          model: wakeFile.path,
        })
      : Promise.resolve<WakeDetector | null>(null),
    loadRecognizer(models(MODEL_PATHS.parakeet)),
    loadSynthesizer(models(MODEL_PATHS.tts), TTS_MODEL_FILE),
    readProfile(join(options.dataDir, 'voice', PROFILE_FILE)),
  ]);
  const speech = loadSpeechDetector(models(MODEL_PATHS.vad));
  const printer = loadVoicePrinter(models(MODEL_PATHS.voiceprint));
  // Прогрів: перша команда власника не чекає на холодний Parakeet.
  await recognizer.recognize(new Float32Array(SAMPLE_RATE));

  const service = new VoiceService({
    engines: {
      wake: (chunk) => (wake ? wake.push(chunk) : Promise.resolve(null)),
      speech: (chunk) => speech.push(chunk),
      recognize: (samples) => recognizer.recognize(samples),
      embed: (samples) => printer.embed(samples),
      synthesize: (text, voice, signal) => synthesizer.synthesize(text, voice, signal),
      sampleRate: synthesizer.sampleRate,
    },
    profile: profile?.vector ?? null,
    phrases: new PhraseCache(join(options.dataDir, 'voice', 'phrases')),
    toCore: options.toCore,
    toAudio: options.toAudio,
    toMain: options.toMain,
    log,
    now: () => performance.now(),
  });
  return {
    service,
    log,
    wakeModel: wakeFile?.kind ?? 'none',
    profile: profile !== null,
    synthesize: async (text) => {
      const samples = await synthesizer.synthesize(
        text,
        { id: 'tetiana', speed: 1 },
        new AbortController().signal,
      );
      return samples ? { samples, sampleRate: synthesizer.sampleRate } : null;
    },
  };
}
