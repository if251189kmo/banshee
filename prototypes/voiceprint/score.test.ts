import { describe, expect, it } from 'vitest';
import { cosine, equalErrorRate, profileOf, ratesAt, thresholdForFar } from './score.ts';

const vec = (...values: number[]): Float32Array => Float32Array.from(values);

describe('відбитки голосу', () => {
  it('косинусна схожість не залежить від довжини вектора', () => {
    expect(cosine(vec(1, 0), vec(5, 0))).toBeCloseTo(1);
    expect(cosine(vec(1, 0), vec(0, 3))).toBeCloseTo(0);
    expect(cosine(vec(1, 1), vec(-1, -1))).toBeCloseTo(-1);
    expect(() => cosine(vec(1), vec(1, 2))).toThrow(/довжини/);
  });

  it('профіль — середнє нормованих відбитків, гучна фраза не переважує', () => {
    const profile = profileOf([vec(10, 0), vec(0, 1)]);
    expect(profile[0]).toBeCloseTo(Math.SQRT1_2);
    expect(profile[1]).toBeCloseTo(Math.SQRT1_2);
    expect(() => profileOf([])).toThrow(/хоча б одна/);
  });
});

describe('похибки в обидва боки', () => {
  const owner = [0.9, 0.8, 0.7, 0.4];
  const others = [0.1, 0.2, 0.3, 0.75];

  it('FRR і FAR на порозі', () => {
    expect(ratesAt(owner, others, 0.5)).toEqual({ threshold: 0.5, frr: 0.25, far: 0.25 });
    expect(ratesAt(owner, others, 0.95)).toMatchObject({ frr: 1, far: 0 });
  });

  it('рівна похибка й поріг під межу чужих', () => {
    expect(equalErrorRate(owner, others)).toMatchObject({ frr: 0.25, far: 0.25, eer: 0.25 });
    const strict = thresholdForFar(owner, others, 0);
    expect(strict.far).toBe(0);
    expect(strict.frr).toBe(0.5);
  });

  it('повне розділення — нуль похибок', () => {
    expect(equalErrorRate([0.8, 0.9], [0.1, 0.2]).eer).toBe(0);
  });
});
