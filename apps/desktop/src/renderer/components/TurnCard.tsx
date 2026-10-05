// Хід в оверлеї й центрі керування (.claude/logic/09-ui.md, «Оверлей»): команда, відповідь стрімом,
// картки дій з іконкою рівня й «Скасувати», позначки «⚡ без ШІ» і «базовий режим».
import { AI_STATE_TEXT, type ActionLevel, type AiState, type TurnRoute } from '@banshee/shared';
import { useState } from 'react';
import { core } from '../core-client.ts';
import type { TurnView } from '../core-state.ts';
import { usd } from '../format.ts';

export const LEVEL_LABEL: Record<ActionLevel, string> = {
  green: '🟢 безпечна',
  yellow: '🟡 зміна',
  red: '🔴 небезпечна',
};

const ROUTE_LABEL: Record<TurnRoute, string> = {
  routine: '⚡ без ШІ',
  llm: 'Haiku',
  escalation: 'Sonnet',
  code: 'Claude Code',
  none: '',
};

function ActionCard({ action }: { action: TurnView['actions'][number] }) {
  const [undo, setUndo] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const status =
    action.status === 'done'
      ? ''
      : action.status === 'failed'
        ? ' — не вийшло'
        : action.status === 'denied'
          ? ' — відхилено'
          : action.status === 'cancelled'
            ? ' — скасовано'
            : ' — виконується…';
  return (
    <li className={`action level-${action.level}`}>
      <span className="level">{LEVEL_LABEL[action.level]}</span>
      <span className="what">
        {action.summary}
        {status}
      </span>
      {action.undoable && action.status === 'done' && undo !== 'done' ? (
        <button
          type="button"
          className="secondary small"
          disabled={undo === 'busy'}
          onClick={() => {
            setUndo('busy');
            core.undo(Number(action.actionId)).then(
              () => {
                setUndo('done');
              },
              () => {
                setUndo('failed');
              },
            );
          }}
        >
          Скасувати
        </button>
      ) : null}
      {undo === 'done' ? <span className="muted">скасовано</span> : null}
      {undo === 'failed' ? <span className="muted">скасувати не вийшло</span> : null}
    </li>
  );
}

/** Що робити, коли команді потрібен ШІ, а його немає (03-brain.md, «Стан ШІ й базовий режим»). */
export function BasicModeAction({ state }: { state: AiState }) {
  switch (state) {
    case 'off':
      return (
        <button
          type="button"
          className="small"
          onClick={() => void core.setSetting('ai.enabled', true)}
        >
          Увімкнути ШІ
        </button>
      );
    case 'day_limit':
      return (
        <button type="button" className="small" onClick={() => void core.extraDay()}>
          Ще $1 на сьогодні
        </button>
      );
    case 'billing':
      return (
        <button
          type="button"
          className="small"
          onClick={() => {
            window.banshee.ui({ type: 'external.open', link: 'billing' });
          }}
        >
          Поповнити
        </button>
      );
    case 'no_key':
    case 'key_invalid':
      return (
        <button
          type="button"
          className="small"
          onClick={() => {
            window.banshee.ui({ type: 'center.open', section: 'settings', anchor: 'brain' });
          }}
        >
          Додати ключ
        </button>
      );
    default:
      return null;
  }
}

export function TurnCard({
  turn,
  aiState,
  showCost,
}: {
  turn: TurnView;
  aiState: AiState | null;
  showCost: boolean;
}) {
  const route = turn.done ? ROUTE_LABEL[turn.done.route] : '';
  const noAi = turn.done?.outcome === 'no_ai';
  return (
    <article className="turn">
      {turn.text ? <p className="said">{turn.text}</p> : null}
      {turn.say ? <p className="reply">{turn.say}</p> : null}
      {turn.actions.length > 0 ? (
        <ul className="actions">
          {turn.actions.map((action) => (
            <ActionCard key={action.actionId} action={action} />
          ))}
        </ul>
      ) : null}
      <p className="marks">
        {route ? <span className="mark">{route}</span> : null}
        {noAi && aiState ? (
          <>
            <span className="mark basic">{AI_STATE_TEXT[aiState].label}</span>
            <BasicModeAction state={aiState} />
          </>
        ) : null}
        {showCost && turn.done && turn.done.costUsd > 0 ? (
          <span className="mark">{usd(turn.done.costUsd)}</span>
        ) : null}
      </p>
    </article>
  );
}
