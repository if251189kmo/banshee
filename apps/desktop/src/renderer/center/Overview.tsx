// «Огляд» (.claude/logic/09-ui.md, «Центр керування»): стан асистента й ШІ, команди за сьогодні,
// частка без ШІ з міні-графіком за 30 днів, витрати проти ліміту, p50 затримки, синхронізація.
import type { Settings, StatsResult } from '@banshee/shared';
import { useEffect, useState } from 'react';
import { AiStateCard } from '../components/AiStateCard.tsx';
import { ShareLine } from '../components/Charts.tsx';
import { core, useCoreState } from '../core-client.ts';
import { duration, percent, shortDay } from '../format.ts';
import { movingNoAiShare } from './activity-math.ts';

export function Overview() {
  const state = useCoreState();
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [hotkeys, setHotkeys] = useState<Settings['general.hotkeys'] | null>(null);
  const finished = state.turns.filter((turn) => turn.done).length;

  useEffect(() => {
    core.stats(30).then(setStats, () => undefined);
  }, [state.readyCount, finished]);

  useEffect(() => {
    core.settings().then(
      (settings) => {
        setHotkeys(settings['general.hotkeys']);
      },
      () => undefined,
    );
  }, [state.readyCount]);

  const today = stats?.days.at(-1);
  return (
    <div className="grid">
      <section className="card">
        <h2>Banshee</h2>
        <p>
          <span className={`chip ${state.connection === 'ready' ? 'ok' : 'warn'}`}>
            {state.connection === 'ready' ? 'Ядро готове' : 'Ядро підключається…'}
          </span>
        </p>
        {hotkeys ? (
          <p className="muted">
            Оверлей — {hotkeys.overlay}, «стоп» — {hotkeys.stop}.
          </p>
        ) : null}
      </section>
      <AiStateCard />
      <section className="card">
        <h2>Сьогодні</h2>
        <p className="big">{today?.turns ?? 0}</p>
        <p className="muted">
          команд, без ШІ — {today && today.turns > 0 ? percent(today.noAi / today.turns) : '—'};
          помилок — {today?.failed ?? 0}
        </p>
      </section>
      <section className="card wide">
        <h2>Частка без ШІ за 30 днів</h2>
        <p className="muted">
          За 30 днів — {percent(stats?.totals.noAiShare ?? null)}; ціль — 40 % через місяць
          користування.
        </p>
        {stats ? (
          <ShareLine
            labels={stats.days.map((day) => shortDay(day.day))}
            values={movingNoAiShare(stats.days)}
            target={{ value: 0.4, label: 'ціль 40 %' }}
            label="без ШІ, середнє за 7 днів"
          />
        ) : null}
      </section>
      <section className="card">
        <h2>Затримка</h2>
        <p className="big">{duration(stats?.totals.p50Ms ?? null)}</p>
        <p className="muted">p50 за 30 днів; p90 — {duration(stats?.totals.p90Ms ?? null)}</p>
      </section>
      <section className="card">
        <h2>Синхронізація</h2>
        <p className="muted">Не налаштовано: перенесення пам'яті між ПК з'явиться пізніше.</p>
      </section>
    </div>
  );
}
