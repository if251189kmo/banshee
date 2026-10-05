// «Про програму» й «Зібрати діагностику» (.claude/logic/01-architecture.md, «Діагностика»): версії,
// Windows, процесор, пам'ять, тека Banshee; ZIP із журналами роботи й цими даними. Пам'яті,
// налаштувань і дампів пам'яті процесів в архіві немає — лише журнали, де немає ні тексту команд,
// ні секретів.
import { readdir, readFile, statfs, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem, version } from 'node:os';
import { join } from 'node:path';
import type { AboutInfo } from '../shared/requirements.ts';
import { zip, type ZipEntry } from './zip.ts';

export async function aboutInfo(input: {
  version: string;
  packaged: boolean;
  root: string;
}): Promise<AboutInfo> {
  let freeGb: number | null = null;
  try {
    const disk = await statfs(input.root);
    freeGb = (disk.bavail * disk.bsize) / 2 ** 30;
  } catch {
    // тека ще не створена — вільне місце невідоме
  }
  const processors = cpus();
  return {
    version: input.version,
    electron: process.versions.electron,
    packaged: input.packaged,
    windows: { name: version(), build: Number(release().split('.')[2] ?? 0) },
    cpu: { model: processors[0]?.model.trim() ?? '', threads: processors.length },
    ramGb: totalmem() / 2 ** 30,
    root: input.root,
    freeGb,
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Збирає ZIP у теку «Завантаження»; повертає шлях до архіву. */
export async function collectDiagnostics(input: {
  info: AboutInfo;
  logsDir: string;
  outDir: string;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const entries: ZipEntry[] = [
    {
      name: 'about.json',
      data: Buffer.from(
        JSON.stringify(
          {
            ...input.info,
            chrome: process.versions.chrome,
            node: process.versions.node,
            at: now.toISOString(),
          },
          null,
          2,
        ),
      ),
    },
  ];
  try {
    for (const file of await readdir(input.logsDir)) {
      if (file.endsWith('.log')) {
        entries.push({ name: `logs/${file}`, data: await readFile(join(input.logsDir, file)) });
      }
    }
  } catch {
    // журналів ще немає
  }
  const stamp = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const file = join(input.outDir, `Banshee-diagnostics-${stamp}.zip`);
  await writeFile(file, zip(entries, now));
  return file;
}
