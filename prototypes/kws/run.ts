// npm run kws — крок 0.5: готові моделі пошуку слова sherpa-onnx на серіях «Banshee» власника.
// Перебирає написання слова й пороги; показує, скільки разів слово знайдено в кожній серії.
// Висновок 2026-10-04: готові моделі (англійська й англо-китайська, 3 млн параметрів) коротке
// «Ба́нші» власника не ловлять — див. .claude/logic/02-voice.md, «Слово "Banshee"».
import sherpa from 'sherpa-onnx-node';
import { createSpotter, KEYWORDS, MODELS } from './spot.ts';

const SERIES = ['near-quiet', 'far-quiet', 'near-music', 'far-music'] as const;
/** Написання ближчі до вимови власника: Parakeet чує його слово переважно як «Bunch». */
const OWNER_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  'B AH1 N CH': ['B AH1 N CH'],
  'B AH1 N SH': ['B AH1 N SH'],
  'набір «банч / банш»': [
    'B AH1 N CH',
    'B AH1 N SH',
    'B AE1 N SH',
    'B AH1 N CH IY0',
    'B AE1 N SH IY0',
  ],
};

async function main(): Promise<void> {
  const audio = SERIES.map((name) => sherpa.readWave(`.data/recordings/wake/${name}.wav`).samples);
  const zhEn = MODELS['zh-en'];
  const giga = MODELS.gigaspeech;
  if (!zhEn || !giga) throw new Error('Немає моделей KWS у .data/models/kws');
  const runs: { label: string; model: typeof zhEn; keywords: readonly string[] }[] = [
    { label: 'zh-en, словникове «BANSHEE»', model: zhEn, keywords: KEYWORDS['zh-en'] ?? [] },
    { label: 'gigaspeech, частини слова', model: giga, keywords: KEYWORDS.gigaspeech ?? [] },
    ...Object.entries(OWNER_VARIANTS).map(([label, keywords]) => ({
      label: `zh-en, ${label}`,
      model: zhEn,
      keywords,
    })),
  ];
  console.log(`Серії: ${SERIES.join(' / ')} (≈ 25–33 вимови в кожній)`);
  for (const run of runs) {
    for (const threshold of [0.1, 0.25]) {
      const detect = await createSpotter(
        { model: run.model, keywords: run.keywords, threshold, score: 1.5 },
        '.data/kws',
      );
      const counts = audio.map((samples) => detect(samples).length);
      console.log(`${run.label}, поріг ${String(threshold)}: знайдено ${counts.join(' / ')}`);
    }
  }
}

await main();
