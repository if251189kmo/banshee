// Відбитки голосу як вектори: нормування, косинусна схожість, профіль — середнє фраз запису.
// Без нативних модулів: цим користуються й автомат станів, і тести.

export function normalized(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return vector.map((value) => value / length);
}

/** Косинусна схожість: 1 — однакові, 0 — не схожі. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Відбитки різної довжини');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Профіль — середнє нормованих відбитків фраз запису. */
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
