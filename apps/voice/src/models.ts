// Моделі голосу в теці models\ (.claude/logic/01-architecture.md, «Встановлення й оновлення»):
// шляхи відносно неї — ті самі в розробці (.data/models) і у встановленій програмі.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL_PATHS = {
  mel: 'oww/melspectrogram.onnx',
  embedding: 'oww/embedding_model.onnx',
  vad: 'vad/silero_vad.onnx',
  voiceprint: 'voiceprint/nemo_en_titanet_small.onnx',
  parakeet: 'parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  tts: 'piper/piper-uk_UA-tetiana-high',
} as const;

export const TTS_MODEL_FILE = 'uk_UA-tetiana-high.onnx';

/** Файли, без яких процес voice не стартує. */
export function requiredFiles(modelsDir: string): string[] {
  return [
    MODEL_PATHS.mel,
    MODEL_PATHS.embedding,
    MODEL_PATHS.vad,
    MODEL_PATHS.voiceprint,
    `${MODEL_PATHS.parakeet}/encoder.int8.onnx`,
    `${MODEL_PATHS.parakeet}/decoder.int8.onnx`,
    `${MODEL_PATHS.parakeet}/joiner.int8.onnx`,
    `${MODEL_PATHS.parakeet}/tokens.txt`,
    `${MODEL_PATHS.tts}/${TTS_MODEL_FILE}`,
    `${MODEL_PATHS.tts}/tokens.txt`,
  ].map((path) => join(modelsDir, path));
}

export function missingModels(modelsDir: string): string[] {
  return requiredFiles(modelsDir).filter((path) => !existsSync(path));
}

/**
 * Модель слова — у data\voice: її довчають вимови власника, тож вона, як і профіль голосу,
 * належить цьому ПК. Базової моделі програма поки не везе: модель ітерації 4 вчилась на подкастах
 * UK-PODS (CC BY-NC 4.0 — лише локальна перевірка); що везти — крок 2.6. Без моделі слова працює
 * кнопка мікрофона.
 */
export const WAKE_MODEL_FILE = 'wake-model.json';
export const PROFILE_FILE = 'voice-profile.json';
