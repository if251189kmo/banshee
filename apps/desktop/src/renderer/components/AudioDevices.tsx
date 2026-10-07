// Мікрофон і динаміки (.claude/logic/10-settings.md, «Голос»; 02-voice.md, «Вибір мікрофона й
// динаміків»): список пристроїв дає вікно звуку, тож він є, коли «Голосові команди» ввімкнено.
// Значення налаштування — назва пристрою або «default» (як у Windows).
import { useEffect, useState } from 'react';
import { uiToWindow, type UiToWindow } from '../../shared/ui.ts';

type Devices = Extract<UiToWindow, { type: 'voice.devices' }>;
type Capture = Extract<UiToWindow, { type: 'voice.capture' }>;

export interface AudioState {
  readonly devices: Devices | null;
  readonly capture: Capture | null;
}

/** Пристрої звуку й мікрофон, який відкрило вікно звуку; оновлюється разом зі змінами. */
export function useAudioDevices(): AudioState {
  const [state, setState] = useState<AudioState>({ devices: null, capture: null });
  useEffect(() => {
    window.banshee.invoke('voiceDevices').then(
      (result) => {
        setState(result as AudioState);
      },
      () => undefined,
    );
    return window.banshee.onUi((data) => {
      const parsed = uiToWindow.safeParse(data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'voice.devices') setState((old) => ({ ...old, devices: message }));
      else if (message.type === 'voice.capture') setState((old) => ({ ...old, capture: message }));
      else if (message.type === 'voice' && (message.state === 'off' || message.state === 'failed'))
        setState((old) => ({ ...old, capture: null }));
    });
  }, []);
  return state;
}

/** Що з мікрофоном — словами для картки «Голос». */
export function captureText(capture: Capture): string {
  const name = capture.label ? `«${capture.label}»` : '';
  switch (capture.event) {
    case 'opened':
    case 'unmuted':
      return capture.fallback === true
        ? `Мікрофон: ${name} — обраного мікрофона немає, тому типовий Windows.`
        : `Мікрофон: ${name}.`;
    case 'muted':
      return `Мікрофон ${name} не дає звуку — перевір пристрій або обери інший нижче.`;
    case 'ended':
      return `Мікрофон ${name} від'єднався — відкриваю наново.`;
    case 'failed':
      return `Мікрофон не відкрився: ${capture.error ?? 'невідома причина'}.`;
  }
}

export function DeviceSelect(props: {
  id: string;
  direction: 'input' | 'output';
  value: unknown;
  onChange: (value: string) => void;
}) {
  const { devices } = useAudioDevices();
  const input = props.direction === 'input';
  const names = devices ? (input ? devices.inputs : devices.outputs) : [];
  const current = devices ? (input ? devices.defaultInput : devices.defaultOutput) : null;
  const selected = typeof props.value === 'string' ? props.value : 'default';
  const missing = selected !== 'default' && !names.includes(selected);
  return (
    <>
      <select
        id={props.id}
        value={selected}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        <option value="default">
          {current ? `Як у Windows — зараз «${current}»` : 'Як у Windows'}
        </option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        {missing ? <option value={selected}>{`${selected} — не під'єднано`}</option> : null}
      </select>
      {devices === null ? (
        <span className="muted small">
          Список пристроїв з'явиться, коли «Голосові команди» ввімкнено.
        </span>
      ) : null}
    </>
  );
}
