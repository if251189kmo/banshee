// Майстер першого запуску (.claude/logic/01-architecture.md, «Встановлення й оновлення»): ключ
// Claude або базовий режим, гарячі клавіші. Мікрофон, слово «Banshee» і голос власника додає етап 2,
// перенесення пам'яті — синхронізація. Кожен крок можна пропустити.
import type { Settings } from '@banshee/shared';
import { useEffect, useState } from 'react';
import { KeyForm } from '../components/AiStateCard.tsx';
import { core } from '../core-client.ts';

const STEPS = ['Вітання', 'Ключ Claude', 'Як кликати'] as const;

export function Wizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [masked, setMasked] = useState<string | null>(null);
  const [hotkeys, setHotkeys] = useState<Settings['general.hotkeys'] | null>(null);

  const refreshKey = () => {
    core.keyStatus().then(
      (status) => {
        setMasked(status.masked);
      },
      () => undefined,
    );
  };

  useEffect(() => {
    refreshKey();
    core.settings().then(
      (settings) => {
        setHotkeys(settings['general.hotkeys']);
      },
      () => undefined,
    );
  }, []);

  const finish = () => {
    void core.setSetting('general.setupDone', true).finally(onDone);
  };

  return (
    <section className="wizard card" aria-labelledby="wizard-title">
      <p className="muted">
        Крок {step + 1} з {STEPS.length}: {STEPS[step]}
      </p>
      {step === 0 ? (
        <>
          <h2 id="wizard-title">Вітаю, я Banshee</h2>
          <p>
            Я виконую команди на цьому ПК: програми, гучність, вікна, файли, PowerShell. Небезпечні
            дії підтверджуєш лише ти — кнопкою чи клавішею.
          </p>
          <p>
            Голос — слово «Banshee», мікрофон і твій голос — з'явиться в наступній версії; зараз —
            текстом в оверлеї.
          </p>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <h2 id="wizard-title">Ключ Claude</h2>
          <p>
            З ключем Claude я розумію довільні прохання. Без нього працює базовий режим: вбудовані
            команди — гучність, медіа, програми, вікна, час — без запитів до API.
          </p>
          <p className="muted">
            Ключ зберігається в Windows Credential Manager і нікуди не потрапляє: ні в журнал, ні в
            пам'ять. Як отримати ключ — кнопка нижче.
          </p>
          <KeyForm masked={masked} onChanged={refreshKey} />
          <button
            type="button"
            className="link"
            onClick={() => {
              window.banshee.ui({ type: 'external.open', link: 'keys' });
            }}
          >
            Відкрити Console → API keys
          </button>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <h2 id="wizard-title">Як мене кликати</h2>
          <ul>
            <li>
              <b>{hotkeys?.overlay ?? 'Ctrl+Shift+B'}</b> — оверлей: напиши команду й натисни Enter.
            </li>
            <li>
              <b>{hotkeys?.stop ?? 'Ctrl+Shift+X'}</b> — «стоп»: скасувати запит і дію.
            </li>
            <li>Значок у треї — центр керування, «Використовувати ШІ», вихід.</li>
          </ul>
          <p className="muted">Клавіші змінюються в Налаштуваннях → Загальні.</p>
        </>
      ) : null}
      <div className="buttons">
        {step > 0 ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setStep(step - 1);
            }}
          >
            Назад
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => {
              setStep(step + 1);
            }}
          >
            {step === 1 && !masked ? 'Пропустити — базовий режим' : 'Далі'}
          </button>
        ) : (
          <button type="button" onClick={finish}>
            Готово
          </button>
        )}
      </div>
    </section>
  );
}
