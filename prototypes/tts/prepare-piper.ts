// node prototypes/tts/prepare-piper.ts <голос.onnx> <тека-результату> <тека espeak-ng-data>
// Готує голос Piper з rhasspy/piper-voices для sherpa-onnx: дописує метадані (частота, диктори, espeak),
// пише tokens.txt з phoneme_id_map і копіює дані вимови espeak-ng. Оригінальний файл не змінюється.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { piperTokens, withMetadata } from '../../apps/voice/src/onnx-meta.ts';

interface PiperConfig {
  readonly phoneme_type?: string;
  readonly espeak?: { readonly voice?: string };
  readonly audio?: { readonly sample_rate?: number };
  readonly num_speakers?: number;
  readonly language?: { readonly name_english?: string };
  readonly phoneme_id_map?: Readonly<Record<string, readonly number[]>>;
}

async function main(): Promise<void> {
  const [onnxPath, outDir, espeakDir] = process.argv.slice(2);
  if (!onnxPath || !outDir || !espeakDir) {
    throw new Error(
      'Виклик: prepare-piper.ts <голос.onnx> <тека-результату> <тека espeak-ng-data>',
    );
  }
  const config = JSON.parse(await readFile(`${onnxPath}.json`, 'utf8')) as PiperConfig;
  if (config.phoneme_type !== undefined && config.phoneme_type !== 'espeak') {
    throw new Error(
      `Голос читає ${config.phoneme_type}, а не фонеми espeak — sherpa-onnx його зіпсує`,
    );
  }
  const rate = config.audio?.sample_rate;
  if (!rate || !config.phoneme_id_map || !config.espeak?.voice) {
    throw new Error('У .onnx.json немає sample_rate, phoneme_id_map або espeak.voice');
  }
  const model = await readFile(onnxPath);
  const prepared = withMetadata(model, {
    model_type: 'vits',
    comment: 'piper',
    language: config.language?.name_english ?? 'Ukrainian',
    voice: config.espeak.voice,
    has_espeak: 1,
    n_speakers: config.num_speakers ?? 1,
    sample_rate: rate,
  });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, basename(onnxPath)), prepared);
  await writeFile(join(outDir, 'tokens.txt'), piperTokens(config.phoneme_id_map));
  await cp(espeakDir, join(outDir, 'espeak-ng-data'), { recursive: true });
  console.log(`Готово: ${join(outDir, basename(onnxPath))} · ${String(rate)} Гц`);
}

await main();
