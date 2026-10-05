// Нагляд за core (.claude/logic/01-architecture.md, «Процеси»): після падіння desktop перезапускає
// core за ≤ 5 с; після 3 падінь за хвилину — повідомлення в треї й без нових спроб. Від Electron не
// залежить: процес — будь-що з kill і подією виходу, тож логіка перевіряється тестами.

export interface ChildHandle {
  kill(): void;
  onExit(handler: (code: number) => void): void;
}

export type SupervisorState =
  'stopped' | 'starting' | 'running' | 'restarting' | 'failed' | 'stopping';

export interface SupervisorOptions {
  readonly spawn: () => ChildHandle;
  readonly onState?: (state: SupervisorState) => void;
  /** Падіння: код виходу й скільки їх за останню хвилину. */
  readonly onCrash?: (crash: { code: number; recent: number }) => void;
  readonly now?: () => number;
  /** Таймер; повертає скасування. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
  readonly restartDelayMs?: number;
  readonly maxCrashes?: number;
  readonly crashWindowMs?: number;
}

/** Пауза перед перезапуском: core піднімається за ≈ 1 с, разом — у межах 5 с. */
export const RESTART_DELAY_MS = 300;
export const MAX_CRASHES = 3;
export const CRASH_WINDOW_MS = 60_000;

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

export class Supervisor {
  private readonly options: SupervisorOptions;
  private child: ChildHandle | null = null;
  private crashes: number[] = [];
  private current: SupervisorState = 'stopped';
  private readonly exitWaiters: (() => void)[] = [];
  private cancelRestart: (() => void) | null = null;

  constructor(options: SupervisorOptions) {
    this.options = options;
  }

  get state(): SupervisorState {
    return this.current;
  }

  /** Запуск; після «failed» — ще одна спроба з чистим лічильником (пункт трею). */
  start(): void {
    if (this.current !== 'stopped' && this.current !== 'failed') return;
    this.crashes = [];
    this.spawn('starting');
  }

  /** Core повідомив, що готовий. */
  ready(): void {
    if (this.current === 'starting' || this.current === 'restarting') this.set('running');
  }

  /** Убити core так, ніби він упав: перевірка перезапуску. */
  crash(): void {
    this.child?.kill();
  }

  /** Вихід з програми: попросити core завершитись, за timeoutMs — силою. */
  async stop(requestExit: () => void, timeoutMs = 3000): Promise<void> {
    this.cancelRestart?.();
    this.cancelRestart = null;
    const child = this.child;
    if (!child) {
      this.set('stopped');
      return;
    }
    this.set('stopping');
    const exited = new Promise<void>((resolve) => {
      this.exitWaiters.push(resolve);
    });
    requestExit();
    const cancelKill = this.schedule(() => {
      child.kill();
    }, timeoutMs);
    await exited;
    cancelKill();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private schedule(run: () => void, ms: number): () => void {
    return (this.options.schedule ?? defaultSchedule)(run, ms);
  }

  private set(state: SupervisorState): void {
    if (state === this.current) return;
    this.current = state;
    this.options.onState?.(state);
  }

  private spawn(state: 'starting' | 'restarting'): void {
    this.set(state);
    const child = this.options.spawn();
    this.child = child;
    child.onExit((code) => {
      this.exited(child, code);
    });
  }

  private exited(child: ChildHandle, code: number): void {
    if (child !== this.child) return;
    this.child = null;
    for (const resolve of this.exitWaiters.splice(0)) resolve();
    if (this.current === 'stopping') {
      this.set('stopped');
      return;
    }
    const now = this.now();
    const window = this.options.crashWindowMs ?? CRASH_WINDOW_MS;
    this.crashes = [...this.crashes.filter((at) => now - at < window), now];
    this.options.onCrash?.({ code, recent: this.crashes.length });
    if (this.crashes.length >= (this.options.maxCrashes ?? MAX_CRASHES)) {
      this.set('failed');
      return;
    }
    this.set('restarting');
    this.cancelRestart = this.schedule(() => {
      this.cancelRestart = null;
      if (this.current === 'restarting') this.spawn('restarting');
    }, this.options.restartDelayMs ?? RESTART_DELAY_MS);
  }
}
