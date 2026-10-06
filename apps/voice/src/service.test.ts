import type { ControlFromVoice, DesktopMessage, VoiceToAudio } from '@banshee/shared';
import { describe, expect, it } from 'vitest';
import { CHUNK } from './audio.ts';
import { VoiceService, enrollError, yesNo } from './service.ts';

function harness(texts: string[]) {
  const core: DesktopMessage[] = [];
  const audio: VoiceToAudio[] = [];
  const main: ControlFromVoice[] = [];
  const spoken: string[] = [];
  const service = new VoiceService({
    engines: {
      wake: (chunk) => Promise.resolve(chunk[0] ?? null),
      speech: (chunk) => (chunk[1] ?? 0) > 0,
      enrollSpeech: { push: (chunk) => (chunk[1] ?? 0) > 0, reset: () => undefined },
      recognize: () => Promise.resolve(texts.shift() ?? ''),
      embed: () => null,
      synthesize: (text) => {
        spoken.push(text);
        return Promise.resolve(new Float32Array(10));
      },
      sampleRate: 22_050,
    },
    profile: null,
    phrases: null,
    toCore: (message) => core.push(message),
    toAudio: (message) => audio.push(message),
    toMain: (message) => main.push(message),
    log: { info: () => undefined, warn: () => undefined },
    now: () => 0,
  });
  const feed = async (steps: readonly { wake?: number; speech?: boolean }[]): Promise<void> => {
    for (const step of steps) {
      const samples = new Float32Array(CHUNK);
      samples[0] = step.wake ?? 0;
      samples[1] = step.speech === true ? 1 : 0;
      service.audio({ type: 'audio', samples });
    }
    await service.settled();
  };
  const command = async (text: string): Promise<string> => {
    texts.push(text);
    await feed([
      { wake: 0.99 },
      ...Array.from({ length: 6 }, () => ({ speech: true })),
      ...Array.from({ length: 8 }, () => ({})),
    ]);
    const sent = core.filter((message) => message.type === 'command').at(-1);
    if (!sent) throw new Error('команди немає');
    return sent.id;
  };
  const played = () => {
    for (const message of audio.splice(0))
      if (message.type === 'play') service.audio({ type: 'played', id: message.id });
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { service, core, audio, main, spoken, feed, command, played, flush, texts };
}

describe('VoiceService', () => {
  it('голосова команда → core; відповідь озвучено → вікно продовження', async () => {
    const { service, core, main, spoken, command, played, flush } = harness([]);
    const turnId = await command('Котра година?');
    expect(core.at(-1)).toMatchObject({ type: 'command', text: 'Котра година?', source: 'voice' });
    expect(main).toContainEqual({
      type: 'voice.heard',
      turnId,
      text: 'Котра година?',
      owner: null,
    });
    service.core({
      type: 'say',
      turnId,
      text: 'Зараз 10:30. Гарного дня!',
      speak: true,
      speech: 'Зараз десята тридцять. Гарного дня!',
      done: true,
    });
    await flush();
    expect(spoken).toEqual(['Зараз десята тридцять.', 'Гарного дня!']);
    expect(service.speaking).toBe(true);
    service.core({
      type: 'turn.done',
      turnId,
      route: 'routine',
      outcome: 'success',
      latencyMs: 40,
      costUsd: 0,
    });
    expect(service.state).toBe('busy');
    played();
    expect(service.speaking).toBe(false);
    expect(service.state).toBe('followUp');
  });

  it('відповідь на набрану команду не озвучується', async () => {
    const { service, spoken, flush } = harness([]);
    service.core({ type: 'say', turnId: 'typed', text: 'Готово.', speak: false, done: true });
    service.core({
      type: 'say',
      turnId: 'other',
      text: 'Готово.',
      speak: true,
      speech: 'Готово.',
      done: true,
    });
    await flush();
    expect(spoken).toEqual([]);
  });

  it('питання 🟡 голосом: після озвучки слухає без слова, «так» — підтвердження', async () => {
    const { service, core, command, played, feed, flush, texts } = harness([]);
    const turnId = await command('Закрий хром.');
    service.core({
      type: 'confirm.request',
      requestId: 'r1',
      turnId,
      level: 'yellow',
      tainted: false,
      summary: 'Закрити Google Chrome',
      methods: ['voice', 'click', 'key'],
      timeoutSec: 8,
      armDelaySec: 0,
    });
    service.core({
      type: 'say',
      turnId,
      text: 'Закрити Google Chrome?',
      speak: true,
      speech: 'Закрити гугл хром?',
      done: true,
    });
    await flush();
    played();
    expect(service.state).toBe('listening');
    // Відповідь без слова «Banshee»: слухання відкрило питання.
    texts.push('Так, закривай.');
    await feed([
      ...Array.from({ length: 6 }, () => ({ speech: true })),
      ...Array.from({ length: 8 }, () => ({})),
    ]);
    expect(core.filter((message) => message.type === 'confirm.reply')).toEqual([
      { type: 'confirm.reply', requestId: 'r1', approved: true, method: 'voice' },
    ]);
  });

  it('слово під час озвучки — замовкнути', async () => {
    const { service, audio, command, feed, flush } = harness([]);
    const turnId = await command('Розкажи щось.');
    service.core({
      type: 'say',
      turnId,
      text: 'Довга відповідь.',
      speak: true,
      speech: 'Довга відповідь.',
      done: true,
    });
    await flush();
    expect(audio.some((message) => message.type === 'play')).toBe(true);
    await feed([...Array.from({ length: 20 }, () => ({})), { wake: 0.99 }]);
    expect(audio.at(-1)).toEqual({ type: 'silence' });
    expect(service.state).toBe('listening');
  });

  it('пауза мікрофона: звук не слухається, стан — пауза', async () => {
    const { service, core, feed } = harness(['Котра година?']);
    service.pause(true);
    expect(service.state).toBe('paused');
    await feed([{ wake: 0.99 }, ...Array.from({ length: 6 }, () => ({ speech: true }))]);
    expect(core).toEqual([]);
    service.pause(false);
    expect(service.state).toBe('idle');
  });

  it('налаштування з core: вікно продовження вимкнено — після відповіді чекає слова', async () => {
    const { service, core, command, played, flush } = harness([]);
    service.connected('0.1.0', 2);
    const request = core.find((message) => message.type === 'settings.get');
    if (!request) throw new Error('немає запиту налаштувань');
    service.core({
      type: 'reply',
      id: request.id,
      ok: true,
      result: {
        'voice.wakeSensitivity': 'medium',
        'voice.endPauseSec': 0.5,
        'voice.followUp': { enabled: false, seconds: 5 },
        'voice.tts': { voice: 'tetiana', speed: 1 },
        'security.voiceFilter': true,
        'security.voiceStrictness': 'medium',
      },
    });
    const turnId = await command('Гучність тридцять.');
    service.core({
      type: 'say',
      turnId,
      text: 'Гучність 30 відсотків.',
      speak: true,
      speech: 'Гучність тридцять відсотків.',
      done: true,
    });
    await flush();
    service.core({
      type: 'turn.done',
      turnId,
      route: 'routine',
      outcome: 'success',
      latencyMs: 40,
      costUsd: 0,
    });
    played();
    expect(service.state).toBe('idle');
  });
});

describe('yesNo', () => {
  it('розрізняє згоду, відмову й нову команду', () => {
    expect(yesNo('Так, закривай.')).toBe(true);
    expect(yesNo('Давай')).toBe(true);
    expect(yesNo('Ні.')).toBe(false);
    expect(yesNo('Не треба')).toBe(false);
    expect(yesNo('Відкрий телеграм')).toBeNull();
    expect(yesNo('Таксі викликай')).toBeNull();
  });
});

describe('готові фрази', () => {
  it('у простої синтезує лише ті, яких ще немає, і зберігає', async () => {
    const stored = new Map<string, Float32Array>([['Готово.', new Float32Array(1)]]);
    const synthesized: string[] = [];
    const service = new VoiceService({
      engines: {
        wake: () => Promise.resolve(null),
        speech: () => false,
        enrollSpeech: { push: () => false, reset: () => undefined },
        recognize: () => Promise.resolve(''),
        embed: () => null,
        synthesize: (text) => {
          synthesized.push(text);
          return Promise.resolve(new Float32Array(10));
        },
        sampleRate: 22_050,
      },
      profile: null,
      phrases: {
        get: (text) => Promise.resolve(stored.get(text) ?? null),
        put: (text, _voice, samples) => {
          stored.set(text, samples);
          return Promise.resolve();
        },
        has: (text) => stored.has(text),
      },
      toCore: () => undefined,
      toAudio: () => undefined,
      toMain: () => undefined,
      log: { info: () => undefined, warn: () => undefined },
      now: () => 0,
    });
    const made = await service.warmPhrases(
      ['Готово.', 'Звук вимкнено.', 'Гучність сто відсотків.'],
      0,
    );
    expect(made).toBe(2);
    expect(synthesized).toEqual(['Звук вимкнено.', 'Гучність сто відсотків.']);
    expect(stored.has('Звук вимкнено.')).toBe(true);
  });
});

describe('стан ПК', () => {
  it('дзвінок: відповідь не озвучується, хід завершується як звичайно', async () => {
    const { service, spoken, command, flush } = harness([]);
    service.pcState({ inCall: true, active: true });
    const turnId = await command('Котра година?');
    service.core({
      type: 'say',
      turnId,
      text: 'Зараз 10:30.',
      speak: true,
      speech: 'Зараз десята тридцять.',
      done: true,
    });
    await flush();
    expect(spoken).toEqual([]);
    service.core({
      type: 'turn.done',
      turnId,
      route: 'routine',
      outcome: 'success',
      latencyMs: 40,
      costUsd: 0,
    });
    expect(service.state).toBe('followUp');
  });

  it('«лише коли ПК активний»: неактивний ПК — слово не будить', async () => {
    const { service, core, feed } = harness(['Котра година?']);
    service.connected('0.1.0', 3);
    const request = core.find((message) => message.type === 'settings.get');
    if (!request) throw new Error('немає запиту налаштувань');
    service.core({
      type: 'reply',
      id: request.id,
      ok: true,
      result: {
        'voice.wakeSensitivity': 'medium',
        'voice.endPauseSec': 0.5,
        'voice.followUp': { enabled: true, seconds: 5 },
        'voice.tts': { voice: 'tetiana', speed: 1 },
        'voice.onlyWhenActive': true,
        'security.voiceFilter': true,
        'security.voiceStrictness': 'medium',
      },
    });
    service.pcState({ inCall: false, active: false });
    await feed([{ wake: 0.999 }]);
    expect(service.state).toBe('idle');
    service.pcState({ inCall: false, active: true });
    await feed([...Array.from({ length: 20 }, () => ({})), { wake: 0.999 }]);
    expect(service.state).toBe('listening');
  });
});

describe('мій голос', () => {
  function enrollService() {
    const main: ControlFromVoice[] = [];
    const logs: { level: 'info' | 'warn'; event: string; fields?: Record<string, unknown> }[] = [];
    const saved: { vector: Float32Array; phrases: number }[] = [];
    /** Хто питав VAD: слухач (`speech`) чи запис фрази (`enrollSpeech`), і скільки разів його скинуто. */
    const vad = { listener: 0, enroll: 0, resets: 0 };
    const service = new VoiceService({
      engines: {
        wake: () => Promise.resolve(null),
        speech: (chunk) => {
          vad.listener += 1;
          return (chunk[1] ?? 0) > 0;
        },
        enrollSpeech: {
          push: (chunk) => {
            vad.enroll += 1;
            return (chunk[1] ?? 0) > 0;
          },
          reset: () => {
            vad.resets += 1;
          },
        },
        recognize: () => Promise.resolve(''),
        embed: () => Float32Array.from([1, 0, 0]),
        synthesize: () => Promise.resolve(null),
        sampleRate: 22_050,
      },
      profile: null,
      phrases: null,
      saveProfile: (vector, phrases) => {
        saved.push({ vector, phrases });
        return Promise.resolve();
      },
      toCore: () => undefined,
      toAudio: () => undefined,
      toMain: (message) => main.push(message),
      log: {
        info: (event, fields) => logs.push({ level: 'info', event, ...(fields ? { fields } : {}) }),
        warn: (event, fields) => logs.push({ level: 'warn', event, ...(fields ? { fields } : {}) }),
      },
      now: () => 0,
    });
    /** Кроки звуку: мова (позначка VAD у фальшивому двигуні) з піком `peak`, або тиша. */
    const say = (chunks: number, peak = 0.5, speech = true) => {
      for (let index = 0; index < chunks; index += 1) {
        const samples = new Float32Array(CHUNK);
        samples[0] = peak;
        samples[1] = speech ? peak : 0;
        service.audio({ type: 'audio', samples });
      }
    };
    const lastPhrase = () =>
      main
        .filter((message) => message.type === 'voice.enrollment' && message.state === 'phrase')
        .at(-1);
    return { service, main, logs, saved, say, lastPhrase, vad };
  }

  it('фраза — власним VAD із чистого стану: черга слухача не плутає його звуком іншого моменту', async () => {
    const { service, say, vad } = enrollService();
    say(4);
    service.enroll('start');
    say(20);
    service.enroll('stop');
    service.enroll('start');
    say(20);
    service.enroll('stop');
    await service.settled();
    expect(vad).toEqual({ listener: 4, enroll: 40, resets: 2 });
  });

  it('фрази → профіль: лише числа, команди під час запису не слухаються', async () => {
    const { service, main, saved, say } = enrollService();
    for (let phrase = 0; phrase < 3; phrase += 1) {
      service.enroll('start');
      expect(service.state).toBe('enrolling');
      say(30);
      service.enroll('stop');
    }
    const phrases = main.filter(
      (message) => message.type === 'voice.enrollment' && message.state === 'phrase',
    );
    expect(phrases.map((message) => message.type === 'voice.enrollment' && message.ok)).toEqual([
      true,
      true,
      true,
    ]);
    service.enroll('finish');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.phrases).toBe(3);
    expect(service.hasProfile).toBe(true);
    expect(service.state).toBe('idle');
    expect(main.filter((message) => message.type === 'voice.enrollment').at(-1)).toMatchObject({
      state: 'saved',
      phrases: 3,
    });
  });

  it('замало мови — фраза не приймається; менше 3 фраз — профіль не зберігається', async () => {
    const { service, main, saved, say } = enrollService();
    service.enroll('start');
    say(5);
    service.enroll('stop');
    const last = main.filter((message) => message.type === 'voice.enrollment').at(-1);
    expect(last).toMatchObject({ state: 'phrase', ok: false });
    service.enroll('finish');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([]);
    expect(
      main.some((message) => message.type === 'voice.enrollment' && message.state === 'failed'),
    ).toBe(true);
    service.enroll('cancel');
    expect(service.state).toBe('idle');
  });

  it('фраза: скільки звуку, мови й наскільки гучно — у вікно й журнал, без звуку', () => {
    const { service, logs, say, lastPhrase } = enrollService();
    service.enroll('start');
    say(10, 0, false);
    say(25, 0.5);
    say(10, 0, false);
    service.enroll('stop');
    expect(lastPhrase()).toMatchObject({ ok: true, seconds: 2, recorded: 3.6, peakDb: -6 });
    expect(logs.at(-1)).toEqual({
      level: 'info',
      event: 'voice.enroll',
      fields: { recorded: 3.6, speech: 2, peakDb: -6, ok: true },
    });
  });

  it('рівень мікрофона під час запису — раз на 3 кроки, лише поки записується фраза', () => {
    const { service, main, say } = enrollService();
    say(9);
    expect(main.some((message) => message.type === 'voice.level')).toBe(false);
    service.enroll('start');
    say(3, 0, false);
    say(3, 0.1);
    service.enroll('stop');
    say(6);
    const levels = main.filter((message) => message.type === 'voice.level');
    expect(levels).toEqual([
      { type: 'voice.level', db: -120, speech: false },
      { type: 'voice.level', db: -20, speech: true },
    ]);
  });

  it('чому фразу не прийнято: звук не надходить, мікрофон дає тишу, замало мови', () => {
    const { service, say, lastPhrase } = enrollService();
    service.enroll('start');
    service.enroll('stop');
    expect(lastPhrase()).toMatchObject({ ok: false, recorded: 0, peakDb: -120 });
    expect(lastPhrase()).toHaveProperty('error', expect.stringContaining('не надходить'));

    service.enroll('start');
    say(50, 0.0005, false);
    service.enroll('stop');
    expect(lastPhrase()).toMatchObject({ ok: false, recorded: 4, peakDb: -66 });
    expect(lastPhrase()).toHaveProperty('error', expect.stringContaining('Мікрофон дає тишу'));

    service.enroll('start');
    say(40, 0.3, false);
    say(5, 0.3);
    service.enroll('stop');
    expect(lastPhrase()).toMatchObject({
      ok: false,
      error: 'Почуто 0,4 с мови з 3,6 с запису — скажи фразу ще раз, трохи довше',
    });
  });

  it('цифрова тиша 5 с поспіль — один запис у журнал; звук повернувся — ще один', () => {
    const { logs, say } = enrollService();
    say(Math.round(5000 / 80) + 20, 0, false);
    say(2, 0.2);
    say(30, 0, false);
    expect(logs.filter((entry) => entry.event.startsWith('voice.s'))).toEqual([
      { level: 'warn', event: 'voice.silence', fields: { seconds: 5 } },
      { level: 'info', event: 'voice.sound', fields: { silentSec: 7 } },
    ]);
  });
});

describe('enrollError', () => {
  it('десяткові — з комою, як пише людина', () => {
    expect(enrollError(4.8, 0.6, -12)).toBe(
      'Почуто 0,6 с мови з 4,8 с запису — скажи фразу ще раз, трохи довше',
    );
    expect(enrollError(4.8, 0, -75)).toBe(
      'Мікрофон дає тишу (найгучніше −75 дБ) — перевір пристрій запису й рівень у Windows',
    );
  });
});
