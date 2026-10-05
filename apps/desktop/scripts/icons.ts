// Іконки Banshee (.claude/logic/09-ui.md, «Візуальна мова»): значок трею для кожного стану й іконка
// програми для вікон і встановлювача. Малюються кодом — без графічних редакторів і залежностей:
// `node apps/desktop/scripts/icons.ts` пише PNG і ICO в apps/desktop/resources.
//
// Стан у треї показує форма, а не лише колір (09-ui.md, «Стани»): базовий режим — значок-позначка
// внизу праворуч, core не працює — сіре коло з перекресленням.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

type Rgba = readonly [number, number, number, number];

const ACCENT: Rgba = [11, 122, 114, 255]; // #0b7a72
const MUTED: Rgba = [107, 114, 128, 255]; // #6b7280
const WHITE: Rgba = [255, 255, 255, 255];
const AMBER: Rgba = [245, 158, 11, 255]; // #f59e0b
const INK: Rgba = [17, 24, 39, 255]; // #111827

/** Відстань зі знаком до фігури в координатах 0…1: < 0 — усередині. */
type Shape = (x: number, y: number) => number;

const circle =
  (cx: number, cy: number, r: number): Shape =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) - r;

/** Відрізок із закругленими кінцями завтовшки 2r. */
const capsule =
  (ax: number, ay: number, bx: number, by: number, r: number): Shape =>
  (x, y) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - r;
  };

const union =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    Math.min(...shapes.map((shape) => shape(x, y)));

interface Layer {
  readonly shape: Shape;
  readonly color: Rgba;
}

/** Три смужки звуку — «голосовий асистент». */
function bars(scale = 1): Shape {
  const r = 0.055 * scale;
  return union(
    capsule(0.32, 0.4, 0.32, 0.6, r),
    capsule(0.5, 0.28, 0.5, 0.72, r),
    capsule(0.68, 0.4, 0.68, 0.6, r),
  );
}

export const ICON_VARIANTS = {
  /** Звичайний стан: ШІ працює або вимкнений власником без позначки. */
  idle: [
    { shape: circle(0.5, 0.5, 0.47), color: ACCENT },
    { shape: bars(), color: WHITE },
  ],
  /** Базовий режим без ШІ: позначка внизу праворуч. */
  basic: [
    { shape: circle(0.5, 0.5, 0.47), color: ACCENT },
    { shape: bars(), color: WHITE },
    { shape: circle(0.78, 0.78, 0.24), color: INK },
    { shape: circle(0.78, 0.78, 0.17), color: AMBER },
  ],
  /** Core не працює: сіре коло, смужки перекреслено. */
  down: [
    { shape: circle(0.5, 0.5, 0.47), color: MUTED },
    { shape: bars(), color: WHITE },
    { shape: capsule(0.24, 0.24, 0.76, 0.76, 0.06), color: INK },
  ],
} as const satisfies Record<string, readonly Layer[]>;

export type IconVariant = keyof typeof ICON_VARIANTS;

/** RGBA-пікселі size×size; згладжування — 4×4 вибірки на піксель. */
export function render(layers: readonly Layer[], size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          let color: Rgba = [0, 0, 0, 0];
          for (const layer of layers) if (layer.shape(x, y) <= 0) color = layer.color;
          const alpha = color[3] / 255;
          r += color[0] * alpha;
          g += color[1] * alpha;
          b += color[2] * alpha;
          a += alpha;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return pixels;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function png(pixels: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 біт на канал
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // без фільтра
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** ICO з PNG усередині — так Windows Vista+ зберігає й великі розміри. */
export function ico(images: readonly { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // тип: іконка
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // площини
    entry.writeUInt16LE(32, 6); // біт на піксель
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/** Масштаби трею Windows: 100 %, 125 %, 150 %, 200 %. */
const TRAY_SCALES = [
  ['', 16],
  ['@1.25x', 20],
  ['@1.5x', 24],
  ['@2x', 32],
] as const;
const APP_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

function main(): void {
  const dir = join(import.meta.dirname, '..', 'resources');
  mkdirSync(dir, { recursive: true });
  for (const variant of Object.keys(ICON_VARIANTS) as IconVariant[]) {
    for (const [suffix, size] of TRAY_SCALES) {
      const data = png(render(ICON_VARIANTS[variant], size), size);
      writeFileSync(join(dir, `tray-${variant}${suffix}.png`), data);
    }
  }
  const app = APP_SIZES.map((size) => ({
    size,
    data: png(render(ICON_VARIANTS.idle, size), size),
  }));
  writeFileSync(join(dir, 'icon.ico'), ico(app));
  writeFileSync(join(dir, 'icon.png'), app.at(-1)?.data ?? Buffer.alloc(0));
  console.log(`Іконки записано в ${dir}`);
}

if (import.meta.main) main();
