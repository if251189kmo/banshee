// Картка «Голос» (.claude/logic/10-settings.md, «Голос»; 02-voice.md, «Реалізація — етап 2»): стан
// голосу, моделі голосу в теці models\ — скільки бракує й «Завантажити моделі голосу» з перебігом,
// модель слова «Banshee» і профіль голосу власника.
import { useCallback, useEffect, useState } from 'react';
import { uiToWindow } from '../../shared/ui.ts';
import { MyVoice } from './MyVoice.tsx';

interface ModelsInfo {
  readonly missingFiles: number;
  readonly missingBytes: number;
  readonly totalBytes: number;
  readonly folder: string;
  readonly download: {
    readonly state: 'running' | 'done' | 'failed';
    readonly error?: string;
  } | null;
  readonly voice: { readonly wakeModel: 'own' | 'base' | 'none'; readonly profile: boolean } | null;
}

const STATE_TEXT: Record<string, string> = {
  off: 'Вимкнено: мікрофон закритий. Увімкни «Голосові команди» нижче.',
  loading: 'Завантажую моделі голосу…',
  idle: 'Слухаю слово «Banshee».',
  listening: 'Слухаю команду.',
  recognizing: 'Розпізнаю.',
  busy: 'Виконую команду.',
  followUp: 'Слухаю продовження.',
  paused: 'Мікрофон на паузі (Ctrl+Shift+M).',
  failed: 'Голос не працює.',
};

const WAKE_TEXT = {
  own: 'власна модель, навчена на твоїх вимовах',
  base: 'базова модель',
  none: 'моделі немає — працює кнопка мікрофона в оверлеї',
} as const;

const megabytes = (bytes: number): string => `${String(Math.round(bytes / 1_048_576))} МБ`;

export function VoiceCard() {
  const [info, setInfo] = useState<ModelsInfo | null>(null);
  const [voice, setVoice] = useState<{ state: string; problem: string | null }>({
    state: 'off',
    problem: null,
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.banshee.invoke('voiceModels').then(
      (result) => {
        setInfo(result as ModelsInfo);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    refresh();
    return window.banshee.onUi((data) => {
      const parsed = uiToWindow.safeParse(data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'voice') {
        setVoice({ state: message.state, problem: message.problem });
        if (message.state === 'idle' || message.state === 'failed') refresh();
      } else if (message.type === 'voice.download') {
        setProgress({ done: message.done, total: message.total });
        setError(message.state === 'failed' ? (message.error ?? 'Не вийшло') : null);
        if (message.state !== 'running') {
          setProgress(null);
          refresh();
        }
      }
    });
  }, [refresh]);

  const downloading = progress !== null || info?.download?.state === 'running';
  return (
    <section className="card voice-card" aria-labelledby="voice-card-title">
      <h2 id="voice-card-title">Голос</h2>
      <p role="status">
        {STATE_TEXT[voice.state] ?? voice.state}
        {voice.state === 'failed' && voice.problem ? ` ${voice.problem}.` : ''}
      </p>
      {info ? (
        <>
          {info.missingFiles === 0 ? (
            <p>Моделі голосу на місці: {megabytes(info.totalBytes)}.</p>
          ) : (
            <>
              <p>
                Бракує моделей голосу: {String(info.missingFiles)} файлів,{' '}
                {megabytes(info.missingBytes)}. Розпізнавання й озвучка працюють лише на цьому ПК —
                моделі потрібні один раз.
              </p>
              <div className="buttons">
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => {
                    setError(null);
                    setProgress({ done: 0, total: info.totalBytes });
                    window.banshee.ui({ type: 'voice.download' });
                  }}
                >
                  {downloading ? 'Завантажую…' : 'Завантажити моделі голосу'}
                </button>
              </div>
            </>
          )}
          {progress ? (
            <div className="meter">
              <span>Моделі</span>
              <progress
                max={progress.total}
                value={progress.done}
                aria-label={`Завантажено ${megabytes(progress.done)} з ${megabytes(progress.total)}`}
              />
              <span>
                {megabytes(progress.done)} з {megabytes(progress.total)}
              </span>
            </div>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}. Спробуй ще раз: завантаження продовжиться з того місця, де зупинилось.
            </p>
          ) : null}
          {info.voice ? (
            <ul className="facts-list">
              <li>Слово «Banshee»: {WAKE_TEXT[info.voice.wakeModel]}.</li>
            </ul>
          ) : null}
          <MyVoice
            ready={!['off', 'loading', 'failed'].includes(voice.state)}
            recorded={info.voice?.profile === true}
          />
          <p className="muted small">
            Тека моделей: <code>{info.folder}</code>
          </p>
        </>
      ) : null}
    </section>
  );
}
