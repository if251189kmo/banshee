import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDataset } from '../../scripts/lib/evals/dataset.ts';
import { concatInt16, encodeWav, floatToInt16, levels, SAMPLE_RATE } from './public/wav.js';
import { buildPlan, WAKE_SERIES } from './sets.ts';
import {
  loadManifest,
  parseMeta,
  recordingPath,
  saveRecording,
  upsertEntry,
  wavDurationSec,
  type ManifestEntry,
} from './storage.ts';

const META = { peakDbfs: -6, rmsDbfs: -24, device: 'Тестовий мікрофон', processing: true };

describe('wav.js', () => {
  it('перетворює float у 16 біт з обмеженням за межами -1…1', () => {
    expect([...floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([
      0, 32767, -32768, 32767, -32768, 16384,
    ]);
  });

  it('WAV: заголовок 44 байти, PCM 16 біт, моно, 16 кГц, дані little-endian', () => {
    const wav = Buffer.from(encodeWav(new Int16Array([1, -2, 300])));
    expect(wav.length).toBe(44 + 6);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48)]).toEqual([1, -2, 300]);
    expect(wavDurationSec(wav)).toBeCloseTo(3 / SAMPLE_RATE, 10);
  });

  it('склеює блоки й рахує рівні в dBFS', () => {
    const joined = concatInt16([new Int16Array([1, 2]), new Int16Array([3])]);
    expect([...joined]).toEqual([1, 2, 3]);
    expect(levels(new Int16Array([16384, -16384]))).toEqual({ peakDbfs: -6, rmsDbfs: -6 });
    expect(levels(new Int16Array([0, 0]))).toEqual({ peakDbfs: -Infinity, rmsDbfs: -Infinity });
  });
});

describe('план записів', () => {
  it('50 команд з еталонного набору, 4 серії по 25 «Banshee», 5 фраз профілю', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../evals/commands.json', import.meta.url), 'utf8'),
    );
    const plan = buildPlan(parseDataset(raw));
    expect(plan.commands).toHaveLength(50);
    expect(plan.wake.series.reduce((sum, item) => sum + item.count, 0)).toBe(100);
    expect(plan.profile).toHaveLength(5);
    expect(plan.foreign).toEqual({ count: 20, seconds: 5 });
    expect(new Set(WAKE_SERIES.map((item) => item.id)).size).toBe(4);
  });

  it('серії «Banshee» — з 1 і 3 м, назви файлів проходять перевірку', () => {
    expect(WAKE_SERIES.map((item) => item.id)).toEqual([
      'near-quiet',
      'far-quiet',
      'near-music',
      'far-music',
    ]);
    for (const item of WAKE_SERIES) {
      expect(() => recordingPath('D:\\r', 'wake', `${item.id}.wav`)).not.toThrow();
    }
  });
});

describe('сховище записів', () => {
  it('шлях лише всередині теки набору', () => {
    expect(recordingPath('D:\\r', 'commands', 'app-chrome.wav')).toBe(
      join('D:\\r', 'commands', 'app-chrome.wav'),
    );
    expect(() => recordingPath('D:\\r', 'secrets', 'a.wav')).toThrow(/набір/);
    expect(() => recordingPath('D:\\r', 'commands', '..\\..\\x.wav')).toThrow(/назва/);
    expect(() => recordingPath('D:\\r', 'commands', 'App.wav')).toThrow(/назва/);
  });

  it('відкидає не той WAV', () => {
    const stereo = Buffer.from(encodeWav(new Int16Array(4)));
    stereo.writeUInt16LE(2, 22);
    expect(() => wavDurationSec(stereo)).toThrow(/моно/);
    expect(() => wavDurationSec(Buffer.from('not a wav'))).toThrow();
  });

  it('розбирає дані запису й відкидає зайве чи неправильне', () => {
    const header = encodeURIComponent(JSON.stringify({ ...META, cuesMs: [3000, 6000] }));
    expect(parseMeta(header)).toEqual({ ...META, cuesMs: [3000, 6000] });
    expect(() =>
      parseMeta(encodeURIComponent(JSON.stringify({ ...META, cuesMs: ['x'] }))),
    ).toThrow();
    expect(() => parseMeta(undefined)).toThrow();
  });

  it('новий запис замінює попередній того самого файлу', () => {
    const first: ManifestEntry = {
      ...META,
      set: 'commands',
      file: 'a.wav',
      durationSec: 1,
      recordedAt: '2026-10-04T10:00:00.000Z',
    };
    const manifest = upsertEntry(upsertEntry({ version: 1, entries: [] }, first), {
      ...first,
      durationSec: 2,
    });
    expect(manifest.entries).toEqual([{ ...first, durationSec: 2 }]);
  });

  it('зберігає файл і маніфест', async () => {
    const root = await mkdtemp(join(tmpdir(), 'banshee-recordings-'));
    try {
      const wav = Buffer.from(encodeWav(new Int16Array(SAMPLE_RATE)));
      const now = new Date('2026-10-04T10:00:00.000Z');
      await saveRecording(root, 'profile', 'profile-1.wav', wav, { ...META, text: 'фраза' }, now);
      expect(await readFile(join(root, 'profile', 'profile-1.wav'))).toEqual(wav);
      expect((await loadManifest(root)).entries).toEqual([
        {
          ...META,
          text: 'фраза',
          set: 'profile',
          file: 'profile-1.wav',
          durationSec: 1,
          recordedAt: now.toISOString(),
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
