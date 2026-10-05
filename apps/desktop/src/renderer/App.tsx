// Каркас центру керування (крок 1.1): з'єднання з core, стан ШІ, команда й відповіді, підтвердження
// кліком. Розділи, оверлей, картки з відліком і клавіші — крок 1.7 (.claude/logic/09-ui.md).
import {
  AI_STATE_TEXT,
  parseCoreMessage,
  PROTOCOL_VERSION,
  ulid,
  type ActionLevel,
  type TurnRoute,
} from '@banshee/shared';
import { useEffect, useReducer, useState, type SubmitEvent } from 'react';
import {
  INITIAL_STATE,
  reduceCore,
  type ConfirmRequest,
  type CoreEvent,
  type CoreState,
  type TurnView,
} from './core-state.ts';

const LEVEL_TEXT: Record<ActionLevel, string> = {
  green: '🟢 безпечна дія',
  yellow: '🟡 з підтвердженням',
  red: '🔴 небезпечна дія',
};

const ROUTE_TEXT: Record<TurnRoute, string> = {
  routine: '⚡ без ШІ',
  llm: 'Haiku',
  escalation: 'Sonnet',
  code: 'Claude Code',
  none: '',
};

function useCore(): [CoreState, (event: CoreEvent) => void] {
  const [state, dispatch] = useReducer(reduceCore, INITIAL_STATE);
  useEffect(() => {
    const offMessage = window.banshee.onMessage((data) => {
      const parsed = parseCoreMessage(data);
      if (parsed.ok) dispatch({ type: 'message', message: parsed.message });
    });
    const offConnect = window.banshee.onConnect(() => {
      dispatch({ type: 'connect' });
      window.banshee.send({
        type: 'hello',
        version: PROTOCOL_VERSION,
        appVersion: __APP_VERSION__,
      });
    });
    return () => {
      offMessage();
      offConnect();
    };
  }, []);
  // Атрибути кореня читає перевірка програми (main/self-check.ts).
  useEffect(() => {
    const data = document.documentElement.dataset;
    data['core'] = state.connection;
    data['readyCount'] = String(state.readyCount);
    data['turns'] = String(state.turns.filter((turn) => turn.done).length);
  }, [state.connection, state.readyCount, state.turns]);
  return [state, dispatch];
}

function CommandForm(props: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    props.onSend(value);
    setText('');
  };
  return (
    <form className="command" onSubmit={submit}>
      <label htmlFor="command" className="visually-hidden">
        Команда
      </label>
      <input
        id="command"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        placeholder="Наприклад: котра година"
        autoComplete="off"
        autoFocus
      />
      <button type="submit" disabled={props.disabled || !text.trim()}>
        Виконати
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          window.banshee.send({ type: 'stop' });
        }}
      >
        Стоп
      </button>
    </form>
  );
}

function ConfirmCard({ request }: { request: ConfirmRequest }) {
  const [armed, setArmed] = useState(request.armDelaySec === 0);
  useEffect(() => {
    if (armed) return;
    const timer = setTimeout(() => {
      setArmed(true);
    }, request.armDelaySec * 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [armed, request.armDelaySec]);
  const answer = (approved: boolean) => {
    window.banshee.send({
      type: 'confirm.reply',
      requestId: request.requestId,
      approved,
      method: 'click',
    });
  };
  return (
    <div className={`confirm level-${request.level}`} role="alertdialog" aria-label="Підтвердження">
      <p className="level">{LEVEL_TEXT[request.level]}</p>
      <p>{request.summary}</p>
      {request.command ? <pre>{request.command}</pre> : null}
      {request.consequence ? <p className="muted">{request.consequence}</p> : null}
      <div className="buttons">
        <button
          type="button"
          disabled={!armed}
          onClick={() => {
            answer(true);
          }}
        >
          {request.level === 'red' ? 'Виконати' : 'Так'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            answer(false);
          }}
        >
          {request.level === 'red' ? 'Скасувати' : 'Ні'}
        </button>
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: TurnView }) {
  const route = turn.done ? ROUTE_TEXT[turn.done.route] : '';
  return (
    <li className="turn">
      {turn.text ? <p className="said">{turn.text}</p> : null}
      {turn.say ? <p className="reply">{turn.say}</p> : null}
      {turn.actions.map((action) => (
        <p key={action.actionId} className={`action level-${action.level}`}>
          <span>{LEVEL_TEXT[action.level]}</span> {action.summary}
          {action.status === 'failed' ? ' — не вийшло' : ''}
        </p>
      ))}
      {route ? <p className="muted">{route}</p> : null}
    </li>
  );
}

export function App() {
  const [state, dispatch] = useCore();
  const ready = state.connection === 'ready';
  const send = (text: string) => {
    const id = ulid();
    dispatch({ type: 'sent', id, text });
    window.banshee.send({ type: 'command', id, text, source: 'text' });
  };
  return (
    <div className="page">
      <header className="bar">
        <h1>Banshee</h1>
        <span className={`chip ${ready ? 'ok' : 'wait'}`} role="status">
          {ready ? 'Ядро готове' : 'Ядро підключається…'}
        </span>
        {state.aiState ? <span className="chip">{AI_STATE_TEXT[state.aiState].label}</span> : null}
      </header>
      <main>
        <CommandForm disabled={!ready} onSend={send} />
        {state.confirmations.map((request) => (
          <ConfirmCard key={request.requestId} request={request} />
        ))}
        <section aria-live="polite" aria-label="Відповіді">
          <ol className="turns">
            {[...state.turns].reverse().map((turn) => (
              <Turn key={turn.id} turn={turn} />
            ))}
          </ol>
        </section>
        {state.notices.map((notice, index) => (
          <p key={index} className="notice" role="alert">
            {notice}
          </p>
        ))}
      </main>
    </div>
  );
}
