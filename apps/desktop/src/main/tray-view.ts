// Що показує значок у треї (.claude/logic/09-ui.md, «Стани»): форма значка й підказка зі станом core
// і ШІ. Чиста функція: головний процес лише ставить іконку й текст.
import { AI_STATE_TEXT, isBasicMode, type AiState } from '@banshee/shared';
import type { SupervisorState } from './supervisor.ts';

/** Варіанти значка — файли `resources/tray-<варіант>.png` (scripts/icons.ts). */
export type TrayIcon = 'idle' | 'basic' | 'down';

export interface TrayView {
  readonly icon: TrayIcon;
  readonly tooltip: string;
  /** Пункт меню «Перезапустити core» — лише коли нагляд здався. */
  readonly canRestart: boolean;
}

const CORE_TEXT: Record<Exclude<SupervisorState, 'running'>, string> = {
  stopped: 'зупинено',
  starting: 'запускається…',
  restarting: 'перезапуск після збою…',
  failed: 'ядро зупинилося після 3 збоїв — «Перезапустити» в меню',
  stopping: 'завершує роботу…',
};

export function trayView(core: SupervisorState, ai: AiState | null): TrayView {
  if (core !== 'running') {
    return { icon: 'down', tooltip: `Banshee — ${CORE_TEXT[core]}`, canRestart: core === 'failed' };
  }
  if (ai === null) return { icon: 'idle', tooltip: 'Banshee', canRestart: false };
  return {
    icon: isBasicMode(ai) ? 'basic' : 'idle',
    tooltip: `Banshee — ${AI_STATE_TEXT[ai].label}`,
    canRestart: false,
  };
}
