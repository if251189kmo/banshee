// Системні вимоги (.claude/logic/01-architecture.md, «Системні вимоги»): мінімальні й рекомендовані,
// поруч — дані цього ПК. Видно в «Про програму»; встановлювач перевіряє Windows, ядра й RAM сам.

/** Що головний процес знає про цей ПК і Banshee. */
export interface AboutInfo {
  readonly version: string;
  readonly electron: string;
  readonly packaged: boolean;
  /** «Windows 10 Pro», збірка 19045. */
  readonly windows: { readonly name: string; readonly build: number };
  readonly cpu: { readonly model: string; readonly threads: number };
  readonly ramGb: number;
  /** Тека Banshee і вільне місце на її диску. */
  readonly root: string;
  readonly freeGb: number | null;
}

export type Fit = 'ok' | 'weak' | 'unknown';

export interface RequirementRow {
  readonly item: string;
  readonly minimum: string;
  readonly recommended: string;
  /** Цей ПК; null — Banshee не перевіряє (мікрофон, звук, інтернет). */
  readonly here: string | null;
  readonly fit: Fit;
}

const gb = (value: number): string => `${value.toFixed(1).replace('.', ',')} ГБ`;

export function requirements(info: AboutInfo): RequirementRow[] {
  return [
    {
      item: 'Windows',
      minimum: '10 22H2 (збірка 19045), 64-біт',
      recommended: '11, 64-біт',
      here: `${info.windows.name}, збірка ${String(info.windows.build)}`,
      fit: info.windows.build >= 19045 ? 'ok' : 'weak',
    },
    {
      item: 'Процесор',
      minimum: '4 ядра x64 рівня Intel Core i5-6600',
      recommended: '6 ядер і більше',
      here: `${info.cpu.model}, потоків: ${String(info.cpu.threads)}`,
      fit: info.cpu.threads >= 4 ? 'ok' : 'weak',
    },
    {
      item: "Оперативна пам'ять",
      minimum: '8 ГБ; Banshee займає до 1,5 ГБ',
      recommended: '16 ГБ',
      here: gb(info.ramGb),
      // 8 ГБ модулів Windows показує трохи меншими: частину забирає обладнання.
      fit: info.ramGb >= 7 ? 'ok' : 'weak',
    },
    {
      item: 'Місце на диску',
      minimum: '3 ГБ вільного',
      recommended: '5 ГБ на SSD',
      here: info.freeGb === null ? null : `${gb(info.freeGb)} вільно`,
      fit: info.freeGb === null ? 'unknown' : info.freeGb >= 3 ? 'ok' : 'weak',
    },
    {
      item: 'Відеокарта',
      minimum: 'не потрібна',
      recommended: 'не потрібна',
      here: null,
      fit: 'ok',
    },
    {
      item: 'Мікрофон',
      minimum: 'будь-який; Bluetooth-гарнітура — з широкою смугою (16 кГц)',
      recommended: 'гарнітура або USB-мікрофон',
      here: null,
      fit: 'unknown',
    },
    {
      item: 'Інтернет і ключ Claude API',
      minimum: 'для ШІ; без них працює базовий режим',
      recommended: 'стабільний зв’язок; кредити ≈ $11 на місяць',
      here: null,
      fit: 'unknown',
    },
  ];
}
