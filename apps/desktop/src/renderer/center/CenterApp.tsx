// Центр керування (.claude/logic/09-ui.md, «Центр керування»): «Огляд», «Активність», «Журнал»,
// «Налаштування» з карткою «Стан ШІ»; майстер першого запуску. Пам'ять, Навички, Синхронізація —
// з етапів 3–4; Довідка й «Про програму» — крок 1.10. Картки підтвердження видно й тут.
import { AI_STATE_TEXT } from '@banshee/shared';
import { useEffect, useState } from 'react';
import { SECTIONS, uiToWindow, type Section } from '../../shared/ui.ts';
import { ConfirmCard } from '../components/ConfirmCard.tsx';
import { useCoreState } from '../core-client.ts';
import { Activity } from './Activity.tsx';
import { Journal } from './Journal.tsx';
import { Overview } from './Overview.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { Wizard } from './Wizard.tsx';

const NAV: readonly { id: Section; title: string }[] = [
  { id: 'overview', title: 'Огляд' },
  { id: 'activity', title: 'Активність' },
  { id: 'journal', title: 'Журнал' },
  { id: 'settings', title: 'Налаштування' },
];

/** `#settings/ai.limits` → розділ і пункт, на який прокрутити. */
function fromHash(hash: string): { section: Section; anchor?: string } {
  const [section, anchor] = hash.replace(/^#/, '').split('/');
  const known = SECTIONS.find((item) => item === section);
  return known ? { section: known, ...(anchor ? { anchor } : {}) } : { section: 'overview' };
}

export function CenterApp() {
  const state = useCoreState();
  const [view, setView] = useState(() => fromHash(location.hash));

  useEffect(
    () =>
      window.banshee.onUi((data) => {
        const parsed = uiToWindow.safeParse(data);
        if (parsed.success && parsed.data.type === 'center.section') {
          setView({
            section: parsed.data.section,
            ...(parsed.data.anchor ? { anchor: parsed.data.anchor } : {}),
          });
        }
      }),
    [],
  );

  // Атрибути кореня читає перевірка програми (main/self-check.ts).
  useEffect(() => {
    const data = document.documentElement.dataset;
    data['core'] = state.connection;
    data['readyCount'] = String(state.readyCount);
    data['turns'] = String(state.turns.filter((turn) => turn.done).length);
  }, [state.connection, state.readyCount, state.turns]);

  useEffect(() => {
    const title = NAV.find((item) => item.id === view.section)?.title ?? 'Майстер';
    document.title = `${title} — Banshee`;
  }, [view.section]);

  const ready = state.connection === 'ready';
  return (
    <div className="center">
      <header className="bar">
        <h1>Banshee</h1>
        <span className={`chip ${ready ? 'ok' : 'warn'}`} role="status">
          {ready ? 'Ядро готове' : 'Ядро підключається…'}
        </span>
        {state.aiState ? <span className="chip">{AI_STATE_TEXT[state.aiState].label}</span> : null}
      </header>
      {view.section === 'wizard' ? null : (
        <nav className="nav" aria-label="Розділи центру керування">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === view.section ? 'current' : 'secondary'}
              aria-current={item.id === view.section ? 'page' : undefined}
              onClick={() => {
                setView({ section: item.id });
              }}
            >
              {item.title}
            </button>
          ))}
        </nav>
      )}
      <main>
        {state.confirmations.map((request, index) => (
          <ConfirmCard key={request.requestId} request={request} active={index === 0} />
        ))}
        {state.notices.map((notice, index) => (
          <p key={index} className="notice" role="alert">
            {notice}
          </p>
        ))}
        {view.section === 'overview' ? <Overview /> : null}
        {view.section === 'activity' ? <Activity /> : null}
        {view.section === 'journal' ? <Journal /> : null}
        {view.section === 'settings' ? <SettingsPage anchor={view.anchor} /> : null}
        {view.section === 'wizard' ? (
          <Wizard
            onDone={() => {
              setView({ section: 'overview' });
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
