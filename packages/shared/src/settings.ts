// Схема налаштувань (.claude/logic/10-settings.md): типи, межі, типові значення, хто й як може
// змінювати, міграції між версіями. Значення живуть у таблиці `settings` (core, крок 1.3);
// тут — лише перевірка, щоб core, інтерфейс і синхронізація розуміли їх однаково.
import { z } from './zod.ts';

export const SETTING_SECTIONS = [
  'general',
  'voice',
  'ai',
  'learning',
  'security',
  'sync',
  'storage',
] as const;
export type SettingSection = (typeof SETTING_SECTIONS)[number];

export const SECTION_TITLES: Readonly<Record<SettingSection, string>> = {
  general: 'Загальні',
  voice: 'Голос',
  ai: 'Мозок і витрати',
  learning: "Пам'ять і навчання",
  security: 'Безпека',
  sync: 'Синхронізація',
  storage: 'Сховище',
};

/** user — переноситься на інші ПК разом із пам'яттю; device — лише цей ПК. */
export type SettingScope = 'user' | 'device';

export interface SettingDef<S extends z.ZodType = z.ZodType> {
  readonly scope: SettingScope;
  readonly label: string;
  readonly description: string;
  readonly schema: S;
  readonly defaultValue: z.output<S>;
  /** Безпекове чи грошове: лише вручну в центрі керування, з підтвердженням кліком. */
  readonly manualOnly: boolean;
  /** Можна змінити голосом — це 🟡 дія з підтвердженням. */
  readonly voice: boolean;
  /** Діє після перезапуску Banshee. */
  readonly restart: boolean;
  /** Не показується в списку: «Мозок → Моделі» для заміни виведеної з обігу моделі. */
  readonly hidden: boolean;
}

type SettingInput<S extends z.ZodType> = Pick<
  SettingDef<S>,
  'scope' | 'label' | 'description' | 'schema' | 'defaultValue'
> &
  Partial<Pick<SettingDef<S>, 'manualOnly' | 'voice' | 'restart' | 'hidden'>>;

function setting<S extends z.ZodType>(input: SettingInput<S>): SettingDef<S> {
  return { manualOnly: false, voice: false, restart: false, hidden: false, ...input };
}

const SENSITIVITY = z.enum(['low', 'medium', 'high']);

/** «Ctrl+Shift+B»: 1–3 модифікатори й клавіша — літера, цифра, F1–F12 або Space. */
const hotkey = z
  .string()
  .regex(/^(?:(?:Ctrl|Alt|Shift|Win)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space)$/, {
    error:
      'Гаряча клавіша — модифікатори Ctrl, Alt, Shift чи Win і клавіша, наприклад Ctrl+Shift+B',
  });

const clockTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { error: 'Час — у форматі 03:00' });

/** Абсолютний шлях Windows: «D:\Projects\banshee». */
const windowsPath = z.string().regex(/^[A-Za-z]:\\(?:[^<>:"/\\|?*\r\n]+\\?)*$/, {
  error: 'Потрібен повний шлях до теки, наприклад D:\\Projects',
});

/** Точний ID моделі без дати: «claude-haiku-4-5» (03-brain.md, «Пастки API»). */
const modelId = z
  .string()
  .regex(/^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'ID моделі — на кшталт claude-haiku-4-5' })
  .refine((id) => !/-\d{8}$/.test(id), { error: 'ID моделі — без дати в кінці' });

const price = z.object({ input: z.number().min(0), output: z.number().min(0) });

/** Команди PowerShell з базового списку — 🟡; будь-яка інша — 🔴 (05-safety.md). */
export const DEFAULT_POWERSHELL_ALLOWLIST: readonly string[] = [
  'Get-Process',
  'Stop-Process',
  'Start-Process',
  'Get-Service',
  'Get-NetIPAddress',
  'Get-NetIPConfiguration',
  'Get-NetAdapter',
  'Get-NetConnectionProfile',
  'Test-Connection',
  'Test-NetConnection',
  'Resolve-DnsName',
  'Get-ComputerInfo',
  'Get-CimInstance',
  'Get-PSDrive',
  'Get-Volume',
  'Get-HotFix',
  'Get-StartApps',
  'Get-AppxPackage',
  'Get-Package',
  'Get-TimeZone',
  'Get-Date',
  'Get-ChildItem',
  'Get-Item',
  'Select-Object',
  'Where-Object',
  'Sort-Object',
  'Measure-Object',
  'Group-Object',
  'ForEach-Object',
  'Format-Table',
  'Format-List',
  'Out-String',
  'ConvertTo-Json',
];

export const LOCKED_ACTIONS = ['time_date', 'media', 'volume'] as const;

export const SETTINGS = {
  'general.autostart': setting({
    scope: 'device',
    label: 'Запускати разом з Windows',
    description: 'Banshee стартує після входу в Windows і чекає у треї.',
    schema: z.boolean(),
    defaultValue: true,
  }),
  'general.theme': setting({
    scope: 'user',
    label: 'Тема',
    description: 'Світла, темна або як у Windows.',
    schema: z.enum(['system', 'light', 'dark']),
    defaultValue: 'system',
    voice: true,
  }),
  'general.language': setting({
    scope: 'user',
    label: 'Мова інтерфейсу й відповідей',
    description: 'Поки лише українська.',
    schema: z.enum(['uk']),
    defaultValue: 'uk',
  }),
  'general.hotkeys': setting({
    scope: 'device',
    label: 'Гарячі клавіші',
    description: 'Оверлей, пауза мікрофона й «стоп». Поєднання мають бути різними.',
    schema: z
      .object({ overlay: hotkey, micPause: hotkey, stop: hotkey })
      .refine((keys) => new Set(Object.values(keys)).size === 3, {
        error: 'Гарячі клавіші мають бути різними',
      }),
    defaultValue: { overlay: 'Ctrl+Shift+B', micPause: 'Ctrl+Shift+M', stop: 'Ctrl+Shift+X' },
  }),
  'general.setupDone': setting({
    scope: 'device',
    label: 'Майстер першого запуску пройдено',
    description: 'Після встановлення Banshee один раз показує майстер: ключ Claude і клавіші.',
    schema: z.boolean(),
    defaultValue: false,
    hidden: true,
  }),

  'voice.enabled': setting({
    scope: 'device',
    label: 'Голосові команди',
    description:
      'Banshee слухає мікрофон: слово «Banshee» і кнопка мікрофона в оверлеї. Вимкнено — лише текст, мікрофон закритий.',
    schema: z.boolean(),
    defaultValue: false,
  }),
  'voice.wakeSensitivity': setting({
    scope: 'user',
    label: 'Чутливість слова «Banshee»',
    description:
      'Вища — Banshee частіше чує слово здалеку й під шум, але частіше прокидається даремно.',
    schema: SENSITIVITY,
    defaultValue: 'medium',
  }),
  'voice.microphone': setting({
    scope: 'device',
    label: 'Мікрофон',
    description: 'Пристрій запису; «default» — як у Windows.',
    schema: z.string().min(1),
    defaultValue: 'default',
  }),
  'voice.speakers': setting({
    scope: 'device',
    label: 'Динаміки',
    description: 'Пристрій для озвучки; «default» — як у Windows.',
    schema: z.string().min(1),
    defaultValue: 'default',
  }),
  'voice.onlyWhenActive': setting({
    scope: 'device',
    label: 'Слухати, лише коли ПК активний',
    description: 'Слово «Banshee» працює, лише якщо за останні 15 хв було введення.',
    schema: z.boolean(),
    defaultValue: false,
    voice: true,
  }),
  'voice.endPauseSec': setting({
    scope: 'user',
    label: 'Пауза кінця фрази',
    description: 'Скільки тиші означає, що команду договорено, с.',
    schema: z.number().min(0.3).max(2),
    defaultValue: 0.5,
    voice: true,
  }),
  'voice.followUp': setting({
    scope: 'user',
    label: 'Вікно продовження',
    description: 'Скільки секунд після відповіді Banshee слухає без слова «Banshee».',
    schema: z.object({ enabled: z.boolean(), seconds: z.number().int().min(2).max(15) }),
    defaultValue: { enabled: true, seconds: 5 },
    voice: true,
  }),
  'voice.stt': setting({
    scope: 'device',
    label: 'Розпізнавання',
    description: 'Parakeet TDT 0.6B v3 на процесорі; назви зі словника — гарячими словами.',
    schema: z.enum(['parakeet-tdt-0.6b-v3']),
    defaultValue: 'parakeet-tdt-0.6b-v3',
    restart: true,
  }),
  'voice.tts': setting({
    scope: 'user',
    label: 'Голос і швидкість озвучки',
    description: 'Голос Piper і темп мовлення: 1,0 — звичайний.',
    schema: z.object({ voice: z.enum(['tetiana']), speed: z.number().min(0.5).max(2) }),
    defaultValue: { voice: 'tetiana', speed: 1 },
    voice: true,
  }),
  'voice.speakAnswers': setting({
    scope: 'user',
    label: 'Озвучувати відповіді',
    description:
      'На голосові команди Banshee відповідає голосом; вимкнено — лише текстом в оверлеї. На набрані в оверлеї — завжди текстом.',
    schema: z.boolean(),
    defaultValue: true,
    voice: true,
  }),

  'ai.enabled': setting({
    scope: 'device',
    label: 'Використовувати ШІ',
    description:
      'Вимкнено — базовий режим: рутини й вбудовані команди без запитів до Claude. Вимкнути можна й голосом; увімкнути голосом — з підтвердженням, бо це коштує грошей.',
    schema: z.boolean(),
    defaultValue: true,
    voice: true,
  }),
  'ai.escalation': setting({
    scope: 'user',
    label: 'Ескалація на Sonnet',
    description: 'Складні задачі Haiku передає Sonnet 5.5.',
    schema: z.boolean(),
    defaultValue: true,
  }),
  'ai.limits': setting({
    scope: 'user',
    label: 'Ліміт витрат на день і місяць',
    description: 'Досягнувши ліміту, Banshee переходить у базовий режим. Змінюється лише вручну.',
    schema: z
      .object({ dayUsd: z.number().min(0.1).max(50), monthUsd: z.number().min(1).max(500) })
      .refine((limits) => limits.dayUsd <= limits.monthUsd, {
        error: 'Денний ліміт не може бути більшим за місячний',
      }),
    defaultValue: { dayUsd: 1, monthUsd: 20 },
    manualOnly: true,
  }),
  'ai.credits': setting({
    scope: 'user',
    label: 'Кредити після поповнення',
    description: 'Сума останнього поповнення, $: з неї Banshee оцінює залишок кредитів.',
    schema: z.number().min(0).nullable(),
    defaultValue: null,
    manualOnly: true,
  }),
  'ai.lowCreditsWarnUsd': setting({
    scope: 'user',
    label: 'Попереджати, коли кредитів менше ніж',
    description: 'Оцінка залишку нижче цієї суми, $ — сповіщення в треї.',
    schema: z.number().min(0).max(100),
    defaultValue: 2,
  }),
  'ai.showTurnCost': setting({
    scope: 'user',
    label: 'Показувати вартість ходу',
    description: 'Вартість кожної команди в оверлеї.',
    schema: z.boolean(),
    defaultValue: false,
    voice: true,
  }),
  'ai.models': setting({
    scope: 'user',
    label: 'Моделі й ціни',
    description:
      'Для заміни моделі, яку Anthropic вивела з обігу, без нової версії Banshee. Ціни — $ за 1 млн токенів.',
    schema: z
      .object({ default: modelId, complex: modelId, prices: z.record(z.string(), price) })
      .refine((models) => models.default in models.prices && models.complex in models.prices, {
        error: 'Для кожної моделі потрібна ціна',
      }),
    defaultValue: {
      default: 'claude-haiku-4-5',
      complex: 'claude-sonnet-5-5',
      prices: {
        'claude-haiku-4-5': { input: 1, output: 5 },
        'claude-sonnet-5-5': { input: 2, output: 10 },
      },
    },
    manualOnly: true,
    hidden: true,
  }),

  'learning.fromSuccess': setting({
    scope: 'user',
    label: 'Вчитися на успішних виконаннях',
    description: 'Успішні дії через ШІ стають кандидатами в рутини.',
    schema: z.boolean(),
    defaultValue: true,
  }),
  'learning.successesToActivate': setting({
    scope: 'user',
    label: 'Скільки успіхів до активації рутини',
    description: 'Після стількох успішних виконань вивчена 🟢 рутина працює без ШІ.',
    schema: z.number().int().min(1).max(10),
    defaultValue: 2,
  }),
  'learning.nightlyReview': setting({
    scope: 'user',
    label: 'Нічний самоаналіз',
    description: 'Раз на ніч Banshee переглядає помилки й пропонує правила.',
    schema: z.object({ enabled: z.boolean(), at: clockTime }),
    defaultValue: { enabled: true, at: '03:00' },
  }),
  'learning.suggestions': setting({
    scope: 'user',
    label: 'Пропозиції з повторів',
    description: 'Як часто Banshee пропонує зробити рутину з того, що повторюється.',
    schema: z.enum(['daily', 'weekly', 'off']),
    defaultValue: 'daily',
  }),
  'learning.transcriptDays': setting({
    scope: 'user',
    label: 'Зберігати транскрипти',
    description: 'Скільки днів зберігати текст розмов; далі лишається підсумок. 0 — не зберігати.',
    schema: z.number().int().min(0).max(365),
    defaultValue: 90,
  }),
  'learning.paused': setting({
    scope: 'user',
    label: 'Навчання на паузі',
    description: "Banshee нічого нового не запам'ятовує й не вчить рутин.",
    schema: z.boolean(),
    defaultValue: false,
    voice: true,
  }),

  'security.voiceFilter': setting({
    scope: 'device',
    label: 'Розпізнавання власника за голосом',
    description: 'Команди чужим голосом не виконуються. Діє після запису голосу.',
    schema: z.boolean(),
    defaultValue: true,
    manualOnly: true,
  }),
  'security.voiceStrictness': setting({
    scope: 'device',
    label: 'Суворість перевірки голосу',
    description: 'Вища — чужий голос проходить рідше, але й власника частіше не впізнано.',
    schema: SENSITIVITY,
    defaultValue: 'medium',
    manualOnly: true,
  }),
  'security.voiceConfirm': setting({
    scope: 'user',
    label: 'Підтвердження 🟡 голосом',
    description: 'Голосове «так» на дію-зміну приймається протягом цих секунд.',
    schema: z.object({ enabled: z.boolean(), seconds: z.number().int().min(3).max(30) }),
    defaultValue: { enabled: true, seconds: 8 },
    manualOnly: true,
  }),
  'security.massOperationFiles': setting({
    scope: 'user',
    label: 'Поріг масової операції',
    description: 'Дія з більшою кількістю файлів — 🔴: лише клік.',
    schema: z.number().int().min(1).max(1000),
    defaultValue: 20,
    manualOnly: true,
  }),
  'security.powershellAllowlist': setting({
    scope: 'user',
    label: 'Дозволені команди PowerShell',
    description: 'Ці команди — 🟡, з підтвердженням; будь-яка інша — 🔴, лише клік.',
    schema: z
      .array(z.string().regex(/^[A-Za-z]+-[A-Za-z]+$/, { error: 'Команда — у формі Get-Process' }))
      .max(200),
    defaultValue: [...DEFAULT_POWERSHELL_ALLOWLIST],
    manualOnly: true,
  }),
  'security.lockedActions': setting({
    scope: 'user',
    label: 'Дії на заблокованому ПК',
    description: 'Що Banshee робить, поки ПК заблоковано.',
    schema: z.array(z.enum(LOCKED_ACTIONS)),
    defaultValue: [...LOCKED_ACTIONS],
    manualOnly: true,
  }),
  'security.projectFolders': setting({
    scope: 'device',
    label: 'Теки проєктів для Claude Code',
    description: 'Лише в цих теках Banshee відкриває Claude Code.',
    schema: z.array(windowsPath).max(20),
    defaultValue: [],
    manualOnly: true,
  }),

  'sync.folder': setting({
    scope: 'device',
    label: 'Тека синхронізації',
    description: "Зашифровані зміни пам'яті для інших ПК, наприклад у OneDrive.",
    schema: windowsPath.nullable(),
    defaultValue: null,
  }),
  'sync.transcripts': setting({
    scope: 'user',
    label: 'Синхронізувати транскрипти',
    description: 'Текст розмов теж іде на інші ПК.',
    schema: z.boolean(),
    defaultValue: false,
  }),
  'sync.backup': setting({
    scope: 'device',
    label: 'Автоматична резервна копія',
    description: 'Щотижня; зберігаються останні копії.',
    schema: z.object({ enabled: z.boolean(), keep: z.number().int().min(1).max(20) }),
    defaultValue: { enabled: true, keep: 4 },
  }),

  'storage.logs': setting({
    scope: 'device',
    label: 'Журнали роботи',
    description: 'Скільки файлів журналу й якого розміру зберігати, МБ.',
    schema: z.object({
      files: z.number().int().min(1).max(20),
      sizeMb: z.number().int().min(1).max(50),
    }),
    defaultValue: { files: 5, sizeMb: 5 },
    restart: true,
  }),
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]['schema']>;
export type Settings = { -readonly [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

export function sectionOf(key: SettingKey): SettingSection {
  const section = SETTING_SECTIONS.find((name) => key.startsWith(`${name}.`));
  if (!section) throw new Error(`Налаштування ${key} без розділу`);
  return section;
}

function schemaOf<K extends SettingKey>(key: K): z.ZodType<SettingValue<K>> {
  return SETTINGS[key].schema as unknown as z.ZodType<SettingValue<K>>;
}

/** Копія типового значення: масиви й об'єкти не спільні між викликами. */
function defaultOf<K extends SettingKey>(key: K): SettingValue<K> {
  return structuredClone(SETTINGS[key].defaultValue) as SettingValue<K>;
}

export function defaultSettings(): Settings {
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, defaultOf(key)])) as Settings;
}

export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function parseSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): ParseResult<SettingValue<K>> {
  const result = schemaOf(key).safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
}

/** Рядок таблиці `settings`. */
export interface StoredSetting {
  readonly key: string;
  readonly valueJson: string;
  readonly scope: SettingScope;
}

export function toStored<K extends SettingKey>(key: K, value: SettingValue<K>): StoredSetting {
  return { key, valueJson: JSON.stringify(value), scope: SETTINGS[key].scope };
}

/**
 * Налаштування з рядків БД: відсутні — типові; невідомі ключі й зіпсовані значення пропускаються
 * з поясненням у problems — Banshee стартує з типовим значенням, а не падає.
 */
export function loadSettings(rows: readonly StoredSetting[]): {
  settings: Settings;
  problems: string[];
} {
  const settings = defaultSettings();
  const problems: string[] = [];
  const assign = <K extends SettingKey>(key: K, value: SettingValue<K>): void => {
    (settings as Record<SettingKey, unknown>)[key] = value;
  };
  for (const row of rows) {
    if (!isSettingKey(row.key)) {
      problems.push(`невідоме налаштування ${row.key}`);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.valueJson);
    } catch {
      problems.push(`${row.key}: значення — не JSON, узято типове`);
      continue;
    }
    const parsed = parseSetting(row.key, raw);
    if (!parsed.ok) {
      problems.push(`${row.key}: ${parsed.error}; узято типове`);
      continue;
    }
    assign(row.key, parsed.value);
  }
  return { settings, problems };
}

/** Звідки зміна: центр керування, голос, синхронізація з іншого ПК чи самонавчання. */
export type SettingChangeSource = 'ui' | 'voice' | 'sync' | 'learning';

/** none — одразу; voice — 🟡: голосом «так» або кліком; click — лише клік. */
export type ChangeVerdict =
  | { readonly allowed: false; readonly reason: string }
  | { readonly allowed: true; readonly confirm: 'none' | 'voice' | 'click' };

/** Хто й як може змінити налаштування (10-settings.md, «Як працюють» і «Правила»). */
export function changeVerdict<K extends SettingKey>(
  key: K,
  next: SettingValue<K>,
  source: SettingChangeSource,
): ChangeVerdict {
  const def: SettingDef = SETTINGS[key];
  switch (source) {
    case 'learning':
      return { allowed: false, reason: "Самонавчання змінює лише пам'ять, не налаштування." };
    case 'sync':
      if (def.scope === 'device') {
        return { allowed: false, reason: 'Налаштування пристрою не синхронізуються.' };
      }
      return { allowed: true, confirm: def.manualOnly ? 'click' : 'none' };
    case 'voice':
      if (def.manualOnly) {
        return { allowed: false, reason: 'Це змінюється лише вручну в налаштуваннях.' };
      }
      if (!def.voice) {
        return { allowed: false, reason: 'Це налаштування змінюється в центрі керування.' };
      }
      // Вимкнути ШІ голосом — одразу; увімкнути — з підтвердженням, бо це коштує грошей.
      return { allowed: true, confirm: key === 'ai.enabled' && next === false ? 'none' : 'voice' };
    case 'ui':
      return { allowed: true, confirm: def.manualOnly ? 'click' : 'none' };
  }
}

/** Версія схеми налаштувань; міграція — коли ключ чи формат значення змінюється. */
export const SETTINGS_VERSION = 1;

export interface SettingsMigration {
  /** З якої версії переводить на наступну. */
  readonly from: number;
  readonly migrate: (values: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [];

/** Переводить збережені значення з версії fromVersion на поточну, по одній версії за крок. */
export function migrateSettings(
  values: Readonly<Record<string, unknown>>,
  fromVersion: number,
  migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
  toVersion: number = SETTINGS_VERSION,
): Record<string, unknown> {
  if (fromVersion > toVersion) {
    throw new Error(
      `Налаштування з новішої версії Banshee (${String(fromVersion)}): потрібне оновлення програми`,
    );
  }
  let current: Record<string, unknown> = { ...values };
  for (let version = fromVersion; version < toVersion; version += 1) {
    const step = migrations.find((migration) => migration.from === version);
    if (!step) throw new Error(`Немає міграції налаштувань з версії ${String(version)}`);
    current = step.migrate(current);
  }
  return current;
}
