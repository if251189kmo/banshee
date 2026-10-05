import { describe, expect, it } from 'vitest';
import { Supervisor, type ChildHandle, type SupervisorState } from './supervisor.ts';

/** Підробні процеси й годинник: перезапуск без справжнього Electron. */
function harness(options: { maxCrashes?: number } = {}) {
  let clock = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const children: { handle: ChildHandle; exit: (code: number) => void; killed: boolean }[] = [];
  const states: SupervisorState[] = [];
  const crashes: number[] = [];
  const supervisor = new Supervisor({
    spawn: () => {
      let onExit: (code: number) => void = () => undefined;
      const child = {
        killed: false,
        exit: (code: number) => {
          onExit(code);
        },
        handle: {
          kill: () => {
            child.killed = true;
            onExit(1);
          },
          onExit: (handler: (code: number) => void) => {
            onExit = handler;
          },
        },
      };
      children.push(child);
      return child.handle;
    },
    onState: (state) => states.push(state),
    onCrash: ({ recent }) => crashes.push(recent),
    now: () => clock,
    schedule: (run, ms) => {
      const timer = { at: clock + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    ...(options.maxCrashes ? { maxCrashes: options.maxCrashes } : {}),
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0)) {
      if (timer.cancelled) continue;
      if (timer.at <= clock) timer.run();
      else timers.push(timer);
    }
  };
  return { supervisor, children, states, crashes, advance };
}

describe('нагляд за core', () => {
  it('після падіння перезапускає core за 300 мс', () => {
    const { supervisor, children, states, advance } = harness();
    supervisor.start();
    supervisor.ready();
    children[0]?.exit(1);
    expect(supervisor.state).toBe('restarting');
    advance(299);
    expect(children).toHaveLength(1);
    advance(1);
    expect(children).toHaveLength(2);
    supervisor.ready();
    expect(states).toEqual(['starting', 'running', 'restarting', 'running']);
  });

  it('3 падіння за хвилину — стан failed і без нових спроб', () => {
    const { supervisor, children, crashes, advance } = harness();
    supervisor.start();
    for (let index = 0; index < 3; index += 1) {
      children.at(-1)?.exit(1);
      advance(1000);
    }
    expect(crashes).toEqual([1, 2, 3]);
    expect(supervisor.state).toBe('failed');
    expect(children).toHaveLength(3);
    advance(60_000);
    expect(children).toHaveLength(3);
  });

  it('падіння, розкидані понад хвилину, не накопичуються', () => {
    const { supervisor, children, crashes, advance } = harness();
    supervisor.start();
    for (let index = 0; index < 4; index += 1) {
      children.at(-1)?.exit(1);
      advance(31_000);
    }
    expect(crashes).toEqual([1, 2, 2, 2]);
    expect(supervisor.state).toBe('restarting');
    expect(children).toHaveLength(5);
  });

  it('після failed запуск з трею починає з чистого лічильника', () => {
    const { supervisor, children, advance } = harness({ maxCrashes: 1 });
    supervisor.start();
    children[0]?.exit(1);
    expect(supervisor.state).toBe('failed');
    supervisor.start();
    expect(children).toHaveLength(2);
    advance(1000);
    expect(supervisor.state).toBe('starting');
  });

  it('зупинка: м’яко, без перезапуску; не відповів — убити за таймаутом', async () => {
    const { supervisor, children, advance } = harness();
    supervisor.start();
    supervisor.ready();
    let asked = 0;
    const stopping = supervisor.stop(() => {
      asked += 1;
      children[0]?.exit(0);
    });
    await stopping;
    expect(asked).toBe(1);
    expect(supervisor.state).toBe('stopped');
    advance(10_000);
    expect(children).toHaveLength(1);

    supervisor.start();
    const stuck = supervisor.stop(() => undefined, 3000);
    advance(3000);
    await stuck;
    expect(children[1]?.killed).toBe(true);
    expect(supervisor.state).toBe('stopped');
  });

  it('crash() для перевірки програми — як справжнє падіння', () => {
    const { supervisor, children, advance } = harness();
    supervisor.start();
    supervisor.ready();
    supervisor.crash();
    expect(children[0]?.killed).toBe(true);
    advance(300);
    expect(children).toHaveLength(2);
  });
});
