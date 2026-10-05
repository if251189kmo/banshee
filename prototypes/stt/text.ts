// Порівняння розпізнаного тексту з тим, що власник мав сказати: нормалізація й частка помилок у словах (WER).
// WER — лише діагностика; головна мірка кроку 0.3 — чи Haiku робить ту саму дію з розпізнаного тексту.

/** Нижній регістр, один апостроф, без розділових знаків і зайвих пробілів. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’ʼ‘`]/g, "'")
    .replace(/[«»"“”„.,!?:;()[\]…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Частка помилок у словах: заміни, пропуски й вставки на одне слово еталона. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalize(reference).split(' ').filter(Boolean);
  const hyp = normalize(hypothesis).split(' ').filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index);
  for (let i = 1; i <= ref.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      current.push(Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1));
    }
    previous = current;
  }
  return (previous[hyp.length] ?? 0) / ref.length;
}
