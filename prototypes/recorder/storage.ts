// Записи кроку 0.2 у `.data/recordings/<набір>/<файл>.wav` і маніфест `manifest.json`.
// Записи — дані розробки: не в git, нікуди не відправляються; голос — біометричні дані власника.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SAMPLE_RATE } from './public/wav.js';
import { RECORDING_SETS, type RecordingSet } from './sets.ts';

const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,80}\.wav$/;
const MANIFEST = 'manifest.json';

/** Те, що надсилає сторінка разом із записом. */
export interface RecordingMeta {
  readonly text?: string;
  readonly condition?: string;
  /** Моменти підказок «скажи Banshee», мс від початку файлу. */
  readonly cuesMs?: readonly number[];
  /** Позначки власника у фоновому записі («тут прозвучало слово»), мс від початку. */
  readonly marksMs?: readonly number[];
  readonly peakDbfs: number | null;
  readonly rmsDbfs: number | null;
  readonly device: string;
  /** Обробка браузера: ехоподавлення, шумозаглушення, автопідсилення — як у продукті. */
  readonly processing: boolean;
}

export interface ManifestEntry extends RecordingMeta {
  readonly set: RecordingSet;
  readonly file: string;
  readonly durationSec: number;
  readonly recordedAt: string;
}

export interface Manifest {
  readonly version: 1;
  readonly entries: readonly ManifestEntry[];
}

export function isRecordingSet(value: string): value is RecordingSet {
  return (RECORDING_SETS as readonly string[]).includes(value);
}

/** Шлях до файлу запису; помилка на будь-яку назву, що могла б вийти за межі теки. */
export function recordingPath(root: string, set: string, file: string): string {
  if (!isRecordingSet(set)) throw new Error(`Невідомий набір записів: ${set}`);
  if (!FILE_NAME.test(file)) throw new Error(`Недопустима назва файлу: ${file}`);
  return join(root, set, file);
}

/** Тривалість, якщо це WAV PCM 16 біт, моно, 16 кГц із заголовком у 44 байти; інакше помилка. */
export function wavDurationSec(wav: Buffer): number {
  const ok =
    wav.length >= 44 &&
    wav.toString('ascii', 0, 4) === 'RIFF' &&
    wav.toString('ascii', 8, 12) === 'WAVE' &&
    wav.toString('ascii', 12, 16) === 'fmt ' &&
    wav.readUInt16LE(20) === 1 &&
    wav.readUInt16LE(22) === 1 &&
    wav.readUInt32LE(24) === SAMPLE_RATE &&
    wav.readUInt16LE(34) === 16 &&
    wav.toString('ascii', 36, 40) === 'data' &&
    wav.readUInt32LE(40) === wav.length - 44;
  if (!ok) throw new Error('Очікується WAV: PCM 16 біт, моно, 16 кГц');
  return (wav.length - 44) / (SAMPLE_RATE * 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

const isLevel = (value: unknown): value is number | null =>
  value === null || typeof value === 'number';

/** Розбирає заголовок `x-recorder-meta` (JSON, закодований encodeURIComponent). */
export function parseMeta(header: string | undefined): RecordingMeta {
  const raw: unknown = JSON.parse(decodeURIComponent(header ?? '{}'));
  if (
    !isRecord(raw) ||
    typeof raw.device !== 'string' ||
    typeof raw.processing !== 'boolean' ||
    !isLevel(raw.peakDbfs) ||
    !isLevel(raw.rmsDbfs) ||
    (raw.text !== undefined && typeof raw.text !== 'string') ||
    (raw.condition !== undefined && typeof raw.condition !== 'string') ||
    (raw.cuesMs !== undefined && !isNumberList(raw.cuesMs)) ||
    (raw.marksMs !== undefined && !isNumberList(raw.marksMs))
  ) {
    throw new Error('Неправильні дані запису');
  }
  return {
    device: raw.device,
    processing: raw.processing,
    peakDbfs: raw.peakDbfs,
    rmsDbfs: raw.rmsDbfs,
    ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
    ...(typeof raw.condition === 'string' ? { condition: raw.condition } : {}),
    ...(isNumberList(raw.cuesMs) ? { cuesMs: raw.cuesMs } : {}),
    ...(isNumberList(raw.marksMs) ? { marksMs: raw.marksMs } : {}),
  };
}

/** Новий запис замінює попередній з тим самим набором і файлом. */
export function upsertEntry(manifest: Manifest, entry: ManifestEntry): Manifest {
  const others = manifest.entries.filter(
    (item) => item.set !== entry.set || item.file !== entry.file,
  );
  const entries = [...others, entry].sort((a, b) =>
    `${a.set}/${a.file}`.localeCompare(`${b.set}/${b.file}`),
  );
  return { version: 1, entries };
}

export async function loadManifest(root: string): Promise<Manifest> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(root, MANIFEST), 'utf8'));
    if (isRecord(raw) && Array.isArray(raw.entries)) {
      return { version: 1, entries: raw.entries as ManifestEntry[] };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { version: 1, entries: [] };
}

/** Пише файл і маніфест; маніфест — через тимчасовий файл, щоб збій не зіпсував його. */
export async function saveRecording(
  root: string,
  set: string,
  file: string,
  wav: Buffer,
  meta: RecordingMeta,
  now: Date = new Date(),
): Promise<Manifest> {
  const target = recordingPath(root, set, file);
  const durationSec = wavDurationSec(wav);
  await mkdir(join(root, set), { recursive: true });
  await writeFile(target, wav);
  const manifest = upsertEntry(await loadManifest(root), {
    ...meta,
    set: set as RecordingSet,
    file,
    durationSec: Math.round(durationSec * 100) / 100,
    recordedAt: now.toISOString(),
  });
  const temporary = join(root, `${MANIFEST}.tmp`);
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporary, join(root, MANIFEST));
  return manifest;
}
