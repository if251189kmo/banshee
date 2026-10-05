// «Журнал» (.claude/logic/09-ui.md, «Центр керування»): усі дії з фільтрами рівня й стану,
// «Скасувати» для дій, які можна скасувати: файли, налаштування.
import type {
  ActionLevel,
  ActionSource,
  ActionStatus,
  ConfirmMethod,
  JournalItem,
} from '@banshee/shared';
import { useCallback, useEffect, useState } from 'react';
import { LEVEL_LABEL } from '../components/TurnCard.tsx';
import { core, useCoreState } from '../core-client.ts';
import { dateTime } from '../format.ts';

const PAGE = 50;

const SOURCE_LABEL: Record<ActionSource, string> = {
  voice: 'голос',
  text: 'текст',
  routine: 'рутина',
  code: 'Claude Code',
  ui: 'інтерфейс',
  sync: 'синхронізація',
};

const CONFIRM_LABEL: Record<ConfirmMethod, string> = {
  auto: 'без питання',
  voice: 'голосом',
  click: 'кліком',
  key: 'клавішею',
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  done: 'виконано',
  failed: 'помилка',
  denied: 'відхилено',
  cancelled: 'скасовано',
};

export function Journal() {
  const { readyCount, turns } = useCoreState();
  const [items, setItems] = useState<JournalItem[]>([]);
  const [more, setMore] = useState(false);
  const [level, setLevel] = useState<ActionLevel | ''>('');
  const [status, setStatus] = useState<ActionStatus | ''>('');
  const [message, setMessage] = useState<string | null>(null);
  const finished = turns.filter((turn) => turn.done).length;

  const load = useCallback(
    (before?: number) => {
      core
        .journal({
          limit: PAGE,
          ...(before === undefined ? {} : { before }),
          ...(level ? { level } : {}),
          ...(status ? { status } : {}),
        })
        .then(
          (page) => {
            setItems((current) =>
              before === undefined ? [...page.items] : [...current, ...page.items],
            );
            setMore(page.more);
          },
          () => undefined,
        );
    },
    [level, status],
  );

  useEffect(() => {
    load();
  }, [load, readyCount, finished]);

  return (
    <div className="journal">
      <div className="filters">
        <label>
          Рівень{' '}
          <select
            value={level}
            onChange={(event) => {
              setLevel(event.target.value as ActionLevel | '');
            }}
          >
            <option value="">усі</option>
            <option value="green">🟢 безпечні</option>
            <option value="yellow">🟡 зміни</option>
            <option value="red">🔴 небезпечні</option>
          </select>
        </label>
        <label>
          Стан{' '}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ActionStatus | '');
            }}
          >
            <option value="">усі</option>
            {(Object.keys(STATUS_LABEL) as ActionStatus[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {items.length === 0 ? (
        <p className="muted">Дій ще не було.</p>
      ) : (
        <table className="journal-table">
          <thead>
            <tr>
              <th scope="col">Коли</th>
              <th scope="col">Рівень</th>
              <th scope="col">Дія</th>
              <th scope="col">Звідки</th>
              <th scope="col">Підтвердження</th>
              <th scope="col">Стан</th>
              <th scope="col">
                <span className="visually-hidden">Скасувати</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{dateTime(item.at)}</td>
                <td>{LEVEL_LABEL[item.level]}</td>
                <td>{item.summary}</td>
                <td>{SOURCE_LABEL[item.source]}</td>
                <td>{item.confirmedBy ? CONFIRM_LABEL[item.confirmedBy] : '—'}</td>
                <td>{item.undone ? 'скасовано пізніше' : STATUS_LABEL[item.status]}</td>
                <td>
                  {item.undoable ? (
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => {
                        core.undo(item.id).then(
                          (phrase) => {
                            setMessage(phrase);
                            load();
                          },
                          (error: unknown) => {
                            setMessage(error instanceof Error ? error.message : String(error));
                          },
                        );
                      }}
                    >
                      Скасувати
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more ? (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            load(items.at(-1)?.id);
          }}
        >
          Показати ще
        </button>
      ) : null}
    </div>
  );
}
