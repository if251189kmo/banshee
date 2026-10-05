// Картка підтвердження (.claude/logic/09-ui.md, «Картки підтвердження»; 05-safety.md).
// 🟡 — одне речення, «Так (Enter)» і «Ні (Esc)», кільце відліку; голосове «так» приймає core.
// 🔴 — точна команда моноширинним шрифтом і наслідок, «Виконати (Ctrl+Enter)» активна через 1 с,
// «Скасувати (Esc)», 60 с на рішення; голосом — ні.
import { useEffect, useRef, useState } from 'react';
import { send } from '../core-client.ts';
import type { ConfirmRequest } from '../core-state.ts';

const LEVEL_TITLE = { green: '🟢 Безпечна дія', yellow: '🟡 Зміна', red: '🔴 Небезпечна дія' };

/** Чи не набирає власник щось у полі вводу: тоді Enter належить полю, а не картці. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type !== 'checkbox' && target.value !== '';
}

export function ConfirmCard({ request, active }: { request: ConfirmRequest; active: boolean }) {
  const [armed, setArmed] = useState(request.armDelaySec === 0);
  const [left, setLeft] = useState(request.timeoutSec);
  const answered = useRef(false);
  const red = request.level === 'red';

  useEffect(() => {
    if (armed) return;
    const timer = setTimeout(() => {
      setArmed(true);
    }, request.armDelaySec * 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [armed, request.armDelaySec]);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      setLeft(Math.max(0, request.timeoutSec - (Date.now() - started) / 1000));
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [request.timeoutSec]);

  const answer = (approved: boolean, method: 'click' | 'key') => {
    if (answered.current) return;
    answered.current = true;
    send({ type: 'confirm.reply', requestId: request.requestId, approved, method });
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        answer(false, 'key');
      } else if (event.key === 'Enter') {
        if (red) {
          if (!event.ctrlKey) return;
          event.preventDefault();
          if (armed) answer(true, 'key');
        } else if (!event.ctrlKey && !typing(event.target)) {
          event.preventDefault();
          answer(true, 'key');
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  });

  const share = request.timeoutSec > 0 ? left / request.timeoutSec : 0;
  return (
    <section
      className={`confirm level-${request.level}`}
      role="alertdialog"
      aria-labelledby={`confirm-${request.requestId}`}
    >
      <header>
        <svg className="countdown" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" className="track" />
          <circle
            cx="18"
            cy="18"
            r="15"
            className="left"
            strokeDasharray={`${String(Math.round(share * 94.2))} 94.2`}
          />
        </svg>
        <h2 id={`confirm-${request.requestId}`}>{LEVEL_TITLE[request.level]}</h2>
        <span className="muted">{Math.ceil(left)} с</span>
      </header>
      <p>{request.summary}</p>
      {request.command ? <pre className="exact">{request.command}</pre> : null}
      {request.consequence ? <p className="consequence">{request.consequence}</p> : null}
      {request.tainted ? (
        <p className="muted">У розмові є чужий вміст — тому питаю навіть про безпечну дію.</p>
      ) : null}
      {red ? <p className="muted">Голосом не підтверджується — лише кнопкою чи клавішею.</p> : null}
      <div className="buttons">
        <button
          type="button"
          disabled={!armed}
          onClick={() => {
            answer(true, 'click');
          }}
        >
          {red ? 'Виконати (Ctrl+Enter)' : 'Так (Enter)'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            answer(false, 'click');
          }}
        >
          {red ? 'Скасувати (Esc)' : 'Ні (Esc)'}
        </button>
      </div>
    </section>
  );
}
