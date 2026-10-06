// Вікно звуку (.claude/logic/02-voice.md, «Правила»: ехоподавлення): приховане вікно тримає мікрофон
// (getUserMedia з ехоподавленням, шумоприглушенням, 16 кГц) і грає озвучку — в одному renderer, тож
// Chromium прибирає власний голос Banshee з мікрофона. Звук іде портом просто в процес voice,
// кроками по 80 мс; керування мікрофоном — від головного процесу.
import type { AudioToVoice, VoiceToAudio } from '@banshee/shared';

interface AudioControl {
  /** Відкрити мікрофон: голос увімкнено й не на паузі. */
  readonly capture: boolean;
  /** Пристрій запису й озвучки; «default» — як у Windows. */
  readonly microphone: string;
  readonly speakers: string;
}

interface Capture {
  readonly stream: MediaStream;
  readonly context: AudioContext;
}

let port: MessagePort | null = null;
let control: AudioControl = { capture: false, microphone: 'default', speakers: 'default' };
let capture: Capture | null = null;
let starting = false;
const playback = new AudioContext();
let playEnd = 0;
const playing = new Map<string, AudioBufferSourceNode>();

function send(message: AudioToVoice): void {
  port?.postMessage(message);
}

async function startCapture(): Promise<void> {
  if (capture || starting) return;
  starting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(control.microphone === 'default' ? {} : { deviceId: { exact: control.microphone } }),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const context = new AudioContext({ sampleRate: 16_000 });
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
    capture = { stream, context };
    if (!control.capture) stopCapture();
    else send({ type: 'capture', ok: true });
  } catch (error) {
    send({
      type: 'capture',
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  } finally {
    starting = false;
  }
}

/** Мікрофон закривається повністю: гарнітура виходить з режиму дзвінка, музика звучить як звичайно. */
function stopCapture(): void {
  if (!capture) return;
  for (const track of capture.stream.getTracks()) track.stop();
  void capture.context.close();
  capture = null;
}

async function apply(): Promise<void> {
  // Динаміки: AudioContext.setSinkId є в Chromium, але ще не в типах DOM.
  const sink = control.speakers === 'default' ? '' : control.speakers;
  const output = playback as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  await output.setSinkId?.(sink).catch(() => undefined);
  if (control.capture) await startCapture();
  else stopCapture();
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
  if (capture) send({ type: 'capture', ok: true });
});

window.bansheeAudio.onControl((value) => {
  control = value as AudioControl;
  void apply();
});

// Новий типовий мікрофон Windows (гарнітура, Bluetooth) — без перезапуску Banshee.
navigator.mediaDevices.addEventListener('devicechange', () => {
  if (!capture || control.microphone !== 'default') return;
  stopCapture();
  void startCapture();
});
