// npm run voice:dev-setup — голос для розробки на ПК власника (.claude/logic/02-voice.md, «Реалізація —
// етап 2»): поки кроків «Навчити слово» й «Мій голос» (2.4, 2.6) у програмі немає, кладе в .data/voice
// модель слова ітерації 4 (10 вимов власника з 1 м) і профіль голосу з 5 фраз запису етапу 0,
// а базову модель без голосу власника — у .data/models/wakeword. Усе лишається на цьому ПК.
// --to <тека Banshee> — те саме для встановленої програми: <тека>\data\voice.
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MODEL_PATHS,
  PROFILE_FILE,
  VOICE_MODEL,
  WAKE_MODEL_FILE,
  decodeWav,
  loadVoicePrinter,
  profileOf,
  writeProfile,
} from '../src/index.ts';

const DATA = resolve('.data');
const toArg = process.argv.indexOf('--to');
const target = toArg > 0 ? resolve(process.argv[toArg + 1] ?? '') : null;
const voiceDir = target ? join(target, 'data', 'voice') : join(DATA, 'voice');
const modelsDir = target ? join(target, 'models') : join(DATA, 'models');

mkdirSync(voiceDir, { recursive: true });
copyFileSync(join(DATA, 'wakeword/model-owner-near.json'), join(voiceDir, WAKE_MODEL_FILE));
mkdirSync(join(modelsDir, 'wakeword'), { recursive: true });
copyFileSync(join(DATA, 'wakeword/model-synthetic.json'), join(modelsDir, 'wakeword', 'base.json'));

const printer = loadVoicePrinter(join(DATA, 'models', MODEL_PATHS.voiceprint));
const profileDir = join(DATA, 'recordings', 'profile');
const embeddings = readdirSync(profileDir)
  .filter((name) => name.endsWith('.wav'))
  .flatMap((name) => {
    const embedding = printer.embed(decodeWav(readFileSync(join(profileDir, name))).samples);
    return embedding ? [embedding] : [];
  });
await writeProfile(join(voiceDir, PROFILE_FILE), {
  model: VOICE_MODEL,
  vector: profileOf(embeddings),
  phrases: embeddings.length,
  createdAt: new Date().toISOString(),
});
console.log(
  `Голос для ${target ?? '.data'}: модель слова власника, базова модель, профіль з ${String(embeddings.length)} фраз — ${voiceDir}`,
);
