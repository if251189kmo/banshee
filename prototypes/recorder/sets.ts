// Що записує власник на кроці 0.2 (.claude/logic/13-plan.md) і для чого:
// команди — Whisper (0.3) і голос власника (0.6); «Banshee» — слово (0.5); профіль і чужі голоси — 0.6;
// фон без слова — хибні спрацювання слова (0.5).
import type { Dataset } from '../../scripts/lib/evals/dataset.ts';

export const RECORDING_SETS = ['commands', 'wake', 'profile', 'foreign', 'background'] as const;
export type RecordingSet = (typeof RECORDING_SETS)[number];

export interface PromptItem {
  readonly id: string;
  readonly text: string;
}

export interface WakeSeries {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export interface RecordingPlan {
  /** Команди еталонного набору: власник читає їх уголос. */
  readonly commands: readonly PromptItem[];
  /** Серії «Banshee»: сказати слово за кожною підказкою на екрані. */
  readonly wake: {
    readonly series: readonly WakeSeries[];
    readonly intervalMs: number;
    readonly leadInMs: number;
  };
  /** Фрази профілю голосу, ~5 с кожна, разом ~30 с — як у майстрі першого запуску (02-voice.md). */
  readonly profile: readonly PromptItem[];
  /** Чуже мовлення з ТБ чи відео: кліпи підряд. */
  readonly foreign: { readonly count: number; readonly seconds: number };
  /** Фон без слова «Banshee»: довгий запис частинами. */
  readonly background: { readonly chunkMinutes: number; readonly targetHours: number };
}

/**
 * Banshee слухає Bluetooth-гарнітуру, і власник носить її не завжди: вона лежить на столі,
 * а команди звучать з різних місць кімнати (рішення власника 2026-10-04). Тому серії — з відстанню.
 */
export const WAKE_SERIES: readonly WakeSeries[] = [
  { id: 'near-quiet', label: '≈ 1 м від мікрофона, тиша', count: 25 },
  { id: 'far-quiet', label: '≈ 3 м від мікрофона, тиша', count: 25 },
  { id: 'near-music', label: '≈ 1 м, грає музика', count: 25 },
  { id: 'far-music', label: '≈ 3 м, грає музика', count: 25 },
];

export const PROFILE_PHRASES: readonly PromptItem[] = [
  { id: 'profile-1', text: 'Banshee, відкрий браузер і покажи прогноз погоди на завтра.' },
  { id: 'profile-2', text: 'Сьогодні я працюю вдома і хочу, щоб мене не відволікали без потреби.' },
  { id: 'profile-3', text: 'Зроби гучність на сорок відсотків і ввімкни мою улюблену музику.' },
  {
    id: 'profile-4',
    text: 'У четвер о пів на дев’яту в мене зустріч, не дай мені про неї забути.',
  },
  { id: 'profile-5', text: 'Цей запис потрібен, щоб Banshee впізнавав мій голос серед інших.' },
];

export function buildPlan(dataset: Dataset): RecordingPlan {
  return {
    commands: dataset.cases.map((item) => ({ id: item.id, text: item.text })),
    wake: { series: WAKE_SERIES, intervalMs: 3000, leadInMs: 3000 },
    profile: PROFILE_PHRASES,
    foreign: { count: 20, seconds: 5 },
    background: { chunkMinutes: 10, targetHours: 10 },
  };
}
