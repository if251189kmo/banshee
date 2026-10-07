// Вікно звуку (.claude/logic/02-voice.md, «Правила»: ехоподавлення): приховане вікно тримає мікрофон
// (getUserMedia з ехоподавленням, шумоприглушенням, 16 кГц) і грає озвучку — в одному renderer, тож
// Chromium прибирає власний голос Banshee з мікрофона. Звук іде портом просто в процес voice,
// кроками по 80 мс; керування мікрофоном — від головного процесу. Мікрофон і динаміки — типові
// Windows або обрані за назвою; яким пристроєм відкрито мікрофон і що з ним, бачить головний процес.
import type { AudioToVoice, VoiceToAudio } from '@banshee/shared';
import { deviceNames, plainName, resolveDevice } from './audio-devices.ts';

interface AudioControl {
  /** Відкрити мікрофон: голос увімкнено й не на паузі. */
  readonly capture: boolean;
  /** Пристрій запису й озвучки: «default» — як у Windows, інакше назва пристрою. */
  readonly microphone: string;
  readonly speakers: string;
}

interface Capture {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  /** З яким налаштуванням відкрито: інше — відкрити наново. */
  readonly microphone: string;
  /** Назва пристрою, який дав Chromium. */
  readonly label: string;
  /** Обраного пристрою не було — відкрито типовий Windows. */
  readonly fallback: boolean;
}

let port: MessagePort | null = null;
let control: AudioControl = { capture: false, microphone: 'default', speakers: 'default' };
let capture: Capture | null = null;
let starting = false;
const playback = new AudioContext();
let playEnd = 0;
const playing = new Map<string, AudioBufferSourceNode>();
/** Потік обірвався (пристрій від'єднано) — відкрити мікрофон наново за стільки мс. */
const REOPEN_MS = 1000;

function send(message: AudioToVoice): void {
  port?.postMessage(message);
}

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Пристрої звуку для вибору в налаштуваннях: назви й типові Windows. */
async function reportDevices(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = deviceNames(devices, 'audioinput');
  const outputs = deviceNames(devices, 'audiooutput');
  send({
    type: 'devices',
    inputs: inputs.names,
    outputs: outputs.names,
    defaultInput: inputs.defaultName,
    defaultOutput: outputs.defaultName,
  });
}

async function startCapture(): Promise<void> {
  if (capture || starting) return;
  starting = true;
  const microphone = control.microphone;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const chosen = resolveDevice(microphone, devices, 'audioinput');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(chosen.deviceId === null ? {} : { deviceId: { exact: chosen.deviceId } }),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const context = new AudioContext({ sampleRate: 16_000 });
    // Контекст без жесту користувача може стартувати призупиненим — тоді кроків звуку немає зовсім.
    if (context.state !== 'running') await context.resume().catch(() => undefined);
    context.addEventListener('statechange', () => {
      if (context.state === 'suspended' && capture?.context === context)
        void context.resume().catch(() => undefined);
    });
    await context.audioWorklet.addModule('capture-worklet.js');
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'banshee-capture');
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      send({ type: 'audio', samples: event.data });
    };
    source.connect(node);
    // Вузол має бути в графі до виходу, інакше Chromium його не викликає; гучність — нуль.
    const mute = context.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(context.destination);
    const track = stream.getAudioTracks()[0];
    const label = plainName(track?.label ?? '', await navigator.mediaDevices.enumerateDevices(), 'audioinput');
    const opened: Capture = { stream, context, microphone, label, fallback: chosen.fallback };
    capture = opened;
    track?.addEventListener('ended', () => {
      if (capture !== opened) return;
      send({ type: 'capture', event: 'ended', label });
      stopCapture();
      setTimeout(() => {
        void apply();
      }, REOPEN_MS);
    });
    track?.addEventListener('mute', () => {
      if (capture === opened) send({ type: 'capture', event: 'muted', label });
    });
    track?.addEventListener('unmute', () => {
      if (capture === opened) send({ type: 'capture', event: 'unmuted', label });
    });
    send({
      type: 'capture',
      event: 'opened',
      label,
      ...(chosen.fallback ? { fallback: true } : {}),
    });
    void reportDevices();
  } catch (error) {
    send({ type: 'capture', event: 'failed', error: errorText(error).slice(0, 500) });
  } finally {
    starting = false;
  }
  // Поки мікрофон відкривався, керування змінилося: закрити або відкрити інший пристрій.
  if (capture && (!control.capture || capture.microphone !== control.microphone)) {
    stopCapture();
    if (control.capture) void startCapture();
  }
}

/** Мікрофон закривається повністю: гарнітура виходить з режиму дзвінка, музика звучить як звичайно. */
function stopCapture(): void {
  if (!capture) return;
  for (const track of capture.stream.getTracks()) track.stop();
  void capture.context.close();
  capture = null;
}

async function applySpeakers(): Promise<void> {
  // Динаміки: AudioContext.setSinkId є в Chromium, але ще не в типах DOM.
  const devices = await navigator.mediaDevices.enumerateDevices();
  const chosen = resolveDevice(control.speakers, devices, 'audiooutput');
  const output = playback as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  await output.setSinkId?.(chosen.deviceId ?? '').catch(() => undefined);
}

async function apply(): Promise<void> {
  await applySpeakers().catch(() => undefined);
  if (!control.capture) {
    stopCapture();
    return;
  }
  if (capture && capture.microphone !== control.microphone) stopCapture();
  await startCapture();
}

function play(message: Extract<VoiceToAudio, { type: 'play' }>): void {
  const buffer = playback.createBuffer(1, message.samples.length, message.sampleRate);
  buffer.copyToChannel(new Float32Array(message.samples), 0);
  const node = playback.createBufferSource();
  node.buffer = buffer;
  node.connect(playback.destination);
  const at = Math.max(playback.currentTime + 0.02, playEnd);
  node.start(at);
  playEnd = at + buffer.duration;
  playing.set(message.id, node);
  node.onended = () => {
    playing.delete(message.id);
    send({ type: 'played', id: message.id });
  };
  if (playback.state === 'suspended') void playback.resume();
}

function silence(): void {
  for (const [id, node] of playing) {
    node.onended = null;
    node.stop();
    send({ type: 'played', id });
  }
  playing.clear();
  playEnd = 0;
}

function onVoice(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const message = data as VoiceToAudio;
  if (message.type === 'play' && message.samples instanceof Float32Array) play(message);
  else if (message.type === 'silence') silence();
}

// Порт до процесу voice — від preload через window.postMessage: так MessagePort доходить до
// сторінки з contextIsolation.
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data as { type?: unknown } | null;
  if (event.source !== window || data?.type !== 'banshee-audio-port') return;
  const [next] = event.ports;
  if (!next) return;
  port?.close();
  port = next;
  next.onmessage = (message: MessageEvent<unknown>) => {
    onVoice(message.data);
  };
  // Новий процес voice: який мікрофон відкрито й які є пристрої.
  if (capture)
    send({
      type: 'capture',
      event: 'opened',
      label: capture.label,
      ...(capture.fallback ? { fallback: true } : {}),
    });
  void reportDevices();
});

window.bansheeAudio.onControl((value) => {
  control = value as AudioControl;
  void apply();
});
// Слухачі порту й керування вже є: головний процес може слати (і шле наново після перезавантаження).
window.bansheeAudio.ready();

/**
 * Пристрої змінилися (гарнітура, Bluetooth): новий список — у налаштування. Мікрофон відкривається
 * наново, лише коли це щось змінює: змінився типовий Windows, з'явився обраний пристрій.
 */
navigator.mediaDevices.addEventListener('devicechange', () => {
  void (async () => {
    await reportDevices();
    const current = capture;
    if (!current) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const reopen =
      current.microphone === 'default'
        ? deviceNames(devices, 'audioinput').defaultName !== current.label
        : current.fallback && !resolveDevice(current.microphone, devices, 'audioinput').fallback;
    if (!reopen || capture !== current) return;
    stopCapture();
    await startCapture();
  })();
});
