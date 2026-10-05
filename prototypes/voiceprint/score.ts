// Оцінка розпізнавання власника за голосом (крок 0.6): схожість відбитків і похибки в обидва боки.
// FRR — частка фраз власника, яких не впізнано; FAR — частка чужих фраз, прийнятих за власника.

export function normalized(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return vector.map((value) => value / length);
}

/** Косинусна схожість двох відбитків: 1 — однакові, 0 — не схожі. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Відбитки різної довжини');
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((value, index) => {
    const other = b[index] ?? 0;
    dot += value * other;
    na += value * value;
    nb += other * other;
  });
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Профіль голосу — середнє нормованих відбитків фраз запису, як у майстрі першого запуску. */
export function profileOf(embeddings: readonly Float32Array[]): Float32Array {
  const first = embeddings[0];
  if (!first) throw new Error('Для профілю потрібна хоча б одна фраза');
  const sum = new Float32Array(first.length);
  for (const embedding of embeddings) {
    normalized(embedding).forEach((value, index) => {
      sum[index] = (sum[index] ?? 0) + value;
    });
  }
  return normalized(sum);
}

export interface ErrorRates {
  readonly threshold: number;
  /** Частка фраз власника нижче порогу. */
  readonly frr: number;
  /** Частка чужих фраз на порозі чи вище. */
  readonly far: number;
}

export function ratesAt(
  owner: readonly number[],
  others: readonly number[],
  threshold: number,
): ErrorRates {
  const below = owner.filter((score) => score < threshold).length;
  const above = others.filter((score) => score >= threshold).length;
  return {
    threshold,
    frr: owner.length > 0 ? below / owner.length : 0,
    far: others.length > 0 ? above / others.length : 0,
  };
}

/** Пороги-кандидати — самі оцінки й точка за найвищою: між ними похибки не змінюються. */
function candidates(owner: readonly number[], others: readonly number[]): number[] {
  const all = [...owner, ...others].sort((a, b) => a - b);
  return [...all, (all.at(-1) ?? 0) + 1e-6];
}

/** Рівна похибка (EER): поріг, де FRR і FAR найближчі; похибка — їхнє середнє. */
export function equalErrorRate(
  owner: readonly number[],
  others: readonly number[],
): ErrorRates & { eer: number } {
  let best: ErrorRates | undefined;
  for (const threshold of candidates(owner, others)) {
    const rates = ratesAt(owner, others, threshold);
    if (!best || Math.abs(rates.frr - rates.far) < Math.abs(best.frr - best.far)) best = rates;
  }
  const result = best ?? { threshold: 0, frr: 0, far: 0 };
  return { ...result, eer: (result.frr + result.far) / 2 };
}

/** Найнижчий поріг, за якого чужих приймається не більше maxFar, — і скільки власника тоді відкидається. */
export function thresholdForFar(
  owner: readonly number[],
  others: readonly number[],
  maxFar: number,
): ErrorRates {
  for (const threshold of candidates(owner, others)) {
    const rates = ratesAt(owner, others, threshold);
    if (rates.far <= maxFar) return rates;
  }
  return ratesAt(owner, others, Number.POSITIVE_INFINITY);
}
