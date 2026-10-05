import { describe, expect, it } from 'vitest';
import { events, score, train, type Example } from './classifier.ts';
import { EMBEDDING_DIM, embeddingEndSec, sequenceAt, SEQUENCE } from './features.ts';

function point(a: number, b: number, y: 0 | 1): Example {
  return { x: Float32Array.from([a, b]), y };
}

describe('класифікатор слова', () => {
  it('вчиться розділяти два класи навіть за сильної нерівноваги', () => {
    const examples: Example[] = [];
    for (let index = 0; index < 200; index += 1) {
      examples.push(point(-1 - (index % 7) / 10, (index % 5) / 10, 0));
    }
    for (let index = 0; index < 10; index += 1) examples.push(point(1 + index / 10, 0.2, 1));
    const model = train(examples, {
      hidden: 0,
      epochs: 30,
      learningRate: 0.05,
      l2: 1e-4,
      positiveWeight: 5,
      seed: 3,
    });
    expect(score(model, Float32Array.from([1.5, 0.2]))).toBeGreaterThan(0.9);
    expect(score(model, Float32Array.from([-1.2, 0.3]))).toBeLessThan(0.1);
  });

  it('прихований шар вчить нелінійне правило (XOR)', () => {
    const examples: Example[] = [];
    for (let index = 0; index < 400; index += 1) {
      const a = index % 2;
      const b = Math.floor(index / 2) % 2;
      const jitter = (index % 7) / 50;
      examples.push(point(a + jitter, b - jitter, a === b ? 0 : 1));
    }
    const model = train(examples, {
      hidden: 8,
      epochs: 60,
      learningRate: 0.02,
      l2: 0,
      positiveWeight: 1,
      seed: 5,
    });
    expect(score(model, Float32Array.from([0, 1]))).toBeGreaterThan(0.8);
    expect(score(model, Float32Array.from([1, 1]))).toBeLessThan(0.2);
  });

  it('вчиться й пакетами по кілька прикладів', () => {
    const examples: Example[] = [];
    for (let index = 0; index < 400; index += 1) {
      const a = index % 2;
      const b = Math.floor(index / 2) % 2;
      const jitter = (index % 7) / 50;
      examples.push(point(a + jitter, b - jitter, a === b ? 0 : 1));
    }
    const model = train(examples, {
      hidden: 8,
      epochs: 200,
      learningRate: 0.02,
      l2: 0,
      positiveWeight: 1,
      seed: 5,
      batch: 8,
    });
    expect(score(model, Float32Array.from([0, 1]))).toBeGreaterThan(0.8);
    expect(score(model, Float32Array.from([1, 1]))).toBeLessThan(0.2);
  });

  it('після спрацювання пауза: одне слово — одна подія', () => {
    const scores = [0.1, 0.96, 0.97, 0.99, 0.2, 0.1].map((value, index) => ({
      time: index * 0.08,
      score: value,
    }));
    expect(events(scores, 0.95, 1.5)).toEqual([0.08]);
    expect(events([...scores, { time: 2, score: 0.99 }], 0.95, 1.5)).toEqual([0.08, 2]);
  });
});

describe('ознаки', () => {
  it('кінець вікна ознаки: 0,76 с і далі кожні 80 мс', () => {
    expect(embeddingEndSec(0)).toBeCloseTo(0.76);
    expect(embeddingEndSec(10)).toBeCloseTo(1.56);
  });

  it('послідовність — SEQUENCE ознак поспіль, без виходу за межі', () => {
    const embeddings = Array.from({ length: 20 }, (_, index) =>
      new Float32Array(EMBEDDING_DIM).fill(index),
    );
    const sequence = sequenceAt(embeddings, 15);
    expect(sequence?.length).toBe(SEQUENCE * EMBEDDING_DIM);
    expect(sequence?.[0]).toBe(0);
    expect(sequence?.at(-1)).toBe(15);
    expect(sequenceAt(embeddings, 14)).toBeNull();
    expect(sequenceAt(embeddings, 20)).toBeNull();
  });
});
