import { describe, expect, it } from 'vitest';
import { piperTokens, readMetadata, withMetadata } from './onnx-meta.ts';

/** Мінімальний ModelProto: ir_version = 8 (поле 1) і producer_name = "test" (поле 2). */
const MODEL = Uint8Array.from([0x08, 0x08, 0x12, 0x04, 0x74, 0x65, 0x73, 0x74]);

describe('метадані ONNX', () => {
  it('у моделі без метаданих — порожньо; дописані — читаються, решта байтів незмінна', () => {
    expect(readMetadata(MODEL).size).toBe(0);
    const prepared = withMetadata(MODEL, { sample_rate: 22050, comment: 'piper' });
    expect([...prepared.subarray(0, MODEL.length)]).toEqual([...MODEL]);
    expect(Object.fromEntries(readMetadata(prepared))).toEqual({
      sample_rate: '22050',
      comment: 'piper',
    });
  });

  it('наявні ключі не дублює, довгі значення кодує правильно', () => {
    const once = withMetadata(MODEL, { voice: 'uk' });
    const twice = withMetadata(once, { voice: 'en', language: 'x'.repeat(300) });
    const meta = readMetadata(twice);
    expect(meta.get('voice')).toBe('uk');
    expect(meta.get('language')).toHaveLength(300);
  });

  it('tokens.txt з phoneme_id_map Piper', () => {
    expect(piperTokens({ _: [0], '^': [1], ' ': [3], а: [14] })).toBe('_ 0\n^ 1\n  3\nа 14\n');
  });
});
