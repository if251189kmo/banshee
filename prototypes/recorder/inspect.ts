// npm run recordings — перевірка записів етапу 0 у .data/recordings: що варто перезаписати й чому.
// Лише читає файли; нічого не змінює й нікуди не відправляє.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { percentile } from '../../scripts/lib/evals/report.ts';
import {
  clipStats,
  CUE_TOLERANCE_MS,
  frameLevels,
  pcmOf,
  wakeStats,
  type ClipStats,
} from './analyze.ts';
import { loadManifest, type ManifestEntry } from './storage.ts';

const DEFAULT_DIR = '.data/recordings';

/** Чужі голоси й фон — нарізка безперервного звуку, тож мова від краю до краю там нормальна. */
function clipProblems(stats: ClipStats, checkEdges: boolean): string[] {
  const durationMs = stats.durationSec * 1000;
  const problems: string[] = [];
  if (stats.speech === null) return ['мови не чути'];
  if (stats.clippedPct > 0.01) problems.push(`перевантаження ${stats.clippedPct.toFixed(2)} %`);
  if (stats.speechDb < -35) problems.push(`тихо: ${stats.speechDb.toFixed(0)} dBFS`);
  if (stats.snrDb < 20) problems.push(`мова над шумом лише ${stats.snrDb.toFixed(0)} дБ`);
  if (!checkEdges) return problems;
  if (stats.speech.startMs < 100) problems.push('мова з першої миті — початок міг обрізатися');
  if (stats.speech.endMs > durationMs - 100)
    problems.push('мова до останньої миті — кінець міг обрізатися');
  return problems;
}

const db = (value: number): string => value.toFixed(0).padStart(4);
/** Шумозаглушення між словами дає цифрову тишу: число там нічого не каже. */
const floor = (value: number): string =>
  value <= -90 ? 'цифрова тиша' : `${value.toFixed(0)} dBFS`;

function printClips(set: string, entries: readonly ManifestEntry[], stats: ClipStats[]): void {
  const flagged = entries.flatMap((entry, index) => {
    const item = stats[index];
    const problems = item ? clipProblems(item, set === 'commands' || set === 'profile') : [];
    return problems.length > 0 ? [`  ${entry.file}: ${problems.join('; ')}`] : [];
  });
  const median = (pick: (item: ClipStats) => number): number => percentile(stats.map(pick), 0.5);
  console.log(
    `\n${set}: ${String(entries.length)} файлів · мова ${db(median((s) => s.speechDb))} dBFS · ` +
      `шум: ${floor(median((s) => s.noiseDb))} · ` +
      `верхня смуга 4–8 кГц ${median((s) => s.highBandPct).toFixed(1)} % · ` +
      `спектр до ${String(median((s) => s.cutoffHz))} Гц`,
  );
  console.log(flagged.length > 0 ? flagged.join('\n') : '  без зауважень');
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { dir: { type: 'string', default: DEFAULT_DIR } } });
  const root = resolve(values.dir);
  const manifest = await loadManifest(root);
  if (manifest.entries.length === 0) {
    console.log(`Записів немає: ${root}`);
    return;
  }
  const devices = new Set(manifest.entries.map((entry) => entry.device));
  console.log(`Записів: ${String(manifest.entries.length)} · мікрофон: ${[...devices].join(', ')}`);

  const sets = [...new Set(manifest.entries.map((entry) => entry.set))];
  for (const set of sets) {
    const entries = manifest.entries.filter((entry) => entry.set === set);
    const samples = await Promise.all(
      entries.map(async (entry) => pcmOf(await readFile(join(root, entry.set, entry.file)))),
    );
    if (set !== 'wake') {
      printClips(set, entries, samples.map(clipStats));
      continue;
    }
    console.log(
      `\nwake: слова — відрізки мови 0,25–1,5 с; слово «за підказкою» — не далі ${String(CUE_TOLERANCE_MS / 1000)} с від неї`,
    );
    entries.forEach((entry, index) => {
      const pcm = samples[index];
      if (!pcm) return;
      const stats = clipStats(pcm);
      const wake = wakeStats(frameLevels(pcm), entry.cuesMs ?? []);
      const cues = entry.cuesMs?.length ?? 0;
      const words = wake.loudBackground
        ? 'слова за рівнем не відділити від тла — потрібне розпізнавання'
        : `слів ${String(wake.words.length)}, підказок зі словом ${String(wake.cuesWithWord)} з ${String(cues)}`;
      console.log(
        `  ${entry.file} — ${entry.condition ?? ''}: ${words}\n` +
          `    тло: ${floor(wake.backgroundDb)} · піки ${wake.peakDb.toFixed(0)} dBFS · ` +
          `перевантаження ${stats.clippedPct.toFixed(2)} % · верхня смуга ${stats.highBandPct.toFixed(1)} %`,
      );
    });
  }
}

await main();
