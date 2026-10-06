// Автомат станів голосу (.claude/logic/09-ui.md, «Стани»; 02-voice.md, «Правила»):
// очікує слово → слухає команду до паузи → розпізнає й перевіряє голос → чекає відповіді core →
// вікно продовження. Час рахується за звуком (крок — 80 мс), тож записи можна проганяти швидше
// за реальний час; затримки для N1 — за годинником deps.now().
import { CHUNK_MS, concat } from './audio.ts';
import { cosine } from './vectors.ts';
import { commandText } from './text.ts';

/** idle — чекає слова; listening — слухає команду; recognizing — розпізнає; busy — хід core. */
export type ListenerState = 'idle' | 'listening' | 'recognizing' | 'busy' | 'followUp';

export interface ListenerOptions {
  /** Поріг моделі слова (WAKE_THRESHOLDS). */
  readonly wakeThreshold: number;
  /** Пауза кінця фрази, мс (`voice.endPauseSec`). */
  readonly endPauseMs: number;
  /** Після такої тиші розпізнавання стартує наперед: якщо мова не продовжилась, результат готовий. */
  readonly speculativeMs: number;
  /** Після слова тиша довша за це — Banshee перестає слухати. */
  readonly noSpeechMs: number;
  /** Фраза з меншою кількістю мови — хвіст слова чи шум, не команда. */
  readonly minSpeechMs: number;
  readonly maxCommandMs: number;
  /** Вікно продовження, мс; null — вимкнено (`voice.followUp`). */
  readonly followUpMs: number | null;
  /** Повторне спрацювання слова не раніше, ніж через стільки мс. */
  readonly refractoryMs: number;
  /** Скільки звуку до спрацювання йде на перевірку голосу разом з командою. */
  readonly verifyBeforeMs: number;
  /** Поріг схожості голосу (VOICE_THRESHOLDS); null — перевірки немає. */
  readonly voiceThreshold: number | null;
}

export const DEFAULT_LISTENER: ListenerOptions = {
  wakeThreshold: 0.97,
  endPauseMs: 500,
  speculativeMs: 200,
  noSpeechMs: 4000,
  minSpeechMs: 160,
  maxCommandMs: 15_000,
  followUpMs: 5000,
  refractoryMs: 1500,
  verifyBeforeMs: 1600,
  voiceThreshold: 0.32,
};

export interface ListenerDeps {
  /** Оцінка слова для кроку або null, поки ознак замало. */
  wake(chunk: Float32Array): Promise<number | null>;
  /** Чи є мова в кроці. */
  speech(chunk: Float32Array): boolean;
  recognize(samples: Float32Array): Promise<string>;
  /** Відбиток голосу; null — звуку замало. */
  embed(samples: Float32Array): Float32Array | null;
  /** Профіль власника; null — голос ще не записано, перевірки немає. */
  profile(): Float32Array | null;
  now(): number;
}

export interface CommandTiming {
  /** Кінець останнього кроку з мовою — за годинником. */
  readonly speechEndAt: number;
  /** Пауза кінця фрази минула. */
  readonly decidedAt: number;
  readonly recognizedAt: number;
  /** Чи готовим було спекулятивне розпізнавання. */
  readonly speculative: boolean;
}

export type ListenerEvent =
  | { readonly type: 'state'; readonly state: ListenerState }
  | { readonly type: 'wake'; readonly score: number }
  /** Слово під час ходу чи озвучки: озвучку приглушити. */
  | { readonly type: 'bargeIn' }
  | {
      readonly type: 'command';
      readonly text: string;
      readonly voice?: { readonly score: number; readonly owner: boolean };
      readonly timing: CommandTiming;
    };

interface Step {
  readonly chunk: Float32Array;
  readonly speech: boolean;
}

/**
 * Звук для відбитка голосу — від першого до останнього кроку з мовою, з кроком запасу: тиша
 * навколо фрази розмиває відбиток (крок 0.6 рахував відбитки на обрізаних фразах).
 */
export function speechOnly(steps: readonly Step[]): Float32Array {
  const first = steps.findIndex((step) => step.speech);
  if (first < 0) return concat(steps.map((step) => step.chunk));
  let last = steps.length - 1;
  while (last > first && steps[last]?.speech !== true) last -= 1;
  return concat(
    steps.slice(Math.max(0, first - 1), Math.min(steps.length, last + 2)).map((step) => step.chunk),
  );
}

/** Скільки разів поспіль розпізнане «лише слово» не завершує слухання. */
const MAX_RETRIES = 2;

/** Скільки кроків до мови у вікні продовження додається до команди: VAD чує мову із запізненням. */
const ONSET_CHUNKS = 2;

export class Listener {
  private state: ListenerState = 'idle';
  private options: ListenerOptions;
  private readonly deps: ListenerDeps;
  private readonly emit: (event: ListenerEvent) => void;
  /** Час звуку, мс. */
  private audioMs = 0;
  private lastWakeMs = Number.NEGATIVE_INFINITY;
  private followUpUntilMs = 0;
  /** Останні кроки до слова — для перевірки голосу «слово + команда» і початку фрази. */
  private history: Step[] = [];
  private command: Float32Array[] = [];
  /** Звук для перевірки голосу: слово (з history) і команда, з позначкою мови. */
  private verify: Step[] = [];
  /** Росте з кожним скиданням: розпізнавання, що завершилось після нього, відкидається. */
  private generation = 0;
  private startedMs = 0;
  private speechSeen = false;
  private lastSpeechMs = 0;
  private lastSpeechAt = 0;
  private speechChunks = 0;
  private retries = 0;
  private speculation: { readonly speechChunks: number; readonly text: Promise<string> } | null =
    null;
  private finishing: Promise<void> = Promise.resolve();

  constructor(deps: ListenerDeps, options: ListenerOptions, emit: (event: ListenerEvent) => void) {
    this.deps = deps;
    this.options = options;
    this.emit = emit;
  }

  get current(): ListenerState {
    return this.state;
  }

  configure(options: ListenerOptions): void {
    this.options = options;
  }

  /** Крок звуку 80 мс (−1…1). Виклики — по черзі. */
  async push(chunk: Float32Array): Promise<void> {
    this.audioMs += CHUNK_MS;
    const speech = this.deps.speech(chunk);
    const score = await this.deps.wake(chunk);
    const wake =
      score !== null &&
      score >= this.options.wakeThreshold &&
      this.audioMs - this.lastWakeMs >= this.options.refractoryMs;
    if (wake) this.lastWakeMs = this.audioMs;

    switch (this.state) {
      case 'idle':
        if (wake) this.start('wake', score);
        break;
      case 'followUp':
        if (wake) this.start('wake', score);
        else if (speech) this.start('followUp', null, chunk);
        else if (this.audioMs >= this.followUpUntilMs) this.setState('idle');
        break;
      case 'listening':
        this.listen(chunk, speech);
        break;
      case 'recognizing':
        this.collect(chunk, speech);
        break;
      case 'busy':
        if (wake) {
          this.emit({ type: 'bargeIn' });
          this.start('wake', score);
        }
        break;
    }
    this.remember(chunk, speech);
  }

  /** Хід завершено й озвучку договорено: вікно продовження або очікування слова. */
  answered(): void {
    if (this.state !== 'busy') return;
    if (this.options.followUpMs === null) this.setState('idle');
    else {
      this.followUpUntilMs = this.audioMs + this.options.followUpMs;
      this.setState('followUp');
    }
  }

  /** Кнопка мікрофона в оверлеї: слухати команду без слова «Banshee». */
  listenNow(): void {
    if (this.state === 'listening' || this.state === 'recognizing') return;
    this.start('followUp', null);
  }

  /** «Стоп», пауза мікрофона, зміна пристрою: забути команду й чекати слова. */
  reset(): void {
    this.generation += 1;
    this.command = [];
    this.verify = [];
    this.speculation = null;
    this.setState('idle');
  }

  /** Для тестів і перевірок на записах: дочекатися розпізнавання, що вже триває. */
  async settled(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.finishing;
      await current;
    } while (current !== this.finishing);
  }

  private remember(chunk: Float32Array, speech: boolean): void {
    this.history.push({ chunk, speech });
    const keep = Math.ceil(this.options.verifyBeforeMs / CHUNK_MS);
    if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
  }

  private start(origin: 'wake' | 'followUp', score: number | null, onset?: Float32Array): void {
    this.retries = 0;
    this.startedMs = this.audioMs;
    this.speechSeen = false;
    this.speechChunks = 0;
    this.speculation = null;
    if (origin === 'wake') {
      this.command = [];
      this.verify = [...this.history];
      if (score !== null) this.emit({ type: 'wake', score });
    } else {
      const onsetSteps = this.history.slice(-ONSET_CHUNKS);
      this.command = onsetSteps.map((step) => step.chunk);
      this.verify = [...onsetSteps];
    }
    this.setState('listening');
    if (onset) this.listen(onset, true);
  }

  /** Звук команди й VAD — і під час розпізнавання: якщо розпізнано лише слово, команда вже тут. */
  private collect(chunk: Float32Array, speech: boolean): void {
    this.command.push(chunk);
    this.verify.push({ chunk, speech });
    if (speech) {
      this.speechSeen = true;
      this.speechChunks += 1;
      this.lastSpeechMs = this.audioMs;
      this.lastSpeechAt = this.deps.now();
    }
  }

  private listen(chunk: Float32Array, speech: boolean): void {
    this.collect(chunk, speech);
    this.decide();
  }

  /** Кінець фрази, хвіст слова, розпізнавання наперед. */
  private decide(): void {
    if (!this.speechSeen) {
      if (this.audioMs - this.startedMs >= this.options.noSpeechMs) this.giveUp();
      return;
    }
    const silence = this.audioMs - this.lastSpeechMs;
    const tooLong = this.audioMs - this.startedMs >= this.options.maxCommandMs;
    if (
      silence >= this.options.endPauseMs &&
      this.speechChunks * CHUNK_MS < this.options.minSpeechMs
    ) {
      // Клацання чи уривок: це не команда — слухаємо далі, доки не мине noSpeechMs.
      this.command = [];
      this.speechSeen = false;
      this.speechChunks = 0;
      this.speculation = null;
      return;
    }
    if (silence >= this.options.endPauseMs || tooLong) {
      this.finishing = this.finish();
      return;
    }
    if (
      silence >= this.options.speculativeMs &&
      this.speculation?.speechChunks !== this.speechChunks
    )
      this.speculation = {
        speechChunks: this.speechChunks,
        text: this.deps.recognize(concat(this.command)),
      };
  }

  private giveUp(): void {
    this.command = [];
    this.verify = [];
    this.setState('idle');
  }

  private async finish(): Promise<void> {
    this.setState('recognizing');
    const decidedAt = this.deps.now();
    const speechEndAt = this.lastSpeechAt;
    const speculation = this.speculation;
    const speculative = speculation?.speechChunks === this.speechChunks;
    const audio = concat(this.command);
    // Звук, що надійде під час розпізнавання, — початок наступної фрази.
    this.command = [];
    this.speechSeen = false;
    this.speechChunks = 0;
    this.speculation = null;
    this.startedMs = this.audioMs;
    const generation = this.generation;
    const raw = speculative ? await speculation.text : await this.deps.recognize(audio);
    // Скинуто, поки розпізнавалось («стоп», пауза мікрофона): результат уже нікому не потрібен.
    if (generation !== this.generation) return;
    const recognizedAt = this.deps.now();
    const text = commandText(raw);
    if (text === '') {
      // Розпізнано лише слово чи шум («Banshee» і пауза): команда — у звуку, що вже надходить.
      if (this.retries < MAX_RETRIES) {
        this.retries += 1;
        this.setState('listening');
        this.decide();
        return;
      }
      this.giveUp();
      return;
    }
    const voice = this.check(speechOnly(this.verify));
    this.command = [];
    this.verify = [];
    this.emit({
      type: 'command',
      text,
      ...(voice ? { voice } : {}),
      timing: { speechEndAt, decidedAt, recognizedAt, speculative },
    });
    // Чужий голос: core лише покаже «Голос не впізнано»; вікна продовження після нього немає.
    this.setState(voice?.owner === false ? 'idle' : 'busy');
  }

  private check(samples: Float32Array): { score: number; owner: boolean } | undefined {
    const threshold = this.options.voiceThreshold;
    const profile = this.deps.profile();
    if (threshold === null || profile === null) return undefined;
    const embedding = this.deps.embed(samples);
    const score = embedding ? cosine(profile, embedding) : 0;
    return { score, owner: score >= threshold };
  }

  private setState(state: ListenerState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }
}
