// Оверлей (.claude/logic/09-ui.md, «Оверлей»): рядок команди з кружком стану, відповідь стрімом,
// картки дій і підтверджень. Ховається через 8 с бездіяльності, якщо курсор не в ньому; Esc —
// одразу. Висоту вікна головний процес підганяє під вміст.
import { AI_STATE_TEXT, isBasicMode, type CoreMessage } from '@banshee/shared';
import { StrictMode, useEffect, useRef, useState, type SubmitEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { uiToWindow } from '../shared/ui.ts';
import { ConfirmCard } from './components/ConfirmCard.tsx';
import { BasicModeAction, TurnCard } from './components/TurnCard.tsx';
import { core, onCoreMessage, sendCommand, useCoreState } from './core-client.ts';
import './styles.css';

/** Ховається після стількох мілісекунд без дій, якщо курсор не над оверлеєм. */
const IDLE_HIDE_MS = 8000;
/** Хід, старший за це, у щойно показаному оверлеї не показуємо. */
const STALE_TURN_MS = 60_000;

if (location.hash === '#mica') document.documentElement.classList.add('mica');

function hide(): void {
  window.banshee.ui({ type: 'overlay.hide' });
}

function Overlay() {
  const state = useCoreState();
  const [text, setText] = useState('');
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [showCost, setShowCost] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastActivity = useRef(Date.now());
  const hovered = useRef(false);

  const touch = () => {
    lastActivity.current = Date.now();
  };

  useEffect(() => {
    const off = window.banshee.onUi((data) => {
      const parsed = uiToWindow.safeParse(data);
      if (parsed.success && parsed.data.type === 'overlay.shown') {
        setShownAt(Date.now());
        touch();
        input.current?.focus();
        input.current?.select();
      }
    });
    const offCore = onCoreMessage((message: CoreMessage) => {
      touch();
      if (message.type === 'settings.changed' && message.key === 'ai.showTurnCost') {
        setShowCost(message.value === true);
      }
    });
    core.settings().then(
      (settings) => {
        setShowCost(settings['ai.showTurnCost']);
      },
      () => undefined,
    );
    return () => {
      off();
      offCore();
    };
  }, []);

  // Висота вікна — за вмістом.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      window.banshee.ui({ type: 'overlay.resize', height: Math.ceil(element.scrollHeight) });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const busy = state.turns.some((turn) => turn.state !== null && turn.state !== 'done');
  const pending = state.confirmations.length > 0;

  useEffect(() => {
    const timer = setInterval(() => {
      if (hovered.current || pending || busy) return;
      if (Date.now() - lastActivity.current > IDLE_HIDE_MS) hide();
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [pending, busy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      touch();
      if (event.key === 'Escape' && !pending) hide();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [pending]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || state.connection !== 'ready') return;
    sendCommand(value);
    setText('');
    touch();
  };

  const latest = state.turns.at(-1);
  const visible =
    latest &&
    (latest.text === null || Date.now() - shownAt < STALE_TURN_MS || latest.state !== 'done')
      ? latest
      : null;
  const indicator =
    state.connection !== 'ready' ? 'offline' : busy ? (latest?.state ?? 'thinking') : 'idle';

  return (
    <div
      ref={root}
      className="overlay"
      onMouseEnter={() => {
        hovered.current = true;
      }}
      onMouseLeave={() => {
        hovered.current = false;
        touch();
      }}
    >
      <form className="command-row" onSubmit={submit}>
        <span
          className={`status-dot ${indicator}`}
          role="status"
          aria-label={STATUS_LABEL[indicator]}
        />
        <label htmlFor="overlay-command" className="visually-hidden">
          Команда для Banshee
        </label>
        <input
          ref={input}
          id="overlay-command"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            touch();
          }}
          placeholder={state.connection === 'ready' ? 'Що зробити?' : 'Ядро підключається…'}
          autoComplete="off"
          autoFocus
        />
        <button type="button" className="icon" disabled title="Голос — з наступної версії">
          🎙
        </button>
      </form>
      {state.confirmations.map((request, index) => (
        <ConfirmCard key={request.requestId} request={request} active={index === 0} />
      ))}
      {visible ? <TurnCard turn={visible} aiState={state.aiState} showCost={showCost} /> : null}
      {!visible && state.aiState && isBasicMode(state.aiState) ? (
        <p className="marks">
          <span className="mark basic">{AI_STATE_TEXT[state.aiState].label}</span>
          <BasicModeAction state={state.aiState} />
        </p>
      ) : null}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  offline: 'Ядро не підключено',
  idle: 'Готовий',
  thinking: 'Думає',
  acting: 'Виконує',
  speaking: 'Говорить',
  done: 'Готовий',
};

const element = document.getElementById('root');
if (element) {
  createRoot(element).render(
    <StrictMode>
      <Overlay />
    </StrictMode>,
  );
}
