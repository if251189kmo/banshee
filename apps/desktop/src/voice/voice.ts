// Процес voice в utilityProcess (.claude/logic/02-voice.md, «Реалізація — етап 2»): чекає `voice.init`
// від головного процесу, вантажить моделі й з'єднує порти — до core (клієнт протоколу core ↔ desktop)
// і до вікна звуку. Перевірка програми обходиться без мікрофона й динаміків.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CHUNK,
  MissingModels,
  SAMPLE_RATE,
  encodeWav,
  frequentPhrases,
  resample,
  startVoice,
  type StartedVoice,
} from '@banshee/voice';
import {
  FAKE_MIC_FILE,
  PROTOCOL_VERSION,
  isAudioToVoice,
  parseControlToVoice,
  parseCoreMessage,
  type ControlFromVoice,
  type VoiceInit,
  type VoiceToAudio,
} from '@banshee/shared';
import type { MessagePortMain } from 'electron';

const startedAt = performance.now();
let voice: StartedVoice | null = null;
let corePort: MessagePortMain | null = null;
let audioPort: MessagePortMain | null = null;
let appVersion = '';

const post = (message: ControlFromVoice): void => {
  process.parentPort.postMessage(message);
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function connectCore(port: MessagePortMain): void {
  corePort?.close();
  corePort = port;
  port.on('message', (event) => {
    const parsed = parseCoreMessage(event.data);
    if (parsed.ok) voice?.service.core(parsed.message);
  });
  port.start();
  voice?.service.connected(appVersion, PROTOCOL_VERSION);
}

function connectAudio(port: MessagePortMain): void {
  audioPort?.close();
  audioPort = port;
  port.on('message', (event) => {
    if (isAudioToVoice(event.data)) voice?.service.audio(event.data);
  });
  port.start();
}

/**
 * Перевірка програми: без мікрофона й динаміків. Banshee каже собі «Котра година?» голосом
 * озвучки, слухає це через кнопку мікрофона, core відповідає без ШІ, озвучка лише рахується.
 */
async function selfTest(started: StartedVoice): Promise<void> {
  const spoken = await started.synthesize('Котра година?');
  const samples = spoken ? resample(spoken.samples, spoken.sampleRate, SAMPLE_RATE) : null;
  if (!samples) {
    post({ type: 'voice.selfTest', heard: null, sttMs: null, played: 0, enrolled: false });
    return;
  }
  started.service.listenNow();
  const silence = new Float32Array(CHUNK);
  for (let offset = 0; offset < samples.length + 20 * CHUNK; offset += CHUNK) {
    const part = offset + CHUNK <= samples.length ? samples.slice(offset, offset + CHUNK) : silence;
    started.service.audio({ type: 'audio', samples: part });
  }
  await started.service.settled();
  // Хід core й озвучка відповіді: до 20 с.
  const until = performance.now() + 20_000;
  while (
    performance.now() < until &&
    (started.service.state === 'busy' || started.service.speaking)
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  const enrolled = await selfEnroll(started);
  await writeFakeMicrophone(started);
  post({ type: 'voice.selfTest', heard: selfHeard, sttMs: null, played: selfPlayed, enrolled });
}

/**
 * WAV для підставного мікрофона Chromium (`--use-file-for-fake-audio-capture`): далі перевірка
 * програми слухає справжнє вікно звуку, а справжній мікрофон власника не відкривається.
 */
async function writeFakeMicrophone(started: StartedVoice): Promise<void> {
  const spoken = await started.synthesize("Перевіряю мікрофон: один, два, три, чотири, п'ять.");
  if (!spoken || !dataDir) return;
  const samples = resample(spoken.samples, spoken.sampleRate, SAMPLE_RATE);
  const withPause = new Float32Array(samples.length + SAMPLE_RATE);
  withPause.set(samples);
  await writeFile(join(dataDir, FAKE_MIC_FILE), encodeWav(withPause, SAMPLE_RATE));
}

/** «Мій голос» трьома фразами озвучки: запис, відбитки, збереження профілю в теці перевірки. */
async function selfEnroll(started: StartedVoice): Promise<boolean> {
  const phrases = [
    'Перевіряю запис голосу для профілю власника.',
    'Друга фраза: команди чужим голосом не виконуються.',
    'Третя фраза: аудіо не зберігається, лише числа.',
  ];
  for (const phrase of phrases) {
    const spoken = await started.synthesize(phrase);
    if (!spoken) return false;
    const samples = resample(spoken.samples, spoken.sampleRate, SAMPLE_RATE);
    started.service.enroll('start');
    for (let offset = 0; offset + CHUNK <= samples.length; offset += CHUNK)
      started.service.audio({ type: 'audio', samples: samples.slice(offset, offset + CHUNK) });
    started.service.enroll('stop');
  }
  started.service.enroll('finish');
  const until = performance.now() + 5000;
  while (performance.now() < until && !started.service.hasProfile)
    await new Promise((resolve) => setTimeout(resolve, 50));
  return started.service.hasProfile;
}

let selfHeard: string | null = null;
let selfPlayed = 0;
let dataDir: string | null = null;

async function init(message: VoiceInit, ports: MessagePortMain[]): Promise<void> {
  appVersion = message.appVersion;
  dataDir = message.dataDir;
  const [core, audio] = ports;
  // Перевірка програми: озвучка не звучить уголос, лише рахується.
  const testing = message.selfTest !== undefined;
  const toAudio = (outgoing: VoiceToAudio): void => {
    if (!testing) {
      audioPort?.postMessage(outgoing);
      return;
    }
    if (outgoing.type === 'play') {
      selfPlayed += 1;
      queueMicrotask(() => voice?.service.audio({ type: 'played', id: outgoing.id }));
    }
  };
  try {
    voice = await startVoice({
      modelsDir: message.modelsDir,
      espeakDir: message.espeakDir,
      dataDir: message.dataDir,
      logsDir: message.logsDir,
      toCore: (outgoing) => {
        corePort?.postMessage(outgoing);
      },
      toAudio,
      toMain: (outgoing) => {
        if (outgoing.type === 'voice.heard') selfHeard = outgoing.text;
        post(outgoing);
      },
    });
  } catch (error) {
    post({
      type: 'voice.failed',
      error: errorText(error),
      missing: error instanceof MissingModels ? error.missing : [],
    });
    return;
  }
  if (core) connectCore(core);
  if (audio) connectAudio(audio);
  const ms = Math.round(performance.now() - startedAt);
  voice.log.info('voice.start', { ms, wakeModel: voice.wakeModel, profile: voice.profile });
  post({ type: 'voice.started', ms, profile: voice.profile, wakeModel: voice.wakeModel });
  if (message.selfTest === 'full') {
    await selfTest(voice);
    return;
  }
  // live: звук іде лише з вікна звуку (підставний мікрофон), готові фрази не потрібні.
  if (testing) return;
  // Часті фрази — у простої, один раз: далі вони збережені в data\voice\phrases.
  const started = voice;
  void started.service.warmPhrases(frequentPhrases()).then(
    (made) => {
      if (made > 0) started.log.info('voice.phrases', { made });
    },
    (error: unknown) => {
      started.log.warn('voice.phrases', { error: errorText(error) });
    },
  );
}

process.on('uncaughtException', (error) => {
  voice?.log.error('voice.crash', { error: errorText(error) });
  process.exit(1);
});

process.parentPort.on('message', (event) => {
  const parsed = parseControlToVoice(event.data);
  if (!parsed.ok) return;
  const message = parsed.message;
  const [port] = event.ports;
  switch (message.type) {
    case 'voice.init':
      void init(message, event.ports);
      return;
    case 'voice.port':
      if (!port) return;
      if (message.to === 'core') connectCore(port);
      else connectAudio(port);
      return;
    case 'voice.pause':
      voice?.service.pause(message.paused);
      return;
    case 'voice.listen':
      voice?.service.listenNow();
      return;
    case 'voice.hush':
      voice?.service.hush();
      return;
    case 'voice.enroll':
      voice?.service.enroll(message.action);
      return;
    case 'voice.pc':
      voice?.service.pcState({ inCall: message.inCall, active: message.active });
      return;
    case 'voice.stop':
      process.exit(0);
  }
});
