// Налаштування для сторінки (.claude/logic/10-settings.md, «Розділи»): розділи за префіксом ключа
// й елемент керування з самої схеми zod — тип, межі, варіанти. Новий пункт у схемі з'являється на
// сторінці без нового коду.
import { SETTINGS, SETTING_KEYS, type SettingKey } from '@banshee/shared';
import { z } from '@banshee/shared/zod';

export const SETTING_SECTIONS = [
  { id: 'general', title: 'Загальні' },
  { id: 'voice', title: 'Голос' },
  { id: 'ai', title: 'Мозок і витрати', anchor: 'brain' },
  { id: 'learning', title: "Пам'ять і навчання" },
  { id: 'security', title: 'Безпека — лише вручну' },
  { id: 'sync', title: 'Синхронізація' },
  { id: 'storage', title: 'Сховище' },
] as const;
export type SectionId = (typeof SETTING_SECTIONS)[number]['id'];

export function sectionOf(key: SettingKey): SectionId {
  return key.split('.')[0] as SectionId;
}

export interface Option {
  readonly value: string;
  readonly label: string;
}

export type Control =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'choice'; readonly options: readonly Option[] }
  | {
      readonly kind: 'number';
      readonly min: number | null;
      readonly max: number | null;
      readonly integer: boolean;
      readonly nullable: boolean;
    }
  | { readonly kind: 'text'; readonly nullable: boolean }
  | { readonly kind: 'lines' }
  | { readonly kind: 'checks'; readonly options: readonly Option[] }
  | {
      readonly kind: 'group';
      readonly fields: readonly { name: string; label: string; control: Control }[];
    }
  /** Пристрій звуку зі списку вікна звуку; «default» — як у Windows. */
  | { readonly kind: 'device'; readonly direction: 'input' | 'output' }
  | { readonly kind: 'json' };

/** Налаштування, де значення — назва пристрою звуку, а не довільний текст. */
const DEVICE_SETTINGS: Partial<Record<SettingKey, 'input' | 'output'>> = {
  'voice.microphone': 'input',
  'voice.speakers': 'output',
};

/** Елемент керування для пункту: пристрій звуку — список, решта — зі схеми. */
export function controlForKey(key: SettingKey): Control {
  const direction = DEVICE_SETTINGS[key];
  return direction ? { kind: 'device', direction } : controlFor(SETTINGS[key].schema);
}

const VALUE_LABELS: Readonly<Record<string, string>> = {
  system: 'Як у Windows',
  light: 'Світла',
  dark: 'Темна',
  uk: 'Українська',
  low: 'Низька',
  medium: 'Середня',
  high: 'Висока',
  daily: 'Щодня',
  weekly: 'Щотижня',
  off: 'Вимкнено',
  tetiana: 'Тетяна (Piper, висока якість)',
  'parakeet-tdt-0.6b-v3': 'Parakeet TDT 0.6B v3',
  time_date: 'Час і дата',
  media: 'Музика',
  volume: 'Гучність',
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  overlay: 'Оверлей',
  micPause: 'Пауза мікрофона',
  stop: 'Стоп',
  enabled: 'Увімкнено',
  seconds: 'Секунд',
  voice: 'Голос',
  speed: 'Темп',
  dayUsd: 'На день, $',
  monthUsd: 'На місяць, $',
  at: 'О котрій',
  keep: 'Скільки копій',
  files: 'Файлів',
  sizeMb: 'Розмір файлу, МБ',
  default: 'Модель за замовчуванням',
  complex: 'Модель для складного',
  prices: 'Ціни, $ за 1 млн токенів',
};

const option = (value: string): Option => ({ value, label: VALUE_LABELS[value] ?? value });

export function controlFor(schema: z.ZodType): Control {
  if (schema instanceof z.ZodNullable) {
    const inner = controlFor(schema.unwrap() as z.ZodType);
    if (inner.kind === 'number') return { ...inner, nullable: true };
    if (inner.kind === 'text') return { kind: 'text', nullable: true };
    return { kind: 'json' };
  }
  if (schema instanceof z.ZodBoolean) return { kind: 'toggle' };
  if (schema instanceof z.ZodEnum) {
    return { kind: 'choice', options: schema.options.map((value) => option(String(value))) };
  }
  if (schema instanceof z.ZodNumber) {
    return {
      kind: 'number',
      min: schema.minValue,
      max: schema.maxValue,
      integer: schema.format?.includes('int') ?? false,
      nullable: false,
    };
  }
  if (schema instanceof z.ZodString) return { kind: 'text', nullable: false };
  if (schema instanceof z.ZodArray) {
    const element = schema.element as z.ZodType;
    if (element instanceof z.ZodEnum) {
      return { kind: 'checks', options: element.options.map((value) => option(String(value))) };
    }
    if (element instanceof z.ZodString) return { kind: 'lines' };
    return { kind: 'json' };
  }
  if (schema instanceof z.ZodObject) {
    const fields = Object.entries(schema.shape as Record<string, z.ZodType>).map(
      ([name, field]) => ({ name, label: FIELD_LABELS[name] ?? name, control: controlFor(field) }),
    );
    return fields.some((field) => field.control.kind === 'json' || field.control.kind === 'group')
      ? { kind: 'json' }
      : { kind: 'group', fields };
  }
  return { kind: 'json' };
}

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);

/** Значення словами: «Типово: …» і підтвердження зміни безпекового налаштування. */
export function formatValue(control: Control, value: unknown): string {
  switch (control.kind) {
    case 'toggle':
      return value === true ? 'так' : 'ні';
    case 'choice':
      return VALUE_LABELS[text(value)] ?? text(value);
    case 'number':
      return value === null ? 'не задано' : text(value).replace('.', ',');
    case 'text':
      return value === null || value === '' ? 'не задано' : text(value);
    case 'lines':
      return Array.isArray(value) ? `${String(value.length)} шт.` : '';
    case 'checks':
      return Array.isArray(value)
        ? value.map((item) => VALUE_LABELS[text(item)] ?? text(item)).join(', ') || 'нічого'
        : '';
    case 'group':
      return control.fields
        .map(
          (field) =>
            `${field.label.toLowerCase()} ${formatValue(field.control, (value as Record<string, unknown>)[field.name])}`,
        )
        .join(', ');
    case 'device':
      return value === 'default' ? 'Як у Windows' : text(value);
    case 'json':
      return JSON.stringify(value);
  }
}

/** Пункти розділу: видимі, у порядку схеми; пошук — за назвою й описом. */
export function visibleKeys(
  section: SectionId | null,
  query: string,
  hidden: boolean,
): SettingKey[] {
  const needle = query.trim().toLowerCase();
  return SETTING_KEYS.filter((key) => {
    const def = SETTINGS[key];
    if (def.hidden && !hidden) return false;
    if (key === 'general.setupDone') return false;
    if (needle) {
      return `${def.label} ${def.description}`.toLowerCase().includes(needle);
    }
    return section === null || sectionOf(key) === section;
  });
}
