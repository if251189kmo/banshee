// Команди між вікнами й головним процесом desktop (не core): сховати оверлей і підігнати його висоту,
// відкрити розділ центру керування, відкрити посилання в браузері. Перевіряються схемою на вході:
// сторінка не може попросити головний процес відкрити довільну адресу.
import {
  VOICE_STATES,
  voiceCapture,
  voiceDevices,
  voiceEnrollment,
  voiceLevel,
} from '@banshee/shared';
import { z } from '@banshee/shared/zod';

/** Розділи центру керування (.claude/logic/09-ui.md); `wizard` — майстер першого запуску. */
export const SECTIONS = [
  'overview',
  'activity',
  'journal',
  'settings',
  'help',
  'about',
  'wizard',
] as const;
export type Section = (typeof SECTIONS)[number];

/** Посилання, які сторінки можуть відкрити в браузері: Console для ключа й оплати (12-api.md). */
export const LINKS = ['console', 'keys', 'billing', 'usage'] as const;
export type ExternalLink = (typeof LINKS)[number];

export const EXTERNAL_LINKS: Readonly<Record<ExternalLink, string>> = {
  console: 'https://platform.claude.com/',
  keys: 'https://platform.claude.com/settings/keys',
  billing: 'https://platform.claude.com/settings/billing',
  usage: 'https://platform.claude.com/usage',
};

const section = z.enum(SECTIONS);

export const uiToMain = z.discriminatedUnion('type', [
  /** idle — 8 с без дій; user — Esc. Після показу idle-запит застарілий (main.showOverlay). */
  z.object({ type: z.literal('overlay.hide'), reason: z.enum(['idle', 'user']).optional() }),
  /** Висота вмісту оверлею: вікно росте й стискається разом із відповіддю. */
  z.object({ type: z.literal('overlay.resize'), height: z.number().int().min(40).max(2000) }),
  z.object({
    type: z.literal('center.open'),
    section: section.optional(),
    /** Налаштування, на яке прокрутити: ключ на кшталт `ai.limits` або `brain`. */
    anchor: z.string().max(80).optional(),
  }),
  z.object({ type: z.literal('external.open'), link: z.enum(LINKS) }),
  /** Тека Banshee в Провіднику. */
  z.object({ type: z.literal('folder.open') }),
  /** Останній зібраний архів діагностики — у Провіднику. */
  z.object({ type: z.literal('diagnostics.show') }),
  /** Кнопка мікрофона в оверлеї: слухати команду без слова «Banshee». */
  z.object({ type: z.literal('voice.listen') }),
  /** Завантажити моделі голосу, яких бракує (Налаштування → Голос). */
  z.object({ type: z.literal('voice.download') }),
  /** «Мій голос»: почати фразу, фразу сказано, зберегти профіль, скасувати. */
  z.object({
    type: z.literal('voice.enroll'),
    action: z.enum(['start', 'stop', 'finish', 'cancel']),
  }),
]);

/** Запити сторінки до головного процесу з відповіддю (ipcRenderer.invoke). */
export const INVOKE_CHANNELS = [
  'about',
  'diagnostics',
  'erase',
  'voiceModels',
  'voiceDevices',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type UiToMain = z.output<typeof uiToMain>;

export const uiToWindow = z.discriminatedUnion('type', [
  /** Оверлей щойно показано: фокус у поле команди. */
  z.object({ type: z.literal('overlay.shown') }),
  z.object({ type: z.literal('center.section'), section, anchor: z.string().optional() }),
  /** Стан голосу для оверлея й центру керування; off — вимкнено, failed — не працює (problem). */
  z.object({
    type: z.literal('voice'),
    state: z.enum([...VOICE_STATES, 'off', 'failed']),
    speaking: z.boolean(),
    problem: z.string().nullable(),
  }),
  /** Завантаження моделей голосу: перебіг, кінець або помилка. */
  z.object({
    type: z.literal('voice.download'),
    state: z.enum(['running', 'done', 'failed']),
    done: z.number().min(0),
    total: z.number().min(0),
    error: z.string().optional(),
  }),
  /** «Мій голос»: перебіг запису й рівень мікрофона, поки записується фраза. */
  voiceEnrollment,
  voiceLevel,
  /** Який мікрофон відкрило вікно звуку, і пристрої звуку для вибору в налаштуваннях. */
  voiceCapture,
  voiceDevices,
  /** Що почув Banshee: команда (з ходом) або «так» / «ні» на картку. */
  z.object({
    type: z.literal('voice.heard'),
    turnId: z.string().optional(),
    text: z.string(),
    owner: z.boolean().nullable(),
  }),
]);
export type UiToWindow = z.output<typeof uiToWindow>;
