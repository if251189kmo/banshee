import type { ControlFromVoice, DesktopMessage, VoiceToAudio } from '@banshee/shared';
import { describe, expect, it } from 'vitest';
import { CHUNK } from './audio.ts';
import { VoiceService, yesNo } from './service.ts';

function harness(texts: string[]) {
  const core: DesktopMessage[] = [];
  const audio: VoiceToAudio[] = [];
  const main: ControlFromVoice[] = [];
  const spoken: string[] = [];
  const service = new VoiceService({
    engines: {
      wake: (chunk) => Promise.resolve(chunk[0] ?? null),
      speech: (chunk) => (chunk[1] ?? 0) > 0,
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
