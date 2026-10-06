// «Мій голос» (.claude/logic/02-voice.md, «Розпізнавання власника за голосом»; 10-settings.md, «Голос»):
// 5 фраз по ~5 с звичайним мікрофоном. Профіль рахує процес voice; аудіо не зберігається — лише числа,
// і лише на цьому ПК. Поки триває запис, команди не слухаються.
import { useEffect, useState } from 'react';
import { uiToWindow } from '../../shared/ui.ts';

/** Фрази для читання: звичайна мова, без слова «Banshee» — щоб запис нічого не запустив. */
export const ENROLL_PHRASES = [
  'Відкрий мені телеграм і зроби гучність на тридцять відсотків.',
  'Яка сьогодні погода і що в мене заплановано на вечір?',
  'Знайди документи, які я змінював учора, і поклади їх у теку звіти.',
  'Постав музику на паузу, а потім перемкни на наступний трек.',
  'Нагадай мені через двадцять хвилин подзвонити мамі.',
] as const;

type Step = 'idle' | 'ready' | 'recording' | 'done' | 'saved';

export function MyVoice({ ready, recorded }: { ready: boolean; recorded: boolean }) {
  const [step, setStep] = useState<Step>('idle');
  const [phrases, setPhrases] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(
    () =>
      window.banshee.onUi((data) => {
        const parsed = uiToWindow.safeParse(data);
        if (!parsed.success || parsed.data.type !== 'voice.enrollment') return;
        const event = parsed.data;
        setPhrases(event.phrases);
        if (event.state === 'phrase') {
          setNote(event.ok === true ? null : (event.error ?? 'Не вийшло — ще раз'));
          setStep(event.phrases >= ENROLL_PHRASES.length ? 'done' : 'ready');
        } else if (event.state === 'saved') {
          setNote(null);
          setStep('saved');
        } else if (event.state === 'failed') setNote(event.error ?? 'Не вийшло');
        else if (event.state === 'cancelled') setStep('idle');
      }),
    [],
  );

  const enroll = (action: 'start' | 'stop' | 'finish' | 'cancel') => {
    window.banshee.ui({ type: 'voice.enroll', action });
  };

  if (!ready)
    return (
      <p className="muted small">
        Мій голос: щоб записати, увімкни «Голосові команди» й дочекайся, поки голос завантажиться.
      </p>
    );

  if (step === 'idle' || step === 'saved')
    return (
      <div className="my-voice">
        <p>
          Мій голос:{' '}
          {step === 'saved' || recorded
            ? 'записано — команди чужим голосом не виконуються.'
            : 'не записано — команди не перевіряються за голосом.'}
        </p>
        <div className="buttons">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setPhrases(0);
              setNote(null);
              setStep('ready');
            }}
          >
            {step === 'saved' || recorded ? 'Записати голос заново' : 'Записати мій голос'}
          </button>
        </div>
      </div>
    );

  const index = Math.min(phrases, ENROLL_PHRASES.length - 1);
  return (
    <div className="my-voice" aria-live="polite">
      {step === 'done' ? (
        <p>
          Усі {String(ENROLL_PHRASES.length)} фраз записано. Збережи профіль — аудіо не
          зберігається.
        </p>
      ) : (
        <>
          <p className="muted small">
            Фраза {String(index + 1)} з {String(ENROLL_PHRASES.length)} — прочитай уголос звичайним
            голосом:
          </p>
          <blockquote className="phrase">{ENROLL_PHRASES[index]}</blockquote>
        </>
      )}
      {note ? (
        <p className="error" role="alert">
          {note}
        </p>
      ) : null}
      <div className="buttons">
        {step === 'ready' ? (
          <button
            type="button"
            onClick={() => {
              setNote(null);
              setStep('recording');
              enroll('start');
            }}
          >
            Почати
          </button>
        ) : null}
        {step === 'recording' ? (
          <button
            type="button"
            className="danger"
            onClick={() => {
              enroll('stop');
            }}
          >
            ● Готово
          </button>
        ) : null}
        {step === 'done' || (step === 'ready' && phrases >= 3) ? (
          <button
            type="button"
            onClick={() => {
              enroll('finish');
            }}
          >
            Зберегти профіль
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            enroll('cancel');
            setStep('idle');
          }}
        >
          Скасувати
        </button>
      </div>
    </div>
  );
}
