// Процес voice (.claude/logic/02-voice.md, «Реалізація — етап 2»): звук із вікна звуку → автомат
// станів → команда в core; відповідь core `say` → речення → Piper або збережена фраза → вікно звуку.
// Голосове «так» чи «ні» на картку 🟡; вікно продовження — коли хід завершено й озвучку договорено.
// Від Electron не залежить: порти — функції, тож логіку перевіряють тести з підробними моделями.
import {
  ulid,
  type AudioToVoice,
  type ControlFromVoice,
  type CoreMessage,
  type DesktopMessage,
  type Settings,
  type VoiceState,
  type VoiceToAudio,
} from '@banshee/shared';
import { CHUNK_MS } from './audio.ts';
import {
  DEFAULT_LISTENER,
  Listener,
  type ListenerEvent,
  type ListenerOptions,
  type ListenerState,
} from './listener.ts';
import { splitSentences, type PhraseCache, type TtsVoice } from './phrases.ts';
import { VOICE_THRESHOLDS, WAKE_THRESHOLDS } from './thresholds.ts';

export interface VoiceEngines {
  /** Оцінка слова або null; без моделі слова — завжди null, працює лише кнопка мікрофона. */
  wake(chunk: Float32Array): Promise<number | null>;
  speech(chunk: Float32Array): boolean;
  recognize(samples: Float32Array): Promise<string>;
  embed(samples: Float32Array): Float32Array | null;
  synthesize(text: string, voice: TtsVoice, signal: AbortSignal): Promise<Float32Array | null>;
  readonly sampleRate: number;
}

export interface VoiceLog {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

export interface VoiceServiceDeps {
  readonly engines: VoiceEngines;
  /** Профіль голосу власника; null — ще не записано, команди не перевіряються. */
  readonly profile: Float32Array | null;
  readonly phrases: PhraseCache | null;
  toCore(message: DesktopMessage): void;
  toAudio(message: VoiceToAudio): void;
  toMain(message: ControlFromVoice): void;
  readonly log: VoiceLog;
  now(): number;
}

/** Налаштування голосу з core (10-settings.md, «Голос»). */
type VoiceSettings = Pick<
  Settings,
  | 'voice.wakeSensitivity'
  | 'voice.endPauseSec'
  | 'voice.followUp'
  | 'voice.tts'
  | 'security.voiceFilter'
  | 'security.voiceStrictness'
>;

const DEFAULT_SETTINGS: VoiceSettings = {
  'voice.wakeSensitivity': 'medium',
  'voice.endPauseSec': 0.5,
  'voice.followUp': { enabled: true, seconds: 5 },
  'voice.tts': { voice: 'tetiana', speed: 1 },
  'security.voiceFilter': true,
  'security.voiceStrictness': 'medium',
};

export function listenerOptions(settings: VoiceSettings, profile: boolean): ListenerOptions {
  return {
    ...DEFAULT_LISTENER,
    wakeThreshold: WAKE_THRESHOLDS[settings['voice.wakeSensitivity']],
    endPauseMs: Math.round(settings['voice.endPauseSec'] * 1000),
    followUpMs: settings['voice.followUp'].enabled
      ? settings['voice.followUp'].seconds * 1000
      : null,
    voiceThreshold:
      settings['security.voiceFilter'] && profile
        ? VOICE_THRESHOLDS[settings['security.voiceStrictness']]
        : null,
  };
}

const YES = /^(так|ага|угу|давай|роби|підтверджую|згоден|згодна|окей|ок|yes)(?:\s|$)/u;
const NO = /^(ні|не треба|не роби|скасуй|відміна|стоп)(?:\s|$)/u;

/** «Так, закривай» → true, «ні» → false, інше — null: це нова команда, а не відповідь. */
export function yesNo(text: string): boolean | null {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (YES.test(words)) return true;
  if (NO.test(words)) return false;
  return null;
}

/** Скільки кроків звуку може чекати в черзі: далі — пропуск, щоб Banshee не відставав від мови. */
const MAX_BACKLOG = 50;

export class VoiceService {
  private readonly deps: VoiceServiceDeps;
  private readonly listener: Listener;
  private settings: VoiceSettings = DEFAULT_SETTINGS;
  private settingsRequest: string | null = null;
  private paused = false;
  private backlog = 0;
  private chain: Promise<void> = Promise.resolve();
  private dropped = 0;
  /** Хід, який почала голосова команда: на нього — озвучка й вікно продовження. */
  private turnId: string | null = null;
  private turnDone = false;
  private confirm: { readonly requestId: string; listening: boolean } | null = null;
  private queue: string[] = [];
  private synthesizing = false;
  private readonly outstanding = new Set<string>();
  private abort = new AbortController();
  private published: { state: VoiceState; speaking: boolean } | null = null;
  /** Для журналу роботи й N1: коли закінчилась мова команди й коли прозвучав перший звук. */
  private speechEndAt: number | null = null;
  private firstSound = false;

  constructor(deps: VoiceServiceDeps) {
    this.deps = deps;
    const { engines } = deps;
    this.listener = new Listener(
      {
        wake: (chunk) => engines.wake(chunk),
        speech: (chunk) => engines.speech(chunk),
        recognize: (samples) => engines.recognize(samples),
        embed: (samples) => engines.embed(samples),
        profile: () => deps.profile,
        now: () => deps.now(),
      },
      listenerOptions(this.settings, deps.profile !== null),
      (event) => {
        this.onListener(event);
      },
    );
  }

  get state(): VoiceState {
    return this.paused ? 'paused' : this.listener.current;
  }

  get speaking(): boolean {
    return this.synthesizing || this.queue.length > 0 || this.outstanding.size > 0;
  }

  /** Новий порт до core: привітатися й узяти налаштування. */
  connected(appVersion: string, protocolVersion: number): void {
    this.deps.toCore({ type: 'hello', version: protocolVersion, appVersion });
    this.settingsRequest = ulid();
    this.deps.toCore({ type: 'settings.get', id: this.settingsRequest });
    this.publish();
  }

  audio(message: AudioToVoice): void {
    switch (message.type) {
      case 'audio': {
        if (this.paused) return;
        if (this.backlog >= MAX_BACKLOG) {
          this.dropped += 1;
          if (this.dropped === 1) this.deps.log.warn('voice.backlog', { chunks: this.backlog });
          return;
        }
        this.backlog += 1;
        const samples = message.samples;
        this.chain = this.chain
          .then(() => this.listener.push(samples))
          .catch((error: unknown) => {
            this.deps.log.warn('voice.push', { error: String(error) });
          })
          .finally(() => {
            this.backlog -= 1;
          });
        return;
      }
      case 'played':
        if (this.outstanding.delete(message.id)) {
          this.publish();
          this.afterSpeech();
        }
        return;
      case 'capture':
        this.deps.toMain({
          type: 'voice.capture',
          ok: message.ok,
          ...(message.error === undefined ? {} : { error: message.error }),
        });
        return;
    }
  }

  core(message: CoreMessage): void {
    switch (message.type) {
      case 'reply':
        if (message.id === this.settingsRequest && message.ok) {
          this.settingsRequest = null;
          this.apply(message.result as Settings);
        }
        return;
      case 'settings.changed':
        if (message.key in this.settings)
          this.apply({ ...this.settings, [message.key]: message.value });
        return;
      case 'say':
        if (message.turnId === this.turnId && message.speak && message.speech)
          this.speak(message.speech);
        return;
      case 'turn.done':
        if (message.turnId === this.turnId) {
          this.turnDone = true;
          this.afterSpeech();
        }
        return;
      case 'confirm.request':
        if (message.turnId === this.turnId && message.methods.includes('voice'))
          this.confirm = { requestId: message.requestId, listening: false };
        return;
      case 'confirm.closed':
        if (this.confirm?.requestId === message.requestId) this.confirm = null;
        return;
      default:
        return;
    }
  }

  /** Пауза мікрофона: забути команду, не слухати; озвучка договорюється. */
  pause(paused: boolean): void {
    this.paused = paused;
    this.listener.reset();
    this.publish();
  }

  /** Кнопка мікрофона в оверлеї. */
  listenNow(): void {
    if (this.paused) return;
    this.silence();
    this.listener.listenNow();
  }

  /** Гаряча клавіша «стоп»: замовкнути й забути команду; хід скасовує core. */
  hush(): void {
    this.silence();
    this.listener.reset();
    this.turnId = null;
  }

  /** Для перевірки програми: дочекатися обробки звуку й розпізнавання. */
  async settled(): Promise<void> {
    await this.chain;
    await this.listener.settled();
  }

  private apply(settings: VoiceSettings): void {
    this.settings = {
      'voice.wakeSensitivity': settings['voice.wakeSensitivity'],
      'voice.endPauseSec': settings['voice.endPauseSec'],
      'voice.followUp': settings['voice.followUp'],
      'voice.tts': settings['voice.tts'],
      'security.voiceFilter': settings['security.voiceFilter'],
      'security.voiceStrictness': settings['security.voiceStrictness'],
    };
    this.listener.configure(listenerOptions(this.settings, this.deps.profile !== null));
  }

  private onListener(event: ListenerEvent): void {
    switch (event.type) {
      case 'state':
        this.publish();
        return;
      case 'wake':
        this.deps.log.info('voice.wake', { score: Number(event.score.toFixed(3)) });
        return;
      case 'bargeIn':
        this.silence();
        return;
      case 'command': {
        const owner = event.voice?.owner ?? null;
        this.deps.log.info('voice.command', {
          sttMs: Math.round(event.timing.recognizedAt - event.timing.decidedAt),
          afterSpeechMs: Math.round(event.timing.recognizedAt - event.timing.speechEndAt),
          speculative: event.timing.speculative,
          ...(event.voice ? { voiceScore: Number(event.voice.score.toFixed(3)), owner } : {}),
        });
        const pending = this.confirm;
        const answer = pending && owner !== false ? yesNo(event.text) : null;
        if (pending && answer !== null) {
          this.deps.toMain({ type: 'voice.heard', text: event.text, owner });
          this.confirm = null;
          this.deps.toCore({
            type: 'confirm.reply',
            requestId: pending.requestId,
            approved: answer,
            method: 'voice',
          });
          return;
        }
        this.speechEndAt = event.timing.speechEndAt;
        this.firstSound = false;
        this.turnId = ulid();
        this.turnDone = false;
        this.deps.toMain({ type: 'voice.heard', turnId: this.turnId, text: event.text, owner });
        this.deps.toCore({
          type: 'command',
          id: this.turnId,
          text: event.text,
          source: 'voice',
          ...(event.voice ? { voice: event.voice } : {}),
        });
        return;
      }
    }
  }

  private speak(text: string): void {
    this.queue.push(...splitSentences(text));
    this.publish();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.synthesizing) return;
    this.synthesizing = true;
    try {
      for (
        let sentence = this.queue.shift();
        sentence !== undefined;
        sentence = this.queue.shift()
      ) {
        const signal = this.abort.signal;
        const voice = {
          id: this.settings['voice.tts'].voice,
          speed: this.settings['voice.tts'].speed,
        };
        let samples = (await this.deps.phrases?.get(sentence, voice)) ?? null;
        if (!samples) {
          samples = await this.deps.engines.synthesize(sentence, voice, signal);
          if (samples && this.deps.phrases)
            void this.deps.phrases.put(sentence, voice, samples).catch((error: unknown) => {
              this.deps.log.warn('voice.phrase', { error: String(error) });
            });
        }
        if (!samples || signal.aborted) continue;
        const id = ulid();
        this.outstanding.add(id);
        if (!this.firstSound && this.speechEndAt !== null) {
          this.firstSound = true;
          this.deps.log.info('voice.firstSound', {
            afterSpeechMs: Math.round(this.deps.now() - this.speechEndAt),
          });
        }
        this.deps.toAudio({
          type: 'play',
          id,
          samples: samples.slice(),
          sampleRate: this.deps.engines.sampleRate,
        });
      }
    } finally {
      this.synthesizing = false;
      this.publish();
      this.afterSpeech();
    }
  }

  /** Озвучку договорено: питання підтвердження — слухати відповідь; хід завершено — вікно продовження. */
  private afterSpeech(): void {
    if (this.speaking) return;
    if (this.confirm && !this.confirm.listening) {
      this.confirm.listening = true;
      this.listener.listenNow();
      return;
    }
    if (this.turnDone && this.listener.current === 'busy') {
      this.turnDone = false;
      this.listener.answered();
    }
  }

  private silence(): void {
    const wasSpeaking = this.speaking;
    this.queue = [];
    this.abort.abort();
    this.abort = new AbortController();
    this.outstanding.clear();
    if (wasSpeaking) this.deps.toAudio({ type: 'silence' });
    this.publish();
  }

  private publish(): void {
    const next = { state: this.state, speaking: this.speaking };
    if (this.published?.state === next.state && this.published.speaking === next.speaking) return;
    this.published = next;
    this.deps.toMain({ type: 'voice.state', ...next });
  }
}

/** Час звуку для логів перевірки: скільки кроків за секунду. */
export const CHUNKS_PER_SECOND = 1000 / CHUNK_MS;
export type { ListenerState };
