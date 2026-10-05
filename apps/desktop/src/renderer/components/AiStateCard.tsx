// Картка «Стан ШІ» (.claude/logic/10-settings.md, «Мозок і витрати»; 03-brain.md): стан і причина,
// модель і ключ «••••1234», витрати проти лімітів, оцінка кредитів, останній запит; «Перевірити
// з'єднання», «Як підключити», «Відкрити Console». Ключ — тут і в майстрі (12-api.md, «Ключ»).
import { AI_STATE_TEXT, isBasicMode, type AiDetails, type KeyCheck } from '@banshee/shared';
import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { core, useCoreState } from '../core-client.ts';
import { dateTime, until, usd } from '../format.ts';
import { BasicModeAction } from './TurnCard.tsx';

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div className="meter">
      <span>{label}</span>
      <progress max={1} value={share} aria-label={`${label}: ${usd(used)} з ${usd(limit)}`} />
      <span>
        {usd(used)} з {usd(limit)}
      </span>
    </div>
  );
}

/** Вставити й перевірити ключ; видалити — з підтвердженням кліком. */
export function KeyForm({ masked, onChanged }: { masked: string | null; onChanged: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeyCheck | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = value;
    // Ключ не лишається в стані сторінки довше, ніж потрібно для відправки.
    setValue('');
    if (!key.trim()) return;
    setBusy(true);
    core
      .setKey(key)
      .then(
        (check) => {
          setResult(check);
          if (check.ok) onChanged();
        },
        (error: unknown) => {
          setResult({
            ok: false,
            reason: 'core',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="key-form">
      <form onSubmit={submit}>
        <label htmlFor="claude-key">Ключ API Claude{masked ? ` — зараз ${masked}` : ''}</label>
        <div className="row">
          <input
            id="claude-key"
            type="password"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={busy || !value.trim()}>
            {busy ? 'Перевіряю…' : masked ? 'Замінити' : 'Перевірити й зберегти'}
          </button>
        </div>
      </form>
      {result ? (
        <p className={result.ok ? 'ok' : 'error'} role="status">
          {result.ok
            ? `Ключ ${result.masked} перевірено й збережено в Credential Manager.`
            : result.message}
        </p>
      ) : null}
      {masked ? (
        confirmDelete ? (
          <p className="row">
            <span>Видалити ключ {masked}? Banshee перейде в базовий режим.</span>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirmDelete(false);
                void core.deleteKey().then(onChanged);
              }}
            >
              Видалити
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              Скасувати
            </button>
          </p>
        ) : (
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            Видалити ключ
          </button>
        )
      ) : null}
    </div>
  );
}

const HOW_TO = [
  'Увійди в Console (platform.claude.com) — оплата API окрема від підписки Claude.',
  'Billing → Buy credits: $10 (мінімум $5). Auto-reload вимкни.',
  'Spend limits → $20 на місяць — запасна стеля на боці Anthropic.',
  'API keys → Create key «Banshee-<ПК>». Ключ показується один раз — скопіюй одразу.',
  'Встав ключ у поле вище й натисни «Перевірити й зберегти».',
];

export function AiStateCard({ withKey = false }: { withKey?: boolean }) {
  const { aiState } = useCoreState();
  const [details, setDetails] = useState<AiDetails | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [howTo, setHowTo] = useState(false);

  const load = useCallback(() => {
    core.aiDetails().then(setDetails, () => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load, aiState]);

  if (!details) return <section className="card ai-card">Завантажую стан ШІ…</section>;
  const text = AI_STATE_TEXT[details.state];
  const basic = isBasicMode(details.state);
  return (
    <section className="card ai-card" aria-labelledby="ai-card-title">
      <header>
        <h2 id="ai-card-title">Стан ШІ</h2>
        <span className={`chip ${basic ? 'warn' : 'ok'}`}>{text.label}</span>
      </header>
      {basic && text.recovery ? (
        <p>
          Як повернути: {text.recovery}
          {details.until ? ` (${until(details.until)})` : ''}.{' '}
          <BasicModeAction state={details.state} />
        </p>
      ) : null}
      <dl className="facts">
        <dt>Модель</dt>
        <dd>
          {details.model}, складне — {details.complexModel}
        </dd>
        <dt>Ключ</dt>
        <dd>{details.key.masked ?? 'немає'}</dd>
        <dt>Останній запит</dt>
        <dd>{details.lastCallAt ? dateTime(details.lastCallAt) : 'ще не було'}</dd>
        <dt>Кредити (оцінка)</dt>
        <dd>
          {details.creditsLeftUsd === null
            ? 'суму поповнення не введено'
            : `≈ ${usd(details.creditsLeftUsd)}`}
        </dd>
      </dl>
      <Meter
        label="Сьогодні"
        used={details.spentTodayUsd}
        limit={details.limits.dayUsd + details.extraTodayUsd}
      />
      <Meter label="За місяць" used={details.spentMonthUsd} limit={details.limits.monthUsd} />
      <div className="buttons">
        <button
          type="button"
          className="secondary"
          disabled={!details.key.present || checking === '…'}
          onClick={() => {
            setChecking('…');
            core.checkKey().then(
              (check) => {
                setChecking(check.ok ? 'З’єднання є, ключ діє.' : check.message);
                load();
              },
              (error: unknown) => {
                setChecking(error instanceof Error ? error.message : String(error));
              },
            );
          }}
        >
          Перевірити з’єднання
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={howTo}
          onClick={() => {
            setHowTo(!howTo);
          }}
        >
          Як підключити
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            window.banshee.ui({ type: 'external.open', link: 'console' });
          }}
        >
          Відкрити Console
        </button>
      </div>
      {checking && checking !== '…' ? <p role="status">{checking}</p> : null}
      {howTo ? (
        <ol className="how-to">
          {HOW_TO.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {withKey ? <KeyForm masked={details.key.masked} onChanged={load} /> : null}
    </section>
  );
}
