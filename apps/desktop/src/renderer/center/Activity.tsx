// «Активність» (.claude/logic/09-ui.md, «Активність»; вимога F10): як Banshee використовується й
// наскільки добре вчиться. Період, графіки з таблицями, порівняння з попереднім періодом, списки.
// Дані — з тих самих таблиць, що й журнал, тож числа збігаються.
import {
  STATS_PERIODS,
  type PeriodTotals,
  type StatsPeriod,
  type StatsResult,
} from '@banshee/shared';
import { useEffect, useState } from 'react';
import { ChartCard, ShareLine, StackedBars } from '../components/Charts.tsx';
import { core, useCoreState } from '../core-client.ts';
import { change, duration, percent, shortDay, usd } from '../format.ts';
import { monthToDate, movingNoAiShare, successShare } from './activity-math.ts';

const PERIOD_LABEL: Record<StatsPeriod, string> = {
  7: '7 днів',
  30: '30 днів',
  90: '90 днів',
  365: 'рік',
};

interface Row {
  readonly label: string;
  readonly now: string;
  readonly before: string;
  readonly delta: string;
  /** Чи зростання — це добре: стрілка вгору зелена, донизу — ні. */
  readonly better: 'up' | 'down' | null;
  readonly direction: number;
}

function comparison(totals: PeriodTotals, previous: PeriodTotals): Row[] {
  const row = (
    label: string,
    now: number | null,
    before: number | null,
    show: (value: number | null) => string,
    better: 'up' | 'down' | null,
    asShare = false,
  ): Row => ({
    label,
    now: show(now),
    before: show(before),
    delta: change(now, before, asShare),
    better,
    direction: now === null || before === null ? 0 : Math.sign(now - before),
  });
  const count = (value: number | null) => (value === null ? '—' : String(value));
  return [
    row('Команд', totals.turns, previous.turns, count, null),
    row('Частка без ШІ', totals.noAiShare, previous.noAiShare, percent, 'up', true),
    row(
      '$ на команду',
      totals.costPerTurnUsd,
      previous.costPerTurnUsd,
      (v) => (v === null ? '—' : usd(v)),
      'down',
    ),
    row('Успішних', totals.successShare, previous.successShare, percent, 'up', true),
    row('Виправлень', totals.corrected, previous.corrected, count, 'down'),
    row('p50 затримки', totals.p50Ms, previous.p50Ms, duration, 'down'),
  ];
}

function arrow(row: Row): string {
  if (row.direction === 0) return '';
  const good = row.better === null ? null : row.direction > 0 === (row.better === 'up');
  return `${row.direction > 0 ? '↑' : '↓'}${good === null ? '' : good ? ' краще' : ' гірше'}`;
}

export function Activity() {
  const { readyCount, turns } = useCoreState();
  const [period, setPeriod] = useState<StatsPeriod>(30);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [limits, setLimits] = useState({ dayUsd: 1, monthUsd: 20 });
  const finished = turns.filter((turn) => turn.done).length;

  useEffect(() => {
    core.stats(period).then(setStats, () => undefined);
  }, [period, readyCount, finished]);

  useEffect(() => {
    core.settings().then(
      (settings) => {
        setLimits(settings['ai.limits']);
      },
      () => undefined,
    );
  }, [readyCount]);

  const labels = stats?.days.map((day) => shortDay(day.day)) ?? [];
  const days = stats?.days ?? [];
  const table = (headers: string[], cells: (index: number) => string[]) => ({
    headers,
    rows: days.map((day, index) => [shortDay(day.day), ...cells(index)]),
  });
  const moving = movingNoAiShare(days);
  const quality = successShare(days);
  return (
    <div className="activity">
      <div className="period" role="radiogroup" aria-label="Період">
        {STATS_PERIODS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === period}
            className={value === period ? 'current' : 'secondary'}
            onClick={() => {
              setPeriod(value);
            }}
          >
            {PERIOD_LABEL[value]}
          </button>
        ))}
      </div>
      {stats ? (
        <>
          <ChartCard
            title="Команди за днями"
            table={table(
              ['День', 'Без ШІ', 'З ШІ', 'Ескалації', 'Відмови без ШІ', 'Помилки'],
              (i) => [
                String(days[i]?.noAi ?? 0),
                String(days[i]?.ai ?? 0),
                String(days[i]?.escalated ?? 0),
                String(days[i]?.refused ?? 0),
                String(days[i]?.failed ?? 0),
              ],
            )}
          >
            <StackedBars
              labels={labels}
              series={[
                { label: 'без ШІ', values: days.map((day) => day.noAi), className: 'series-a' },
                {
                  label: 'з ШІ',
                  values: days.map((day) => day.ai),
                  className: 'series-b',
                  hatched: true,
                },
              ]}
              format={(value) => String(Math.round(value))}
            />
          </ChartCard>
          <ChartCard
            title="Частка без ШІ"
            table={table(['День', 'Без ШІ, середнє за 7 днів'], (i) => [
              percent(moving[i] ?? null),
            ])}
          >
            <ShareLine
              labels={labels}
              values={moving}
              target={{ value: 0.4, label: 'ціль 40 %' }}
              label="без ШІ, середнє за 7 днів"
            />
          </ChartCard>
          <ChartCard
            title={`Витрати API — за місяць ${usd(monthToDate(days))} з ${usd(limits.monthUsd)}`}
            table={table(['День', 'Витрати'], (i) => [usd(days[i]?.costUsd ?? 0)])}
          >
            <StackedBars
              labels={labels}
              series={[
                { label: 'витрати', values: days.map((day) => day.costUsd), className: 'series-b' },
              ]}
              limit={{ value: limits.dayUsd, label: `денний ліміт ${usd(limits.dayUsd)}` }}
              format={usd}
            />
          </ChartCard>
          <ChartCard
            title={`Якість — p50 ${duration(stats.totals.p50Ms)}, p90 ${duration(stats.totals.p90Ms)}`}
            table={table(['День', 'Успішних', 'Виправлень'], (i) => [
              percent(quality[i] ?? null),
              String(days[i]?.corrected ?? 0),
            ])}
          >
            <ShareLine labels={labels} values={quality} label="успішних ходів" />
          </ChartCard>
          <section className="card">
            <h3>Навчання</h3>
            <p className="muted">
              Нові рутини, назви й правила, заощаджені виклики ШІ — з'являться разом із
              самонавчанням.
            </p>
          </section>
          <section className="card">
            <h3>Порівняння з попереднім періодом</h3>
            <table>
              <thead>
                <tr>
                  <th scope="col">Показник</th>
                  <th scope="col">{PERIOD_LABEL[period]}</th>
                  <th scope="col">Попередні {PERIOD_LABEL[period]}</th>
                  <th scope="col">Зміна</th>
                </tr>
              </thead>
              <tbody>
                {comparison(stats.totals, stats.previous).map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.now}</td>
                    <td>{row.before}</td>
                    <td>
                      {row.delta} {arrow(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h3>Що найчастіше йде через ШІ</h3>
            {stats.topAi.length === 0 ? (
              <p className="muted">Поки нічого.</p>
            ) : (
              <ol>
                {stats.topAi.map((item) => (
                  <li key={item.text}>
                    {item.text} — {item.count}
                  </li>
                ))}
              </ol>
            )}
            <p className="muted small">«Зробити рутиною» з'явиться разом із рутинами власника.</p>
          </section>
          <section className="card">
            <h3>Найкорисніші рутини</h3>
            {stats.topRoutines.length === 0 ? (
              <p className="muted">Поки нічого.</p>
            ) : (
              <ol>
                {stats.topRoutines.map((item) => (
                  <li key={item.template}>
                    {item.template} — {item.uses}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : (
        <p>Рахую…</p>
      )}
    </div>
  );
}
