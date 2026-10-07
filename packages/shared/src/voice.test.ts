import { describe, expect, it } from 'vitest';
import { isAudioToVoice, parseControlFromVoice, parseControlToVoice } from './voice.ts';

const JBL = 'Headset (JBL TUNE710BT Hands-Free AG Audio) (Bluetooth)';

describe('порт звуку renderer → voice', () => {
  it('крок звуку — Float32Array рівно на 80 мс', () => {
    expect(isAudioToVoice({ type: 'audio', samples: new Float32Array(1280) })).toBe(true);
    expect(isAudioToVoice({ type: 'audio', samples: new Float32Array(1024) })).toBe(false);
    expect(isAudioToVoice({ type: 'audio', samples: Array.from({ length: 1280 }, () => 0) })).toBe(
      false,
    );
  });

  it('стан мікрофона: яким пристроєм відкрито, обірвався, не дає звуку', () => {
    expect(isAudioToVoice({ type: 'capture', event: 'opened', label: JBL })).toBe(true);
    expect(isAudioToVoice({ type: 'capture', event: 'opened', label: JBL, fallback: true })).toBe(
      true,
    );
    expect(isAudioToVoice({ type: 'capture', event: 'failed', error: 'NotAllowedError' })).toBe(
      true,
    );
    expect(isAudioToVoice({ type: 'capture', event: 'muted', label: JBL })).toBe(true);
    expect(isAudioToVoice({ type: 'capture', ok: true })).toBe(false);
    expect(isAudioToVoice({ type: 'capture', event: 'closed' })).toBe(false);
  });

  it('пристрої: назви й типові Windows', () => {
    expect(
      isAudioToVoice({
        type: 'devices',
        inputs: [JBL],
        outputs: [],
        defaultInput: JBL,
        defaultOutput: null,
      }),
    ).toBe(true);
    expect(
      isAudioToVoice({
        type: 'devices',
        inputs: [''],
        outputs: [],
        defaultInput: null,
        defaultOutput: null,
      }),
    ).toBe(false);
  });
});

describe('службовий канал main ↔ voice', () => {
  it('стан мікрофона й пристрої доходять до головного процесу', () => {
    expect(
      parseControlFromVoice({ type: 'voice.capture', event: 'ended', label: JBL }),
    ).toMatchObject({ ok: true, message: { event: 'ended', label: JBL } });
    expect(
      parseControlFromVoice({
        type: 'voice.devices',
        inputs: [JBL],
        outputs: ['Speakers (Realtek High Definition Audio)'],
        defaultInput: JBL,
        defaultOutput: 'Speakers (Realtek High Definition Audio)',
      }).ok,
    ).toBe(true);
  });

  it('перевірка програми: full — самоперевірка, live — лише вікно звуку', () => {
    const init = {
      type: 'voice.init',
      appVersion: '0.1.0',
      modelsDir: 'D:\\Banshee\\models',
      espeakDir: 'D:\\Banshee\\app\\resources\\espeak-ng-data',
      dataDir: 'D:\\Banshee\\data',
      logsDir: 'D:\\Banshee\\logs',
    };
    expect(parseControlToVoice({ ...init, selfTest: 'live' }).ok).toBe(true);
    expect(parseControlToVoice({ ...init, selfTest: true }).ok).toBe(false);
    expect(parseControlToVoice(init).ok).toBe(true);
  });
});
