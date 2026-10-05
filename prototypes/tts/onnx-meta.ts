// Метадані моделі ONNX (поле 14 ModelProto, metadata_props): прочитати й дописати.
// sherpa-onnx бере з них частоту, кількість дикторів і тип моделі. Голоси Piper з rhasspy/piper-voices
// їх не мають, тож перед запуском дописуємо. Protobuf дозволяє дописати поле в кінець повідомлення:
// модель, граф і ваги не змінюються.

const METADATA_FIELD = 14;
const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_BYTES = 2;
const WIRE_32BIT = 5;

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 1;
  let position = offset;
  for (;;) {
    const byte = bytes[position];
    if (byte === undefined) throw new Error('ONNX: файл обірвано посеред числа');
    value += (byte & 0x7f) * shift;
    position += 1;
    if ((byte & 0x80) === 0) return { value, next: position };
    shift *= 128;
  }
}

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 128) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function lengthDelimited(field: number, payload: Uint8Array): Uint8Array {
  const head = [...varint((field << 3) | WIRE_BYTES), ...varint(payload.length)];
  const out = new Uint8Array(head.length + payload.length);
  out.set(head);
  out.set(payload, head.length);
  return out;
}

function decodeEntry(bytes: Uint8Array): [string, string] {
  const decoder = new TextDecoder();
  let key = '';
  let value = '';
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    const length = readVarint(bytes, tag.next);
    const text = decoder.decode(bytes.subarray(length.next, length.next + length.value));
    if (tag.value >>> 3 === 1) key = text;
    if (tag.value >>> 3 === 2) value = text;
    offset = length.next + length.value;
  }
  return [key, value];
}

/** Усі пари metadata_props верхнього рівня моделі. */
export function readMetadata(model: Uint8Array): Map<string, string> {
  const result = new Map<string, string>();
  let offset = 0;
  while (offset < model.length) {
    const tag = readVarint(model, offset);
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (wire === WIRE_VARINT) {
      offset = readVarint(model, tag.next).next;
    } else if (wire === WIRE_64BIT) {
      offset = tag.next + 8;
    } else if (wire === WIRE_32BIT) {
      offset = tag.next + 4;
    } else if (wire === WIRE_BYTES) {
      const length = readVarint(model, tag.next);
      const end = length.next + length.value;
      if (field === METADATA_FIELD) {
        const [key, value] = decodeEntry(model.subarray(length.next, end));
        result.set(key, value);
      }
      offset = end;
    } else {
      throw new Error(`ONNX: невідомий тип поля ${String(wire)}`);
    }
  }
  return result;
}

/** Модель з дописаними парами metadata_props; наявні ключі не дублюються. */
export function withMetadata(
  model: Uint8Array,
  entries: Readonly<Record<string, string | number>>,
): Uint8Array {
  const existing = readMetadata(model);
  const encoder = new TextEncoder();
  const parts = Object.entries(entries)
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) =>
      lengthDelimited(
        METADATA_FIELD,
        Uint8Array.from([
          ...lengthDelimited(1, encoder.encode(key)),
          ...lengthDelimited(2, encoder.encode(String(value))),
        ]),
      ),
    );
  const size = parts.reduce((sum, part) => sum + part.length, model.length);
  const out = new Uint8Array(size);
  out.set(model);
  let offset = model.length;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** tokens.txt для sherpa-onnx з phoneme_id_map голосу Piper: «символ id» у рядку. */
export function piperTokens(phonemeIdMap: Readonly<Record<string, readonly number[]>>): string {
  return Object.entries(phonemeIdMap)
    .flatMap(([symbol, ids]) => ids.map((id) => `${symbol} ${String(id)}`))
    .join('\n')
    .concat('\n');
}
