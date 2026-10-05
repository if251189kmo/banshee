// Типи інструментів (.claude/logic/01-architecture.md, «Інструменти етапу 1»). Схеми для Claude
// й виконання — у mcp/pc (крок 1.4); тут — те, що бачать і core, і desktop.
import type { ActionLevel } from './levels.ts';

export interface ToolMeta {
  /** Типовий рівень. `file_op` понад 20 файлів і `run_powershell` поза списком дозволених — 🔴. */
  readonly level: ActionLevel;
  /** Успішна дія завершує хід без другого виклику моделі (03-brain.md, «Маршрутизація»). */
  readonly final: boolean;
  /** Дію можна повторити у вивченій рутині (08-learning.md). */
  readonly replayable: boolean;
  /** Дозволено на заблокованому ПК. */
  readonly allowWhenLocked: boolean;
  /** Журнал зберігає `undo_json` для «скасуй». */
  readonly undoable: boolean;
  /** Лише читає стан ПК: зайвий виклик в еталонному наборі не вважається помилкою. */
  readonly readOnly: boolean;
}

/** Інструменти ПК етапу 1 (`mcp/pc`). */
export const PC_TOOL_NAMES = [
  'open_app',
  'close_app',
  'volume',
  'media',
  'window',
  'open_target',
  'find_files',
  'file_op',
  'run_powershell',
  'system_info',
  'lock_pc',
] as const;
export type PcToolName = (typeof PC_TOOL_NAMES)[number];

/** Інструменти самого core: ескалація — етап 1, `recall` — етап 3, `code_task` — етап 4. */
export const CORE_TOOL_NAMES = ['escalate', 'recall', 'code_task'] as const;
export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

export type ToolName = PcToolName | CoreToolName;

/** Зміна налаштування — теж дія журналу (10-settings.md, «Правила»). */
export const SETTINGS_TOOL = 'settings.set';
