// Голос у головному процесі (.claude/logic/02-voice.md, «Реалізація — етап 2»): процес voice під
// наглядом, приховане вікно звуку, порти voice ↔ core і voice ↔ вікно звуку, пауза мікрофона.
// Мікрофон відкривається, лише коли «Голосові команди» ввімкнено, моделі завантажено й пауза знята.
import {
  parseControlFromVoice,
  type ControlFromVoice,
  type ControlToVoice,
  type VoiceState,
} from '@banshee/shared';
import type { Log } from '@banshee/shared/log';
import {
  MessageChannelMain,
  utilityProcess,
  type BrowserWindow,
  type MessagePortMain,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import { Supervisor, type ChildHandle, type SupervisorState } from './supervisor.ts';

/** off — голос вимкнено; failed — не стартував (немає моделей) або падав тричі за хвилину. */
export type VoiceHostState = VoiceState | 'off' | 'failed';

export interface AudioDevices {
  readonly microphone: string;
  readonly speakers: string;
}

export interface VoiceHostDeps {
  /** Зібраний вхід процесу voice (src/voice/voice.ts). */
  readonly script: string;
  readonly appVersion: string;
  readonly modelsDir: string;
  readonly espeakDir: string;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly log: Log;
  /**
   * Перевірка програми: без справжнього мікрофона й динаміків. Перший процес voice проганяє
   * самоперевірку (`full`); вікно звуку з підставним мікрофоном Chromium — після `attachAudio()`, і
   * наступні процеси voice слухають лише його (`live`).
   */
  readonly selfTest: boolean;
  /** Порт до core як ще одного клієнта; false — core ще не працює. */
  readonly attachCore: (port: MessagePortMain) => boolean;
  /** Приховане вікно звуку; null — у перевірці програми. */
  readonly createAudioWindow: () => BrowserWindow | null;
  readonly onState: (state: VoiceHostState, speaking: boolean) => void;
  readonly onMessage: (message: ControlFromVoice) => void;
}

export class VoiceHost {
  private readonly deps: VoiceHostDeps;
  private readonly supervisor: Supervisor;
  private child: UtilityProcess | null = null;
  private audio: BrowserWindow | null = null;
  /** Сторінка вікна звуку сказала, що слухає порт і керування. */
  private audioReady = false;
  private enabled = false;
  private paused = false;
  private devices: AudioDevices = { microphone: 'default', speakers: 'default' };
  private current: VoiceHostState = 'off';
  private speaking = false;
  private failure: string | null = null;
  private pc: { inCall: boolean; active: boolean } = { inCall: false, active: true };
  /** Перевірка програми: самоперевірку процесу voice вже пройдено, далі — вікно звуку. */
  private selfTested = false;
  private liveAudio = false;

  constructor(deps: VoiceHostDeps) {
    this.deps = deps;
    this.supervisor = new Supervisor({
      spawn: () => this.spawn(),
      onState: (state) => {
        this.supervised(state);
      },
      onCrash: ({ code, recent }) => {
        deps.log.error('voice.exit', { code, recent });
      },
    });
  }

  get state(): VoiceHostState {
    return this.current;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Чому голос не працює: немає моделей, збої. */
  get problem(): string | null {
    return this.failure;
  }

  /** «Голосові команди» ввімкнено або змінились мікрофон чи динаміки. */
  enable(devices: AudioDevices): void {
    this.devices = devices;
    if (this.enabled) {
      this.control();
      return;
    }
    this.enabled = true;
    this.failure = null;
    this.supervisor.start();
  }

  async disable(): Promise<void> {
    this.enabled = false;
    this.control();
    await this.stopChild();
    this.audio?.destroy();
    this.audio = null;
    this.audioReady = false;
    this.set('off', false);
  }

  setPaused(paused: boolean): void {
    if (!this.enabled) return;
    this.paused = paused;
    this.post({ type: 'voice.pause', paused });
    this.control();
    if (paused) this.set('paused', this.speaking);
  }

  /** Кнопка мікрофона: знімає паузу й слухає команду без слова. */
  listen(): void {
    if (!this.enabled || this.current === 'failed' || this.current === 'loading') return;
    if (this.paused) this.setPaused(false);
    this.post({ type: 'voice.listen' });
  }

  /**
   * Після сну Windows: мікрофон наново — старий потік після сну часто мовчить, а Bluetooth-
   * гарнітура могла перепідключитись. Команду, що слухалась до сну, забути.
   */
  reopen(): void {
    const win = this.audio;
    if (!this.enabled || !win || win.isDestroyed() || !this.audioReady) return;
    win.webContents.send('audio:control', {
      capture: false,
      microphone: this.devices.microphone,
      speakers: this.devices.speakers,
    });
    this.post({ type: 'voice.pause', paused: this.paused });
    setTimeout(() => {
      this.control();
    }, 1000);
  }

  /** Дзвінок і активність ПК (calls.ts, powerMonitor) — у процес voice. */
  setPc(state: { readonly inCall: boolean; readonly active: boolean }): void {
    this.pc = state;
    this.post({ type: 'voice.pc', inCall: state.inCall, active: state.active });
  }

  get inCall(): boolean {
    return this.pc.inCall;
  }

  /** Ще спроба після збою: моделі докачано, або процес падав. */
  retry(): void {
    if (!this.enabled) return;
    this.failure = null;
    this.supervisor.start();
  }

  /** Перевірка програми: після самоперевірки — справжнє вікно звуку з підставним мікрофоном. */
  attachAudio(): void {
    this.liveAudio = true;
    if (this.current !== 'loading' && this.current !== 'off' && this.current !== 'failed')
      this.ensureAudio();
  }

  /** «Мій голос»: дії запису — у процес voice. */
  enroll(action: 'start' | 'stop' | 'finish' | 'cancel'): void {
    this.post({ type: 'voice.enroll', action });
  }

  /** «Стоп»: замовкнути й забути команду. */
  hush(): void {
    this.post({ type: 'voice.hush' });
  }

  /** Core перезапустився: новий порт до нього. */
  coreRestarted(): void {
    const child = this.child;
    if (!child) return;
    const channel = new MessageChannelMain();
    if (!this.deps.attachCore(channel.port1)) return;
    child.postMessage({ type: 'voice.port', to: 'core' } satisfies ControlToVoice, [channel.port2]);
  }

  /** Вихід з програми. */
  async stop(): Promise<void> {
    this.enabled = false;
    await this.stopChild();
  }

  private async stopChild(): Promise<void> {
    await this.supervisor.stop(() => {
      this.post({ type: 'voice.stop' });
    }, 2000);
  }

  private post(message: ControlToVoice): void {
    this.child?.postMessage(message);
  }

  private spawn(): ChildHandle {
    const child = utilityProcess.fork(this.deps.script, [], {
      serviceName: 'Banshee voice',
      stdio: 'pipe',
    });
    this.child = child;
    this.set('loading', false);
    child.stderr?.on('data', (chunk: Buffer) => {
      this.deps.log.warn('voice.stderr', { text: chunk.toString('utf8') });
    });
    child.on('message', (data: unknown) => {
      this.onControl(child, data);
    });
    const channel = new MessageChannelMain();
    const ports = this.deps.attachCore(channel.port1) ? [channel.port2] : [];
    child.postMessage(
      {
        type: 'voice.init',
        appVersion: this.deps.appVersion,
        modelsDir: this.deps.modelsDir,
        espeakDir: this.deps.espeakDir,
        dataDir: this.deps.dataDir,
        logsDir: this.deps.logsDir,
        ...(this.deps.selfTest ? { selfTest: this.selfTested ? 'live' : 'full' } : {}),
      } satisfies ControlToVoice,
      ports,
    );
    return {
      kill: () => {
        if (child.pid === undefined) child.kill();
        else process.kill(child.pid);
      },
      onExit: (handler) => {
        child.once('exit', handler);
      },
    };
  }

  private supervised(state: SupervisorState): void {
    if (state === 'failed') {
      this.failure = 'Процес голосу падав тричі за хвилину';
      this.set('failed', false);
    } else if (state === 'restarting') this.set('loading', false);
    this.control();
  }

  private onControl(child: UtilityProcess, data: unknown): void {
    if (child !== this.child) return;
    const parsed = parseControlFromVoice(data);
    if (!parsed.ok) {
      this.deps.log.warn('voice.control', { error: parsed.error });
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case 'voice.started':
        this.supervisor.ready();
        this.deps.log.info('voice.ready', {
          ms: message.ms,
          wakeModel: message.wakeModel,
          profile: message.profile,
        });
        this.ensureAudio();
        if (this.paused) this.post({ type: 'voice.pause', paused: true });
        this.post({ type: 'voice.pc', inCall: this.pc.inCall, active: this.pc.active });
        break;
      case 'voice.failed':
        this.failure = message.missing.length > 0 ? 'Немає моделей голосу' : message.error;
        this.deps.log.error('voice.failed', {
          error: message.error,
          missing: message.missing.length,
        });
        void this.stopChild().then(() => {
          this.set('failed', false);
        });
        break;
      case 'voice.state':
        this.speaking = message.speaking;
        this.set(this.paused ? 'paused' : message.state, message.speaking);
        break;
      case 'voice.selfTest':
        this.selfTested = true;
        break;
      default:
        break;
    }
    this.deps.onMessage(message);
  }

  /**
   * Сторінка вікна звуку підписалася на порт і керування (`audio:ready`): тепер порт до процесу voice.
   * Раніше порт ішов на `did-finish-load` з перевіркою `isLoading()`, а вона в ту мить ще true — порт
   * не доходив ніколи, мікрофон відкривався, але звук не потрапляв у процес voice (2026-10-07).
   */
  audioPageReady(sender: WebContents): void {
    const win = this.audio;
    if (!win || win.isDestroyed() || win.webContents !== sender) return;
    this.audioReady = true;
    this.connectAudio();
  }

  /** Вікно звуку: створити, коли процес voice готовий; порт до нього — коли сторінка скаже, що готова. */
  private ensureAudio(): void {
    if (this.deps.selfTest && !this.liveAudio) return;
    if (!this.audio || this.audio.isDestroyed()) {
      const win = this.deps.createAudioWindow();
      if (!win) return;
      this.audio = win;
      this.audioReady = false;
      win.on('closed', () => {
        if (this.audio !== win) return;
        this.audio = null;
        this.audioReady = false;
      });
      // Процес сторінки впав — нове вікно за 1 с, якщо голос і далі ввімкнено.
      win.webContents.on('render-process-gone', () => {
        if (this.audio !== win) return;
        win.destroy();
        setTimeout(() => {
          if (this.enabled) this.ensureAudio();
        }, 1000);
      });
      return;
    }
    this.connectAudio();
  }

  private connectAudio(): void {
    const child = this.child;
    const win = this.audio;
    if (!child || !win || win.isDestroyed() || !this.audioReady) return;
    this.deps.log.info('voice.audio', { pid: child.pid ?? null });
    const channel = new MessageChannelMain();
    win.webContents.postMessage('audio:port', null, [channel.port1]);
    child.postMessage({ type: 'voice.port', to: 'audio' } satisfies ControlToVoice, [
      channel.port2,
    ]);
    this.control();
  }

  /** Мікрофон відкритий, лише коли голос увімкнено, готовий і не на паузі. */
  private control(): void {
    const win = this.audio;
    if (!win || win.isDestroyed() || !this.audioReady) return;
    const ready = this.current !== 'off' && this.current !== 'failed' && this.current !== 'loading';
    win.webContents.send('audio:control', {
      capture: this.enabled && !this.paused && ready,
      microphone: this.devices.microphone,
      speakers: this.devices.speakers,
    });
  }

  private set(state: VoiceHostState, speaking: boolean): void {
    const changed = state !== this.current;
    this.current = state;
    this.speaking = speaking;
    if (changed) this.control();
    this.deps.onState(state, speaking);
  }
}
