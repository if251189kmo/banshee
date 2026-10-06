import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MODELS_TOTAL_BYTES,
  downloadSource,
  missingDownloads,
  type FetchLike,
} from './download.ts';

const payload = Buffer.from('банші'.repeat(1000));
const source = {
  path: 'vad/test.onnx',
  url: 'https://example.test/test.onnx',
  size: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex'),
};

/** Сервер, що віддає payload частинами по 1000 байтів і вміє Range. */
function server(body: Buffer = payload) {
  const requests: Record<string, string>[] = [];
  const fetch: FetchLike = (_url, init) => {
    requests.push(init.headers);
    const range = /^bytes=(\d+)-$/u.exec(init.headers.Range ?? '');
    const from = range ? Number(range[1]) : 0;
    const rest = body.subarray(from);
    return Promise.resolve({
      ok: true,
      status: range ? 206 : 200,
      body: (async function* () {
        for (let offset = 0; offset < rest.length; offset += 1000)
          yield await Promise.resolve(new Uint8Array(rest.subarray(offset, offset + 1000)));
      })(),
    });
  };
  return { fetch, requests };
}

describe('downloadSource', () => {
  it('качає, перевіряє SHA-256 і кладе на місце', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banshee-models-'));
    const { fetch } = server();
    let bytes = 0;
    await downloadSource(dir, source, fetch, (count) => (bytes += count));
    expect(readFileSync(join(dir, source.path))).toEqual(payload);
    expect(existsSync(join(dir, `${source.path}.download`))).toBe(false);
    expect(bytes).toBe(payload.length);
  });

  it('після обриву докачує з того місця, де зупинилось', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banshee-models-'));
    const { fetch, requests } = server();
    await downloadSource(dir, { ...source, path: 'x.onnx' }, fetch, () => undefined);
    const part = join(dir, `${source.path}.download`);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'vad'), { recursive: true });
    writeFileSync(part, payload.subarray(0, 4000));
    await downloadSource(dir, source, fetch, () => undefined);
    expect(requests.at(-1)).toEqual({ Range: 'bytes=4000-' });
    expect(readFileSync(join(dir, source.path))).toEqual(payload);
  });

  it('пошкоджений файл — помилка, частковий файл стерто', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banshee-models-'));
    const broken = Buffer.from(payload);
    broken[10] = 0;
    const { fetch } = server(broken);
    await expect(downloadSource(dir, source, fetch, () => undefined)).rejects.toThrow(/SHA-256/u);
    expect(existsSync(join(dir, `${source.path}.download`))).toBe(false);
    expect(existsSync(join(dir, source.path))).toBe(false);
  });

  it('сервер відповів помилкою — зрозуміла помилка', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banshee-models-'));
    const fetch: FetchLike = () => Promise.resolve({ ok: false, status: 404, body: null });
    await expect(downloadSource(dir, source, fetch, () => undefined)).rejects.toThrow(/404/u);
  });
});

describe('missingDownloads', () => {
  it('порожня тека — бракує всього, ≈ 0,8 ГБ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'banshee-models-'));
    const missing = missingDownloads(dir);
    expect(missing.bytes).toBe(MODELS_TOTAL_BYTES);
    expect(MODELS_TOTAL_BYTES).toBeGreaterThan(800_000_000);
    expect(MODELS_TOTAL_BYTES).toBeLessThan(850_000_000);
  });

  it('у теці моделей розробки нічого не бракує', () => {
    const dev = join(import.meta.dirname, '..', '..', '..', '.data', 'models');
    if (!existsSync(dev)) return;
    expect(missingDownloads(dev).files).toEqual([]);
  });
});
