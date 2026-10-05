// WAV для записів етапу 0: PCM, 16 біт, моно, 16 кГц — формат, який чекають Whisper, KWS і
// відбитки голосу sherpa-onnx. Чисті функції: працюють і в браузері, і в тестах Node.

export const SAMPLE_RATE = 16000;

/**
 * @param {Float32Array} samples значення від -1 до 1
 * @returns {Int16Array}
 */
export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return out;
}

/**
 * @param {readonly Int16Array[]} chunks
 * @returns {Int16Array}
 */
export function concatInt16(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * @param {Int16Array} samples
 * @param {number} [sampleRate]
 * @returns {ArrayBuffer} файл WAV із заголовком у 44 байти
 */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // моно
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, i) => {
    view.setInt16(44 + i * 2, sample, true);
  });
  return buffer;
}

/**
 * Рівень сигналу в dBFS: 0 — максимум, -∞ — тиша.
 * @param {Int16Array} samples
 * @returns {{ peakDbfs: number, rmsDbfs: number }}
 */
export function levels(samples) {
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const value = Math.abs(sample) / 0x8000;
    if (value > peak) peak = value;
    sumSquares += value * value;
  }
  const rms = samples.length === 0 ? 0 : Math.sqrt(sumSquares / samples.length);
  const db = (value) => (value === 0 ? -Infinity : Math.round(20 * Math.log10(value) * 10) / 10);
  return { peakDbfs: db(peak), rmsDbfs: db(rms) };
}
