// Службовий канал головного процесу desktop і процесу voice (.claude/logic/01-architecture.md,
// «Процеси»; 02-voice.md, «Реалізація — етап 2»): запуск зі шляхами й портами, пауза мікрофона,
// кнопка мікрофона, зупинка; у відповідь — готовність, стан для трею й оверлея, почута команда.
// Звук іде окремим портом renderer ↔ voice, протокол з core — портом voice ↔ core.
import { z } from './zod.ts';

const path = z.string().min(1);

/** Стани голосу для трею й оверлея (09-ui.md, «Стани»); paused — мікрофон вимкнено. */
export const VOICE_STATES = [
  'loading',
  'idle',
  'listening',
  'recognizing',
  'busy',
  'followUp',
  'paused',
] as const;
export type VoiceState = (typeof VOICE_STATES)[number];

/**
 * Перше повідомлення voice: шляхи. Порти — у тому самому повідомленні: перший — до core
 * (клієнт протоколу core ↔ desktop), другий — до вікна звуку.
 */
const voiceInit = z.object({
  type: z.literal('voice.init'),
  appVersion: z.string(),
  modelsDir: path,
  dataDir: path,
  logsDir: path,
  /**
   * Перевірка програми: без мікрофона й динаміків — Banshee каже собі «Котра година?» голосом
   * озвучки й слухає це через кнопку мікрофона.
   */
  selfTest: z.boolean().optional(),
});
/** Новий порт до core (core перезапустився) або до вікна звуку (сторінку перезавантажено). */
const voicePort = z.object({ type: z.literal('voice.port'), to: z.enum(['core', 'audio']) });
/** Пауза мікрофона: гаряча клавіша, пункт трею, сон Windows. */
const voicePause = z.object({ type: z.literal('voice.pause'), paused: z.boolean() });
/** Кнопка мікрофона в оверлеї: слухати команду без слова «Banshee». */
const voiceListen = z.object({ type: z.literal('voice.listen') });
/** Зупинити озвучку й забути команду: гаряча клавіша «стоп». */
const voiceHush = z.object({ type: z.literal('voice.hush') });
const voiceStop = z.object({ type: z.literal('voice.stop') });

export const controlToVoice = z.discriminatedUnion('type', [
  voiceInit,
  voicePort,
  voicePause,
  voiceListen,
  voiceHush,
  voiceStop,
]);
export type ControlToVoice = z.output<typeof controlToVoice>;
export type VoiceInit = z.output<typeof voiceInit>;

const voiceStarted = z.object({
  type: z.literal('voice.started'),
  ms: z.number().min(0),
  /** Чи є профіль голосу власника: без нього команди не перевіряються. */
  profile: z.boolean(),
  /** Модель слова: власна (data\voice) чи базова. */
  wakeModel: z.enum(['own', 'base', 'none']),
});
/** Без моделей voice не стартує; missing — яких файлів бракує (відносно теки моделей). */
const voiceFailed = z.object({
  type: z.literal('voice.failed'),
  error: z.string(),
  missing: z.array(z.string()),
});
const voiceStateMessage = z.object({
  type: z.literal('voice.state'),
  state: z.enum(VOICE_STATES),
  speaking: z.boolean(),
});
/** Розпізнана команда — в оверлей, щоб власник бачив, що почув Banshee. */
const voiceHeard = z.object({
  type: z.literal('voice.heard'),
  /** Хід, який почала команда; немає — це відповідь «так» чи «ні» на картку. */
  turnId: z.string().max(64).optional(),
  text: z.string(),
  owner: z.boolean().nullable(),
});
/** Мікрофон не відкрився: немає дозволу Windows, пристрою, зайнятий. */
const voiceCapture = z.object({
  type: z.literal('voice.capture'),
  ok: z.boolean(),
  error: z.string().optional(),
});
/** Перевірка програми: що пройшло через конвеєр. */
const voiceSelfTest = z.object({
  type: z.literal('voice.selfTest'),
  heard: z.string().nullable(),
  sttMs: z.number().nullable(),
  played: z.number().int(),
});

export const controlFromVoice = z.discriminatedUnion('type', [
  voiceStarted,
  voiceFailed,
  voiceStateMessage,
  voiceHeard,
  voiceCapture,
  voiceSelfTest,
]);
export type ControlFromVoice = z.output<typeof controlFromVoice>;

function parse<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { ok: true; message: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
}

export const parseControlToVoice = (data: unknown) => parse(controlToVoice, data);
export const parseControlFromVoice = (data: unknown) => parse(controlFromVoice, data);

/**
 * Повідомлення порту звуку renderer ↔ voice. Звук — Float32Array, тож без zod: перевіряє
 * isAudioToVoice. 16 кГц, кроки по 1280 відліків (80 мс) у шкалі −1…1.
 */
export type AudioToVoice =
  | { readonly type: 'audio'; readonly samples: Float32Array }
  /** Фразу з цим id дограно до кінця або зупинено. */
  | { readonly type: 'played'; readonly id: string }
  | { readonly type: 'capture'; readonly ok: boolean; readonly error?: string };

export type VoiceToAudio =
  | {
      readonly type: 'play';
      readonly id: string;
      readonly samples: Float32Array;
      readonly sampleRate: number;
    }
  /** Замовкнути одразу: перебивання, «стоп». */
  | { readonly type: 'silence' };

export function isAudioToVoice(data: unknown): data is AudioToVoice {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'audio':
      return message.samples instanceof Float32Array && message.samples.length === 1280;
    case 'played':
      return typeof message.id === 'string' && message.id.length <= 64;
    case 'capture':
      return typeof message.ok === 'boolean';
    default:
      return false;
  }
}
