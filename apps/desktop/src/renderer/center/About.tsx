// «Про програму» (.claude/logic/09-ui.md, «Центр керування»; 01-architecture.md, «Системні вимоги»,
// «Діагностика»): версія Banshee, Windows, тека Banshee, системні вимоги поруч з даними цього ПК,
// «Зібрати діагностику».
import { useEffect, useState } from 'react';
import { requirements, type AboutInfo } from '../../shared/requirements.ts';

const FIT_LABEL = { ok: '✓ так', weak: '⚠ слабше за мінімум', unknown: '—' } as const;

export function About() {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erase, setErase] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [eraseError, setEraseError] = useState<string | null>(null);

  useEffect(() => {
    window.banshee.invoke('about').then(
      (result) => {
        setInfo(result as AboutInfo);
      },
      () => undefined,
    );
  }, []);

  if (!info) return <p>Збираю дані…</p>;
  return (
    <div className="about">
      <section className="card">
        <h2>Banshee {info.version}</h2>
        <dl className="facts">
          <dt>Windows</dt>
          <dd>
            {info.windows.name}, збірка {info.windows.build}
          </dd>
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Тека Banshee</dt>
          <dd>
            <code>{info.root}</code>{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                window.banshee.ui({ type: 'folder.open' });
              }}
            >
              Відкрити в Провіднику
            </button>
          </dd>
        </dl>
        <p className="muted">
          Програма, пам&apos;ять, моделі й журнали — у цій теці. Поза нею — лише ярлики, запис для
          видалення, автозапуск і ключ Claude в Credential Manager.
        </p>
      </section>
      <section className="card">
        <h2>Системні вимоги</h2>
        <table>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Мінімальні</th>
              <th scope="col">Рекомендовані</th>
              <th scope="col">Цей ПК</th>
              <th scope="col">Відповідає</th>
            </tr>
          </thead>
          <tbody>
            {requirements(info).map((row) => (
              <tr key={row.item}>
                <th scope="row">{row.item}</th>
                <td>{row.minimum}</td>
                <td>{row.recommended}</td>
                <td>{row.here ?? '—'}</td>
                <td className={row.fit === 'weak' ? 'error' : undefined}>{FIT_LABEL[row.fit]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Слабший ПК — попередження, а не заборона: Banshee працюватиме повільніше.
        </p>
      </section>
      <section className="card">
        <h2>Діагностика</h2>
        <p>
          ZIP з журналами роботи й версіями Banshee, Windows і Electron — щоб розібратися, якщо щось
          не так. Пам&apos;яті, налаштувань, тексту команд і ключів у ньому немає.
        </p>
        <div className="buttons">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              window.banshee
                .invoke('diagnostics')
                .then(
                  (file) => {
                    setDiagnostics(String(file));
                  },
                  (error: unknown) => {
                    setDiagnostics(error instanceof Error ? `Не вийшло: ${error.message}` : null);
                  },
                )
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {busy ? 'Збираю…' : 'Зібрати діагностику'}
          </button>
          {diagnostics ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                window.banshee.ui({ type: 'diagnostics.show' });
              }}
            >
              Показати в теці
            </button>
          ) : null}
        </div>
        {diagnostics ? (
          <p role="status" className="small">
            {diagnostics}
          </p>
        ) : null}
      </section>
      <section className="card">
        <h2>Видалити всі дані</h2>
        <p>
          Пам&apos;ять, налаштування, моделі й журнали — у Кошик, ключ Claude — з Credential
          Manager, програма — з ПК. Звичайне видалення в «Програмах та компонентах» лишає дані для
          перевстановлення.
        </p>
        {erase === 'confirm' ? (
          <div className="inline-confirm" role="alertdialog" aria-label="Підтвердження видалення">
            <p>
              Видалити Banshee разом з усіма даними? Скасувати це не можна, крім відновлення з
              Кошика.
            </p>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setErase('busy');
                window.banshee.invoke('erase').then(
                  () => undefined,
                  (error: unknown) => {
                    setErase('idle');
                    setEraseError(
                      error instanceof Error
                        ? error.message.replace(
                            /^Error invoking remote method '[^']+': (Error: )?/,
                            '',
                          )
                        : 'Не вийшло',
                    );
                  },
                );
              }}
            >
              Так, видалити все
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setErase('idle');
              }}
            >
              Скасувати
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="danger"
            disabled={erase === 'busy'}
            onClick={() => {
              setErase('confirm');
            }}
          >
            {erase === 'busy' ? 'Видаляю…' : 'Видалити всі дані'}
          </button>
        )}
        {eraseError ? (
          <p className="error" role="alert">
            {eraseError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
