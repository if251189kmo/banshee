import { describe, expect, it } from 'vitest';
import { CHUNK } from './audio.ts';
import {
  DEFAULT_LISTENER,
  Listener,
  type ListenerEvent,
  type ListenerOptions,
} from './listener.ts';

/** Крок звуку: слово (оцінка моделі) і чи є мова. */
interface Step {
  readonly wake?: number;
  readonly speech?: boolean;
}

function harness(
  options: Partial<ListenerOptions> = {},
  texts: string[] = [],
  voice: { profile: number[] | null; speaker: number[] } = { profile: [1, 0], speaker: [1, 0] },
) {
  const events: ListenerEvent[] = [];
  const recognized: number[] = [];
  let clock = 0;
  const listener = new Listener(
    {
      wake: (chunk) => Promise.resolve(chunk[0] ?? null),
      speech: (chunk) => (chunk[1] ?? 0) > 0,
      recognize: (samples) => {
        recognized.push(samples.length / CHUNK);
        return Promise.resolve(texts.shift() ?? '');
      },
      embed: () => Float32Array.from(voice.speaker),
      profile: () => (voice.profile ? Float32Array.from(voice.profile) : null),
      now: () => (clock += 1),
    },
    { ...DEFAULT_LISTENER, ...options },
    (event) => {
      events.push(event);
    },
  );
  const feed = async (steps: readonly Step[]): Promise<void> => {
    for (const step of steps) {
      const chunk = new Float32Array(CHUNK);
      chunk[0] = step.wake ?? 0;
      chunk[1] = step.speech === true ? 1 : 0;
      await listener.push(chunk);
    }
    await listener.settled();
  };
  const states = () => events.flatMap((event) => (event.type === 'state' ? [event.state] : []));
  const commands = () => events.filter((event) => event.type === 'command');
  return { listener, events, feed, states, commands, recognized };
}

const silence = (count: number): Step[] => Array.from({ length: count }, () => ({}));
const speech = (count: number): Step[] => Array.from({ length: count }, () => ({ speech: true }));

describe('Listener', () => {
  it('слово → команда до паузи → розпізнавання наперед → хід core', async () => {
    const { feed, states, commands, recognized, listener } = harness({}, ['Відкрий телеграм.']);
    await feed([{ wake: 0.99, speech: true }, ...speech(10), ...silence(8)]);
    expect(states()).toEqual(['listening', 'recognizing', 'busy']);
    const [command] = commands();
    expect(command).toMatchObject({
      text: 'Відкрий телеграм.',
      voice: { score: 1, owner: true },
      timing: { speculative: true },
    });
    // Розпізнано один раз — наперед, на паузі 240 мс; пауза 0,5 с лише підтвердила кінець фрази.
    expect(recognized).toEqual([13]);
    listener.answered();
    expect(listener.current).toBe('followUp');
  });

  it('нижче порогу й під час рефрактерного періоду слово не спрацьовує', async () => {
    const { feed, states } = harness();
    await feed([{ wake: 0.5 }, { wake: 0.96 }]);
    expect(states()).toEqual([]);
  });

  it('мова продовжилась після паузи — спекулятивний результат відкинуто', async () => {
    const { feed, commands, recognized } = harness({}, ['Відкрий', 'Відкрий телеграм.']);
    await feed([{ wake: 0.99 }, ...speech(5), ...silence(3), ...speech(5), ...silence(7)]);
    expect(commands()[0]).toMatchObject({ text: 'Відкрий телеграм.' });
    expect(recognized.length).toBe(2);
  });

  it('«Banshee» і пауза: уривок мови до 160 мс не розпізнається, Banshee слухає далі', async () => {
    const { feed, commands, states, recognized } = harness({ speculativeMs: 10_000 }, [
      'Котра година?',
    ]);
    await feed([{ wake: 0.99 }, ...speech(1), ...silence(8), ...speech(6), ...silence(8)]);
    expect(commands().map((event) => event.text)).toEqual(['Котра година?']);
    expect(states()).toEqual(['listening', 'recognizing', 'busy']);
    expect(recognized).toEqual([14]);
  });

  it('розпізнано лише слово чи шум — це не команда; після трьох поспіль Banshee перестає слухати', async () => {
    const { feed, commands, states } = harness({ speculativeMs: 10_000 }, [
      'Банші.',
      'Yeah.',
      'Ші',
    ]);
    await feed([
      { wake: 0.99, speech: true },
      ...speech(5),
      ...silence(8),
      ...speech(6),
      ...silence(8),
      ...speech(6),
      ...silence(8),
    ]);
    expect(commands()).toEqual([]);
    expect(states()).toEqual([
      'listening',
      'recognizing',
      'listening',
      'recognizing',
      'listening',
      'recognizing',
      'idle',
    ]);
  });

  it('після слова тиша — перестає слухати', async () => {
    const { feed, states, commands } = harness({ noSpeechMs: 800 });
    await feed([{ wake: 0.99 }, ...silence(12)]);
    expect(states()).toEqual(['listening', 'idle']);
    expect(commands()).toEqual([]);
  });

  it('вікно продовження: мова без слова — команда; тиша — очікування слова', async () => {
    const { feed, commands, listener, states } = harness({ speculativeMs: 10_000 }, [
      'Відкрий хром.',
      'А тепер телеграм.',
    ]);
    await feed([{ wake: 0.99 }, ...speech(6), ...silence(7)]);
    listener.answered();
    await feed([...silence(3), ...speech(6), ...silence(7)]);
    expect(commands().length).toBe(2);
    listener.answered();
    await feed(silence(70));
    expect(states().at(-1)).toBe('idle');
  });

  it('слово під час ходу — перебивання й нова команда', async () => {
    const { feed, events, listener } = harness({ speculativeMs: 10_000 }, ['Розкажи.', 'Стоп.']);
    await feed([{ wake: 0.99 }, ...speech(6), ...silence(7)]);
    expect(listener.current).toBe('busy');
    await feed([...silence(20), { wake: 0.99 }, ...speech(4), ...silence(7)]);
    expect(events.some((event) => event.type === 'bargeIn')).toBe(true);
    expect(events.filter((event) => event.type === 'command').at(-1)).toMatchObject({
      text: 'Стоп.',
    });
  });

  it('чужий голос: команда з owner=false, далі — очікування слова без вікна продовження', async () => {
    const { feed, commands, listener } = harness({ speculativeMs: 10_000 }, ['Вимкни звук.'], {
      profile: [1, 0],
      speaker: [0, 1],
    });
    await feed([{ wake: 0.99 }, ...speech(6), ...silence(7)]);
    expect(commands()[0]).toMatchObject({ voice: { score: 0, owner: false } });
    expect(listener.current).toBe('idle');
  });

  it('без профілю голосу — команда без перевірки', async () => {
    const { feed, commands } = harness({ speculativeMs: 10_000 }, ['Гучність тридцять.'], {
      profile: null,
      speaker: [1, 0],
    });
    await feed([{ wake: 0.99 }, ...speech(6), ...silence(7)]);
    expect(commands()[0]).not.toHaveProperty('voice');
  });
});

describe('commandText', () => {
  it('прибирає слово активації й шум', async () => {
    const { commandText } = await import('./text.ts');
    expect(commandText('Bunch, відкрий телеграм.')).toBe('відкрий телеграм.');
    expect(commandText('Банчі.')).toBe('');
    expect(commandText('Ба')).toBe('');
    expect(commandText('Thank you.')).toBe('');
    expect(commandText('Стоп.')).toBe('Стоп.');
    expect(commandText('Тихіше')).toBe('Тихіше');
  });
});

describe('скидання й відбиток голосу', () => {
  it('розпізнавання, що завершилось після скидання, не стає командою', async () => {
    let release: (text: string) => void = () => undefined;
    const events: ListenerEvent[] = [];
    const listener = new Listener(
      {
        wake: (chunk) => Promise.resolve(chunk[0] ?? null),
        speech: (chunk) => (chunk[1] ?? 0) > 0,
        recognize: () =>
          new Promise<string>((resolveText) => {
            release = resolveText;
          }),
        embed: () => null,
        profile: () => null,
        now: () => 0,
      },
      { ...DEFAULT_LISTENER, speculativeMs: 10_000 },
      (event) => {
        events.push(event);
      },
    );
    const step = async (wake: number, speech: boolean) => {
      const chunk = new Float32Array(CHUNK);
      chunk[0] = wake;
      chunk[1] = speech ? 1 : 0;
      await listener.push(chunk);
    };
    await step(0.99, false);
    for (let index = 0; index < 6; index += 1) await step(0, true);
    for (let index = 0; index < 7; index += 1) await step(0, false);
    expect(listener.current).toBe('recognizing');
    listener.reset();
    release('Видали все.');
    await listener.settled();
    expect(events.filter((event) => event.type === 'command')).toEqual([]);
    expect(listener.current).toBe('idle');
  });

  it('speechOnly обрізає тишу навколо фрази, лишаючи крок запасу', async () => {
    const { speechOnly } = await import('./listener.ts');
    const chunk = (value: number) => new Float32Array(CHUNK).fill(value);
    const steps = [
      { chunk: chunk(0), speech: false },
      { chunk: chunk(0.1), speech: false },
      { chunk: chunk(1), speech: true },
      { chunk: chunk(2), speech: true },
      { chunk: chunk(0.2), speech: false },
      { chunk: chunk(0), speech: false },
    ];
    const out = speechOnly(steps);
    expect(out.length).toBe(4 * CHUNK);
    expect(out[0]).toBeCloseTo(0.1);
    expect(out.at(-1)).toBeCloseTo(0.2);
  });
});
