// Команди між вікнами й головним процесом desktop (не core): сховати оверлей і підігнати його висоту,
// відкрити розділ центру керування, відкрити посилання в браузері. Перевіряються схемою на вході:
// сторінка не може попросити головний процес відкрити довільну адресу.
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
  z.object({ type: z.literal('overlay.hide') }),
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
]);

/** Запити сторінки до головного процесу з відповіддю (ipcRenderer.invoke). */
export const INVOKE_CHANNELS = ['about', 'diagnostics'] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type UiToMain = z.output<typeof uiToMain>;

export const uiToWindow = z.discriminatedUnion('type', [
  /** Оверлей щойно показано: фокус у поле команди. */
  z.object({ type: z.literal('overlay.shown') }),
  z.object({ type: z.literal('center.section'), section, anchor: z.string().optional() }),
]);
export type UiToWindow = z.output<typeof uiToWindow>;
