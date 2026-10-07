// Перевірка програми (`--self-check`, крок 1.1): старт до готового core, вікно центру керування з
// портом до core, команда без ШІ, голос без мікрофона (етап 2), перезапуск core після падіння,
// другий екземпляр, пам'ять.
// Результат — desktop-check.json у теці Banshee. Запитів до API немає, стан ПК не змінюється:
// команда — «котра година».
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { Log } from '@banshee/shared/log';
import { app, type BrowserWindow } from 'electron';

export interface CheckTarget {
  readonly launchedAt: number;
  /** Моменти `core.started` і виходу core (performance.now). */
  readonly coreReadyAt: readonly number[];
  readonly coreExitAt: readonly number[];
  /** Процес mcp/pc кожного запуску core. */
  readonly pcPids: readonly (number | null)[];
  secondInstances(): number;
  turnsDone(): number;
  /** Голос: стан, причина збою, готовність від запуску, результат самоперевірки процесу voice. */
  voice(): {
    readonly state: string;
    readonly problem: string | null;
    readonly readyMs: number | null;
    readonly selfTest: { heard: string | null; played: number; enrolled: boolean } | null;
  };
  crashCore(): void;
  openCenter(): BrowserWindow;
  command(text: string): void;
  /** Голос через справжнє вікно звуку з підставним мікрофоном Chromium (WAV з озвучки). */
  readonly audio: {
    attach(): void;
    /** Скільки разів вікно звуку відкрило мікрофон і яким пристроєм — востаннє. */
    opened(): { readonly count: number; readonly label: string | null };
    enroll(action: 'start' | 'stop' | 'cancel'): void;
    /** Скільки фраз «Мого голосу» оцінено й остання з них. */
    phrases(): { readonly count: number; readonly last: LivePhrase | null };
    /** Скільки мікрофонів і динаміків показує вікно звуку для вибору в налаштуваннях. */
    devices(): { readonly inputs: number; readonly outputs: number } | null;
    /** Вимкнути голос і за 1 с увімкнути, не чекаючи кінця вимкнення, — як перемикач у налаштуваннях. */
    toggle(): Promise<void>;
  };
  readonly log: Log;
}

export interface LivePhrase {
  readonly ok?: boolean | undefined;
  readonly seconds?: number | undefined;
  readonly recorded?: number | undefined;
  readonly peakDb?: number | undefined;
}

/** Ціль кроку 1.1 і N4: core після падіння знову готовий за ≤ 5 с. */
export const RESTART_LIMIT_MS = 5000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<number> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await check()) return performance.now();
    await sleep(25);
  }
  throw new Error(`не дочекалися: ${what}`);
}

/** Стан сторінки з атрибутів data-* кореня (renderer/App.tsx). */
interface WindowState {
  readonly core?: string;
  readonly readyCount?: string;
  readonly turns?: string;
}

async function windowState(win: BrowserWindow): Promise<WindowState> {
  if (win.isDestroyed() || win.webContents.isLoading()) return {};
  const json = (await win.webContents.executeJavaScript(
    'JSON.stringify(document.documentElement.dataset)',
  )) as string;
  return JSON.parse(json) as WindowState;
}

/**
 * Почуте схоже на сказане: до 3 літер відмінності. Самоперевірка голосу перевіряє конвеєр, а не
 * точність Parakeet: озвучка VITS щоразу звучить трохи інакше («Кота година.»).
 */
function closeTo(heard: string, expected: string): boolean {
  const a = heard
    .toLowerCase()
    .replace(/[^\p{L} ]/gu, '')
    .trim();
  let previous = Array.from({ length: expected.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= expected.length; j += 1)
      current.push(
        Math.min(
          (previous[j - 1] ?? 0) + (a[i - 1] === expected[j - 1] ? 0 : 1),
          (previous[j] ?? 0) + 1,
          (current[j - 1] ?? 0) + 1,
        ),
      );
    previous = current;
  }
  return (previous[expected.length] ?? 99) <= 3;
}

/** Чи живий процес: сигнал 0 лише перевіряє, що процес є. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runSecondInstance(): Promise<{ code: number | null; ms: number }> {
  return new Promise((resolve) => {
    const started = performance.now();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'),
    );
    const child = spawn(process.execPath, process.argv.slice(1), { env, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
    }, 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Math.round(performance.now() - started) });
    });
  });
}

/** Фраза з вікна звуку: 4 с запису «Мого голосу» — підставний мікрофон каже фразу озвучки по колу. */
async function livePhrase(target: CheckTarget): Promise<LivePhrase | null> {
  const before = target.audio.phrases().count;
  target.audio.enroll('start');
  await sleep(4000);
  target.audio.enroll('stop');
  await waitFor(() => target.audio.phrases().count > before, 5000, 'голос: фраза з вікна звуку');
  const last = target.audio.phrases().last;
  return last
    ? { ok: last.ok, seconds: last.seconds, recorded: last.recorded, peakDb: last.peakDb }
    : null;
}

/** Звук дійшов: за 4 с запису — щонайменше 3 с звуку й 1,5 с мови. */
const heardLive = (phrase: LivePhrase | null): boolean =>
  (phrase?.recorded ?? 0) >= 3 && (phrase?.seconds ?? 0) >= 1.5;

/**
 * Справжнє вікно звуку (02-voice.md, «Вікно звуку»): getUserMedia → AudioWorklet → порт → процес voice,
 * з підставним мікрофоном Chromium замість мікрофона власника. Потім голос швидко вимкнути й увімкнути —
 * так 2026-10-07 власник отримав 0 кроків звуку — і перевірити ще раз.
 */
async function checkLiveAudio(target: CheckTarget, problems: string[]): Promise<unknown> {
  target.audio.attach();
  await waitFor(
    () => target.audio.opened().count > 0,
    20_000,
    'голос: вікно звуку відкрило мікрофон',
  );
  const microphone = target.audio.opened().label;
  const devices = await waitFor(
    () => (target.audio.devices()?.inputs ?? 0) > 0,
    5000,
    'голос: список мікрофонів для налаштувань',
  ).then(
    () => target.audio.devices(),
    () => {
      problems.push('голос: вікно звуку не дало списку мікрофонів');
      return target.audio.devices();
    },
  );
  const first = await livePhrase(target);
  if (!heardLive(first))
    problems.push(
      `голос: з вікна звуку — ${String(first?.recorded ?? 0)} с звуку, ${String(first?.seconds ?? 0)} с мови`,
    );
  const openedBefore = target.audio.opened().count;
  await target.audio.toggle();
  await waitFor(
    () => target.voice().state === 'idle' && target.audio.opened().count > openedBefore,
    30_000,
    'голос після вимкнення й увімкнення',
  );
  const afterToggle = await livePhrase(target);
  if (!heardLive(afterToggle))
    problems.push(
      `голос після вимкнення й увімкнення: ${String(afterToggle?.recorded ?? 0)} с звуку, ${String(afterToggle?.seconds ?? 0)} с мови`,
    );
  target.audio.enroll('cancel');
  return { microphone, devices, phrase: first, afterToggle };
}

export async function runSelfCheck(target: CheckTarget, out: string): Promise<void> {
  const result: Record<string, unknown> = {
    at: new Date().toISOString(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
  };
  const problems: string[] = [];
  const ms = (from: number, to: number): number => Math.round(to - from);
  try {
    const firstReady = await waitFor(() => target.coreReadyAt.length > 0, 30_000, 'core готовий');
    result['coreReadyMs'] = ms(target.launchedAt, firstReady);

    const win = target.openCenter();
    const opened = performance.now();
    const windowReady = await waitFor(
      async () => (await windowState(win)).core === 'ready',
      20_000,
      'вікно підключилося до core',
    );
    result['windowReadyMs'] = ms(opened, windowReady);

    const turnsBefore = target.turnsDone();
    const sent = performance.now();
    target.command('котра година');
    const done = await waitFor(
      async () =>
        target.turnsDone() > turnsBefore && Number((await windowState(win)).turns ?? 0) > 0,
      10_000,
      'хід «котра година» в головному процесі й у вікні',
    );
    result['commandMs'] = ms(sent, done);

    // Голос без мікрофона: Banshee каже собі «Котра година?» і слухає це (02-voice.md).
    await waitFor(
      () => target.voice().selfTest !== null || target.voice().state === 'failed',
      90_000,
      'голос: самоперевірка',
    ).catch(() => undefined);
    const voice = target.voice();
    result['voice'] = {
      state: voice.state,
      problem: voice.problem,
      readyMs: voice.readyMs,
      heard: voice.selfTest?.heard ?? null,
      played: voice.selfTest?.played ?? 0,
      enrolled: voice.selfTest?.enrolled ?? false,
    };
    if (voice.problem === 'Немає моделей голосу') {
      // Встановлена програма без моделей: голос не перевіряється — це не збій програми.
    } else if (voice.selfTest === null) {
      problems.push(`голос не пройшов самоперевірку: ${voice.problem ?? voice.state}`);
    } else if (!voice.selfTest.enrolled) {
      problems.push('голос: «Мій голос» не зберіг профіль');
    } else if (
      !closeTo(voice.selfTest.heard ?? '', 'котра година') ||
      voice.selfTest.played === 0
    ) {
      problems.push(
        `голос: почуто «${voice.selfTest.heard ?? ''}», озвучено ${String(voice.selfTest.played)}`,
      );
    }
    if (voice.selfTest !== null)
      result['voiceLive'] = await checkLiveAudio(target, problems).catch((error: unknown) => {
        problems.push(`голос: ${errorText(error)}`);
        return null;
      });

    const readyBefore = target.coreReadyAt.length;
    const exitsBefore = target.coreExitAt.length;
    const oldPc = target.pcPids.at(-1) ?? null;
    const connectionsBefore = Number((await windowState(win)).readyCount ?? 0);
    const killed = performance.now();
    target.crashCore();
    const restarted = await waitFor(
      () => target.coreReadyAt.length > readyBefore,
      15_000,
      'core після падіння',
    );
    const reconnected = await waitFor(
      async () => Number((await windowState(win)).readyCount ?? 0) > connectionsBefore,
      15_000,
      'вікно після перезапуску core',
    );
    result['exitDetectedMs'] = ms(killed, target.coreExitAt[exitsBefore] ?? killed);
    result['restartMs'] = ms(killed, restarted);
    result['windowReconnectMs'] = ms(killed, reconnected);
    if (ms(killed, restarted) > RESTART_LIMIT_MS) {
      problems.push(`перезапуск core ${String(ms(killed, restarted))} мс — понад 5000`);
    }

    // Процес mcp/pc упалого core має завершитися сам, разом із PowerShell.
    if (oldPc === null) {
      problems.push('core не назвав процес mcp/pc');
    } else {
      const orphan = await waitFor(() => !alive(oldPc), 5000, 'mcp/pc упалого core').then(
        () => false,
        () => true,
      );
      result['pcOrphan'] = orphan;
      if (orphan) problems.push('mcp/pc упалого core лишився сиротою');
    }

    const instancesBefore = target.secondInstances();
    const second = await runSecondInstance();
    const noticed = target.secondInstances() > instancesBefore;
    result['secondInstance'] = { exitCode: second.code, ms: second.ms, noticed };
    if (second.code !== 0 || !noticed) {
      problems.push('другий екземпляр не передав керування першому');
    }

    await sleep(3000);
    const metrics = app.getAppMetrics();
    result['memoryMb'] = Math.round(
      metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024,
    );
    result['processes'] = metrics.map((metric) => ({
      type: metric.type,
      name: metric.name ?? metric.serviceName ?? '',
      mb: Math.round(metric.memory.workingSetSize / 1024),
      cpu: Math.round(metric.cpu.percentCPUUsage * 10) / 10,
    }));
  } catch (error) {
    problems.push(errorText(error));
  }
  result['problems'] = problems;
  result['ok'] = problems.length === 0;
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  target.log.info('self-check', { ok: problems.length === 0, problems: problems.join('; ') });
}
