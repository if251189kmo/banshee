import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { zip } from './zip.ts';

/** Читає архів назад за центральним каталогом — так, як це робить Провідник. */
function unzip(archive: Buffer): Record<string, string> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    const size = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const local = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localName = archive.readUInt16LE(local + 26);
    const start = local + 30 + localName;
    files[name] = inflateRawSync(archive.subarray(start, start + size)).toString('utf8');
    cursor += 46 + nameLength;
  }
  return files;
}

describe('ZIP діагностики', () => {
  it('файли з українськими назвами читаються назад без змін', () => {
    const archive = zip([
      { name: 'about.json', data: Buffer.from('{"версія":"0.1.0"}') },
      { name: 'logs/core.log', data: Buffer.from('рядок\n'.repeat(1000)) },
    ]);
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(unzip(archive)).toEqual({
      'about.json': '{"версія":"0.1.0"}',
      'logs/core.log': 'рядок\n'.repeat(1000),
    });
  });

  it('порожній архів — лише кінець каталогу', () => {
    expect(zip([]).length).toBe(22);
  });
});
