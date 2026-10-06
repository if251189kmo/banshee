// Формат звуку голосового конвеєра (.claude/logic/02-voice.md): 16 кГц, моно — його чекають модель
// слова, VAD, відбиток голосу й Parakeet. Renderer надсилає кроки по 80 мс у шкалі −1…1.

export const SAMPLE_RATE = 16_000;
/** Крок потоку — 80 мс: так рахує ознаки модель слова. */
export const CHUNK = 1280;
export const CHUNK_MS = (CHUNK * 1000) / SAMPLE_RATE;

/** Склеює кроки звуку в один масив. */
export function concat(chunks: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** WAV PCM 16 біт → відліки −1…1 (перший канал). Для перевірок на записах і тестів. */
export function decodeWav(buffer: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Не WAV');
  let offset = 12;
  let channels = 1;
  let sampleRate = SAMPLE_RATE;
  let bits = 16;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`WAV ${String(bits)} біт: потрібно 16`);
      const frames = Math.floor(Math.min(size, buffer.length - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let index = 0; index < frames; index += 1)
        samples[index] = buffer.readInt16LE(body + index * 2 * channels) / 32768;
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV без даних');
}

/** Відліки −1…1 → WAV PCM 16 біт моно. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => {
    buffer.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
      44 + index * 2,
    );
  });
  return buffer;
}

/** Лінійне перетворення частоти: озвучка Piper (22 кГц) → 16 кГц для перевірки програми. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.floor((samples.length * to) / from);
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[left] ?? 0;
    const b = samples[left + 1] ?? a;
    out[index] = a + (b - a) * fraction;
  }
  return out;
}
