// Оверлей (.claude/logic/09-ui.md, «Оверлей»): рядок команди з кружком стану, відповідь стрімом,
// картки дій і підтверджень. Ховається через 8 с бездіяльності, якщо курсор не в ньому; Esc —
// одразу. Висоту вікна головний процес підганяє під вміст.
import { AI_STATE_TEXT, isBasicMode, type CoreMessage } from '@banshee/shared';
import { StrictMode, useEffect, useRef, useState, type SubmitEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { uiToWindow } from '../shared/ui.ts';
import { ConfirmCard } from './components/ConfirmCard.tsx';
import { BasicModeAction, TurnCard } from './components/TurnCard.tsx';
import { core, noteCommand, onCoreMessage, sendCommand, useCoreState } from './core-client.ts';
import './styles.css';

/** Ховається після стількох мілісекунд без дій, якщо курсор не над оверлеєм. */
const IDLE_HIDE_MS = 8000;
/** Хід, старший за це, у щойно показаному оверлеї не показуємо. */
const STALE_TURN_MS = 60_000;

if (location.hash === '#mica') document.documentElement.classList.add('mica');

function hide(reason: 'idle' | 'user'): void {
  window.banshee.ui({ type: 'overlay.hide', reason });
}

function Overlay() {
  const state = useCoreState();
  const [text, setText] = useState('');
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [showCost, setShowCost] = useState(false);
  const [voice, setVoice] = useState<VoiceView>({ state: 'off', problem: null });
  /** Відповідь «так» / «ні» на картку голосом — що почув Banshee. */
  const [heard, setHeard] = useState<string | null>(null);
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
      if (!parsed.success) return;
      const command = parsed.data;
      if (command.type === 'overlay.shown') {
        setShownAt(Date.now());
        touch();
        input.current?.focus();
        input.current?.select();
      } else if (command.type === 'voice') {
        setVoice({ state: command.state, problem: command.problem });
        if (command.state === 'listening') {
          setShownAt(Date.now());
          setHeard(null);
          touch();
        }
      } else if (command.type === 'voice.heard') {
        touch();
        if (command.turnId) noteCommand(command.turnId, command.text);
        else setHeard(command.text);
      }
    });
    // Вікно знову видно — це теж дія: інакше таймер, що «спав», поки оверлей був прихований,
    // сховав би його одразу після показу.
    const onVisible = () => {
      if (document.visibilityState === 'visible') touch();
    };
    document.addEventListener('visibilitychange', onVisible);
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
      document.removeEventListener('visibilitychange', onVisible);
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
      if (Date.now() - lastActivity.current > IDLE_HIDE_MS) hide('idle');
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [pending, busy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      touch();
      if (event.key === 'Escape' && !pending) hide('user');
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
  const listening = voice.state === 'listening' || voice.state === 'followUp';
  const indicator =
    state.connection !== 'ready'
      ? 'offline'
      : voice.state === 'listening' || voice.state === 'recognizing'
        ? voice.state
        : busy
          ? (latest?.state ?? 'thinking')
          : 'idle';
  const micReady = voice.state !== 'off' && voice.state !== 'failed' && voice.state !== 'loading';

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
        <button
          type="button"
          className="icon mic"
          disabled={!micReady}
          aria-pressed={listening}
          title={MIC_TITLE[voice.state] ?? voice.problem ?? ''}
          onClick={() => {
            window.banshee.ui({ type: 'voice.listen' });
            touch();
          }}
        >
          🎙
        </button>
      </form>
      {heard ? <p className="heard">Почуто: «{heard}»</p> : null}
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

interface VoiceView {
  readonly state: string;
  readonly problem: string | null;
}

const MIC_TITLE: Record<string, string> = {
  off: 'Голосові команди вимкнено — Налаштування → Голос',
  loading: 'Голос завантажується…',
  idle: 'Сказати команду без слова «Banshee»',
  listening: 'Слухаю…',
  recognizing: 'Розпізнаю…',
  busy: 'Сказати нову команду',
  followUp: 'Слухаю продовження…',
  paused: 'Мікрофон на паузі — натисни, щоб сказати команду',
};

const STATUS_LABEL: Record<string, string> = {
  offline: 'Ядро не підключено',
  listening: 'Слухаю',
  recognizing: 'Розпізнаю',
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
