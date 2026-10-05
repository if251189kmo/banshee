// npm run wakeword — крок 0.5: власна модель слова «Banshee» замість готового KWS.
// Сходинка 1 — ознаки openWakeWord + маленька нейромережа. Позитивні — синтетичні «Банші» й
// «Banshee» сотнями голосів, щоб модель вчила слово, а не тембр; варіант «з власником» додає
// 10 його вимов, як у майстрі першого запуску. Негативні — подкасти, кімната, звичайні фрази
// власника й складні приклади: де попередня модель помилялася. Сходинка 2 — голос власника
// (TitaNet) на слові разом із командою.
// Перевірка чесна: варіант «синтетика» не чув жодної вимови власника; «з власником» вчиться на
// серії 1 м і ловить серію 3 м (і навпаки). Серій з музикою, половини команд власника й ≥ 10 год
// подкастів з епізодів, яких не було в навчанні, не бачив жоден. Результат — .data/wakeword/results.json.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { clipStats, frameLevels, pcmOf, wakeStats, type Segment } from '../recorder/analyze.ts';
import { loadManifest } from '../recorder/storage.ts';
import { events, random, scorer, train, type Example, type Model } from './classifier.ts';
import {
  cachedEmbeddings,
  EMBEDDING_DIM,
  embeddingEndSec,
  embeddingsOf,
  loadFeatureModels,
  sequenceAt,
  SEQUENCE,
  type FeatureModels,
} from './features.ts';
import { groupEpisodes, splitEpisodes, type Episode } from './pods.ts';
import { manySpeakerWords, syntheticWords, type SyntheticWord } from './synthetic.ts';
import { createVerifier, VOICE_THRESHOLD } from './verify.ts';

const RECORDINGS = resolve('.data/recordings');
const PODS = resolve('.data/background/uk-pods/clips');
const OUT = resolve('.data/wakeword');
const RATE = 16_000;
/** Кліпи подкастів, де звучить «банші» (фільм «Банші Інішеріну»): у хибні спрацювання не рахуються. */
const BANSHEE_CLIPS = new Set([
  '14e1f1fc-769a-4cb2-99bc-39f8d7407778_0014.wav',
  '79c23624-9fca-4b84-926c-054afe50eba7_0173.wav',
  '14e1f1fc-769a-4cb2-99bc-39f8d7407778_0245.wav',
  '4280b146-83d4-4755-bbc0-7baaad56ca6e_0163.wav',
  '14e1f1fc-769a-4cb2-99bc-39f8d7407778_0081.wav',
]);
const TEST_HOURS = 10;
const SPLIT_SEED = 3;
/** Вимов «Banshee» англійською моделлю на 904 дикторів. */
const MANY_COUNT = 600;
/** Вимов власника для варіанта «з власником» — стільки ж, скільки в майстрі першого запуску. */
const OWNER_WORDS = 10;
/** Вага вимови власника проти синтетичної: його вимов у десятки разів менше. */
const OWNER_WEIGHT = 8;
const NEGATIVE_CAP = 50_000;
const HARD_CAP = 30_000;
const HARD_MIN_SCORE = 0.3;
const AUGMENT_COPIES = 4;
const REFRACTORY = 1.5;
/** Скільки спрацювань на тестових подкастах перевіряти голосом на поріг: TitaNet ~30 мс на кожне. */
const VERIFY_SAMPLE = 600;
/** Голос перевіряємо на 1,6 с до спрацювання й 2 с після: слово разом із командою. */
const VERIFY_BEFORE = 1.6;
const VERIFY_AFTER = 2;
const THRESHOLDS = [0.5, 0.9, 0.97, 0.99, 0.997, 0.999, 0.9997];
const TRAIN_OPTIONS = {
  hidden: 32,
  epochs: 8,
  learningRate: 2e-3,
  l2: 1e-4,
  seed: 11,
  batch: 16,
} as const;

type Scores = { time: number; score: number }[];

interface Series {
  readonly name: string;
  readonly samples: Float32Array;
  readonly words: readonly Segment[];
}

const loadPcm = (path: string): Float32Array => Float32Array.from(pcmOf(readFileSync(path)));

function loadSeries(name: string): Series {
  const pcm = pcmOf(readFileSync(join(RECORDINGS, 'wake', `${name}.wav`)));
  return {
    name,
    samples: Float32Array.from(pcm),
    words: name.endsWith('quiet') ? wakeStats(frameLevels(pcm), []).words : [],
  };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function concat(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Мова запису без тиші по краях (поля 100 мс) — як відрізок VAD у продукті. */
function trimmed(samples: Float32Array): Float32Array {
  const speech = clipStats(Int16Array.from(samples)).speech;
  if (!speech) return samples;
  return samples.slice(
    Math.max(0, Math.round(((speech.startMs - 100) * RATE) / 1000)),
    Math.min(samples.length, Math.round(((speech.endMs + 100) * RATE) / 1000)),
  );
}

/** Рівномірно розкидані count елементів: вимови з різних моментів запису. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from(
    { length: count },
    (_, index) => items[Math.floor((index * items.length) / count)],
  ).filter((item): item is T => item !== undefined);
}

const secondsOf = (clip: string): number => (statSync(join(PODS, clip)).size - 44) / (RATE * 2);
const episodeAudio = (episode: Episode): Float32Array =>
  concat(episode.clips.map((clip) => loadPcm(join(PODS, clip))));
const episodeKey = (episode: Episode): string => `episode-${episode.id}`;
const episodeEmbeddings = (models: FeatureModels, episode: Episode) =>
  cachedEmbeddings(models, episodeKey(episode), () => episodeAudio(episode));

function sequencesOf(embeddings: readonly Float32Array[], step: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let index = SEQUENCE - 1; index < embeddings.length; index += step) {
    const sequence = sequenceAt(embeddings, index);
    if (sequence) out.push(sequence);
  }
  return out;
}

function scoresOf(model: Model, embeddings: readonly Float32Array[]): Scores {
  const scoreOf = scorer(model);
  const buffer = new Float32Array(SEQUENCE * EMBEDDING_DIM);
  const out: Scores = [];
  for (let index = SEQUENCE - 1; index < embeddings.length; index += 1) {
    if (sequenceAt(embeddings, index, buffer)) {
      out.push({ time: embeddingEndSec(index), score: scoreOf(buffer) });
    }
  }
  return out;
}

/** Позитивні приклади: послідовності, що закінчуються в кінці слова (−80…+320 мс). */
function positivesAt(embeddings: readonly Float32Array[], wordEndSec: number, offsetSec: number) {
  const out: Float32Array[] = [];
  embeddings.forEach((_, index) => {
    const end = embeddingEndSec(index) + offsetSec;
    if (end >= wordEndSec - 0.08 && end <= wordEndSec + 0.32) {
      const sequence = sequenceAt(embeddings, index);
      if (sequence) out.push(sequence);
    }
  });
  return out;
}

/** Слово на тлі чужої мови подкастів, 3–15 дБ, гучність ±6 дБ: стійкість до розмов і ТБ. */
async function augmented(
  models: FeatureModels,
  audio: Float32Array,
  word: { startSec: number; endSec: number },
  noise: readonly Float32Array[],
  rand: () => number,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let copy = 0; copy < AUGMENT_COPIES; copy += 1) {
    const from = Math.max(0, Math.round((word.endSec - 2.4) * RATE));
    const to = Math.min(audio.length, Math.round((word.endSec + 0.6) * RATE));
    const gain = 10 ** (((rand() * 2 - 1) * 6) / 20);
    const clip = audio.slice(from, to).map((value) => value * gain);
    const background = noise[Math.floor(rand() * noise.length)];
    if (!background || background.length === 0) continue;
    const wordPart = clip.subarray(
      Math.max(0, Math.round(word.startSec * RATE) - from),
      Math.round(word.endSec * RATE) - from,
    );
    const mix = rms(wordPart) / (rms(background) * 10 ** ((3 + rand() * 12) / 20) || 1);
    const start = Math.floor(rand() * Math.max(1, background.length - clip.length));
    for (let index = 0; index < clip.length; index += 1) {
      const value =
        (clip[index] ?? 0) + (background[(start + index) % background.length] ?? 0) * mix;
      clip[index] = Math.max(-32768, Math.min(32767, value));
    }
    out.push(...positivesAt(await embeddingsOf(models, clip), word.endSec, from / RATE));
  }
  return out;
}

async function wordPositives(
  models: FeatureModels,
  series: Series,
  embeddings: readonly Float32Array[],
  words: readonly Segment[],
  noise: readonly Float32Array[],
  rand: () => number,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (const word of words) {
    const span = { startSec: word.startMs / 1000, endSec: word.endMs / 1000 };
    out.push(...positivesAt(embeddings, span.endSec, 0));
    out.push(...(await augmented(models, series.samples, span, noise, rand)));
  }
  return out;
}

async function syntheticPositives(
  models: FeatureModels,
  words: readonly SyntheticWord[],
  noise: readonly Float32Array[],
  rand: () => number,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (const word of words) {
    out.push(...positivesAt(await embeddingsOf(models, word.samples), word.endSec, 0));
    const span = { startSec: word.endSec - 0.7, endSec: word.endSec };
    out.push(...(await augmented(models, word.samples, span, noise, rand)));
  }
  return out;
}

/** Кімната між словами серії: послідовності, що не зачіпають жодного слова. */
function seriesGaps(series: Series, embeddings: readonly Float32Array[]): Float32Array[] {
  const out: Float32Array[] = [];
  embeddings.forEach((_, index) => {
    const end = embeddingEndSec(index);
    const touches = series.words.some(
      (word) => word.startMs / 1000 < end + 0.2 && word.endMs / 1000 > end - 2.2,
    );
    const sequence = !touches && index % 2 === 0 ? sequenceAt(embeddings, index) : null;
    if (sequence) out.push(sequence);
  });
  return out;
}

/** Рівномірна випадкова вибірка cap елементів з потоку; елемент створюється, лише якщо його беруть. */
function reservoir<T>(cap: number, rand: () => number) {
  const items: T[] = [];
  let seen = 0;
  return {
    items,
    offer(make: () => T | null): void {
      seen += 1;
      const slot = items.length < cap ? items.length : Math.floor(rand() * seen);
      if (slot >= cap) return;
      const item = make();
      if (item) items[slot] = item;
    },
  };
}

/** Складні негативні: місця подкастів для навчання, де модель дає ≥ HARD_MIN_SCORE. */
async function mine(
  models: FeatureModels,
  model: Model,
  episodes: readonly Episode[],
): Promise<Float32Array[]> {
  const scoreOf = scorer(model);
  const buffer = new Float32Array(SEQUENCE * EMBEDDING_DIM);
  let found: { x: Float32Array; s: number }[] = [];
  for (const episode of episodes) {
    const embeddings = await episodeEmbeddings(models, episode);
    for (let index = SEQUENCE - 1; index < embeddings.length; index += 1) {
      if (!sequenceAt(embeddings, index, buffer)) continue;
      const s = scoreOf(buffer);
      if (s >= HARD_MIN_SCORE) {
        found.push({ x: buffer.slice(), s });
        index += 2; // сусідні кроки майже однакові
      }
    }
    if (found.length > 2 * HARD_CAP) found = found.sort((a, b) => b.s - a.s).slice(0, HARD_CAP);
  }
  return found
    .sort((a, b) => b.s - a.s)
    .slice(0, HARD_CAP)
    .map((item) => item.x);
}

function hitsOf(wordEnds: readonly number[], detections: readonly number[]) {
  const used = new Set<number>();
  let hits = 0;
  for (const end of wordEnds) {
    const found = detections.findIndex(
      (time, index) => !used.has(index) && time >= end - 0.3 && time <= end + 1.0,
    );
    if (found >= 0) {
      used.add(found);
      hits += 1;
    }
  }
  return { hits, extra: detections.length - used.size };
}

function capped<T>(items: readonly T[], cap: number, rand: () => number): T[] {
  if (items.length <= cap) return [...items];
  return items
    .map((item) => ({ item, key: rand() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, cap)
    .map(({ item }) => item);
}

const seconds = (started: number): string => ((performance.now() - started) / 1000).toFixed(0);

async function main(): Promise<void> {
  const started = performance.now();
  const rand = random(7);
  const verify = await createVerifier();

  // Подкасти: епізоди для перевірки не потрапляють у навчання.
  const episodes = groupEpisodes(
    readdirSync(PODS).filter(
      (name) => name.endsWith('.wav') && !name.startsWith('._') && !BANSHEE_CLIPS.has(name),
    ),
    secondsOf,
  );
  const split = splitEpisodes(episodes, TEST_HOURS * 3600, SPLIT_SEED);
  const hours = (list: readonly Episode[]) =>
    list.reduce((sum, episode) => sum + episode.seconds, 0) / 3600;
  const fast = await loadFeatureModels(4);
  let computedSec = 0;
  let computedAudioSec = 0;
  for (const episode of episodes) {
    if (existsSync(join(OUT, 'cache', `${episodeKey(episode)}.f32`))) continue;
    const from = performance.now();
    await episodeEmbeddings(fast, episode);
    computedSec += (performance.now() - from) / 1000;
    computedAudioSec += episode.seconds;
  }
  const models = await loadFeatureModels(2);
  console.log(
    `Подкасти: навчання ${String(split.train.length)} епізодів, ${hours(split.train).toFixed(1)} год; ` +
      `перевірка ${String(split.test.length)}, ${hours(split.test).toFixed(1)} год · ${seconds(started)} с`,
  );

  const noiseClips = capped(
    split.train.flatMap((episode) => episode.clips),
    200,
    rand,
  );
  const noise = noiseClips.map((clip) => loadPcm(join(PODS, clip)));
  const series = ['near-quiet', 'far-quiet', 'near-music', 'far-music'].map(loadSeries);
  const [near, far, nearMusic, farMusic] = series;
  if (!near || !far || !nearMusic || !farMusic) throw new Error('Немає серій «Banshee»');
  const nearEmbeddings = await cachedEmbeddings(models, 'wake-near-quiet', () => near.samples);
  const farEmbeddings = await cachedEmbeddings(models, 'wake-far-quiet', () => far.samples);
  const musicEmbeddings = [
    await cachedEmbeddings(models, 'wake-near-music', () => nearMusic.samples),
    await cachedEmbeddings(models, 'wake-far-music', () => farMusic.samples),
  ];
  const nearTrain = spread(near.words, OWNER_WORDS);
  const farTrain = spread(far.words, OWNER_WORDS);
  const toExamples = (list: readonly Float32Array[], weight = 1): Example[] =>
    list.map((x) => ({ x, y: 1, weight }));
  const ownerNear = toExamples(
    await wordPositives(models, near, nearEmbeddings, nearTrain, noise, rand),
    OWNER_WEIGHT,
  );
  const ownerFar = toExamples(
    await wordPositives(models, far, farEmbeddings, farTrain, noise, rand),
    OWNER_WEIGHT,
  );

  const synthetic = [...syntheticWords(), ...manySpeakerWords(MANY_COUNT, 5)];
  const synthPositives = toExamples(await syntheticPositives(models, synthetic, noise, rand));

  // Звичайні фрази власника: половина команд — «не те слово» для навчання, половина — для перевірки.
  const manifest = await loadManifest(RECORDINGS);
  const commands = manifest.entries
    .filter((item) => item.set === 'commands')
    .sort((a, b) => a.file.localeCompare(b.file));
  const ownerTrain = commands.filter((_, index) => index % 2 === 0);
  const ownerTest = commands.filter((_, index) => index % 2 === 1);
  const profileNoWord = manifest.entries.filter(
    (item) => item.set === 'profile' && !['profile-1.wav', 'profile-5.wav'].includes(item.file),
  );
  const ownerEmbeddings = async (entry: { set: string; file: string }) =>
    cachedEmbeddings(models, `owner-${entry.set}-${entry.file}`, () =>
      loadPcm(join(RECORDINGS, entry.set, entry.file)),
    );
  const sampler = reservoir<Float32Array>(NEGATIVE_CAP, rand);
  for (const episode of split.train) {
    const embeddings = await episodeEmbeddings(models, episode);
    for (let index = SEQUENCE - 1; index < embeddings.length; index += 3) {
      sampler.offer(() => sequenceAt(embeddings, index));
    }
  }
  const baseNegatives = [...sampler.items];
  for (const entry of [...ownerTrain, ...profileNoWord]) {
    baseNegatives.push(...sequencesOf(await ownerEmbeddings(entry), 1));
  }
  for (const entry of manifest.entries.filter((item) => item.set === 'background')) {
    const path = join(RECORDINGS, entry.set, entry.file);
    baseNegatives.push(
      ...sequencesOf(await cachedEmbeddings(models, `room-${entry.file}`, () => loadPcm(path)), 2),
    );
  }
  console.log(
    `Дані: синтетичних вимов ${String(synthetic.length)} → прикладів ${String(synthPositives.length)}; ` +
      `власника ${String(ownerNear.length)} + ${String(ownerFar.length)}; негативних ${String(baseNegatives.length)} · ${seconds(started)} с`,
  );

  const fit = (positives: readonly Example[], negatives: readonly Float32Array[]): Model => {
    const mass = positives.reduce((sum, example) => sum + (example.weight ?? 1), 0);
    return train([...positives, ...negatives.map((x): Example => ({ x, y: 0 }))], {
      ...TRAIN_OPTIONS,
      positiveWeight: Math.max(1, negatives.length / mass / 4),
    });
  };
  // Два раунди пошуку складних негативних на подкастах для навчання.
  const hard: Float32Array[] = [];
  for (let round = 1; round <= 2; round += 1) {
    const model = fit(synthPositives, [...baseNegatives, ...hard]);
    const found = await mine(models, model, split.train);
    hard.push(...found);
    console.log(
      `Раунд ${String(round)}: складних негативних ${String(found.length)} · ${seconds(started)} с`,
    );
  }
  const negatives = [...baseNegatives, ...hard];
  const variants = [
    {
      id: 'synthetic',
      label: 'синтетика',
      model: fit(synthPositives, negatives),
      // Модель не чула власника: перевіряється на всіх його вимовах.
      tests: [
        { series: near, embeddings: nearEmbeddings, words: near.words },
        { series: far, embeddings: farEmbeddings, words: far.words },
      ],
      music: musicEmbeddings,
    },
    {
      id: 'owner-near',
      label: 'з власником, 1 м',
      model: fit(
        [...synthPositives, ...ownerNear],
        [...negatives, ...seriesGaps(near, nearEmbeddings)],
      ),
      tests: [{ series: far, embeddings: farEmbeddings, words: far.words }],
      music: musicEmbeddings.slice(1),
    },
    {
      id: 'owner-far',
      label: 'з власником, 3 м',
      model: fit(
        [...synthPositives, ...ownerFar],
        [...negatives, ...seriesGaps(far, farEmbeddings)],
      ),
      tests: [{ series: near, embeddings: nearEmbeddings, words: near.words }],
      music: musicEmbeddings.slice(0, 1),
    },
  ];
  console.log(`Навчено ${String(variants.length)} варіанти · ${seconds(started)} с`);
  await mkdir(OUT, { recursive: true });
  for (const variant of variants) {
    const { model } = variant;
    await writeFile(
      join(OUT, `model-${variant.id}.json`),
      JSON.stringify({
        ...model,
        w1: Array.from(model.w1),
        b1: Array.from(model.b1),
        w2: Array.from(model.w2),
        mean: Array.from(model.mean),
        scale: Array.from(model.scale),
      }),
    );
  }

  // Звук для перевірок, спільний для всіх варіантів.
  const testCommands = ownerTest.map((entry) =>
    trimmed(loadPcm(join(RECORDINGS, entry.set, entry.file))),
  );
  const voiceAround = (samples: Float32Array, time: number): number =>
    verify(
      samples.subarray(
        Math.max(0, Math.round((time - VERIFY_BEFORE) * RATE)),
        Math.min(samples.length, Math.round((time + VERIFY_AFTER) * RATE)),
      ),
    );
  const bansheeAudio = [...BANSHEE_CLIPS].map((clip) => loadPcm(join(PODS, clip)));
  const bansheeEmbeddings: Float32Array[][] = [];
  for (const samples of bansheeAudio) bansheeEmbeddings.push(await embeddingsOf(models, samples));
  const ownerTestEmbeddings: Float32Array[][] = [];
  for (const entry of ownerTest) ownerTestEmbeddings.push(await ownerEmbeddings(entry));
  const runningEmbeddings: Float32Array[][] = [];
  for (const file of ['profile-1.wav', 'profile-5.wav']) {
    runningEmbeddings.push(await ownerEmbeddings({ set: 'profile', file }));
  }
  const testEpisodeEmbeddings: Float32Array[][] = [];
  for (const episode of split.test) {
    testEpisodeEmbeddings.push(await episodeEmbeddings(models, episode));
  }
  const testSec = hours(split.test) * 3600;
  let cachedEpisode = -1;
  let cachedAudio: Float32Array = new Float32Array(0);
  const testAudio = (index: number): Float32Array => {
    if (index !== cachedEpisode) {
      const episode = split.test[index];
      cachedAudio = episode ? episodeAudio(episode) : new Float32Array(0);
      cachedEpisode = index;
    }
    return cachedAudio;
  };

  const report = [];
  for (const variant of variants) {
    const { model } = variant;
    // «Banshee, команда»: слово власника + 0,3 с + його команда з тестової половини.
    const phrases: { peak: number; voice: number }[] = [];
    for (const test of variant.tests) {
      for (const [index, word] of test.words.entries()) {
        const wordAudio = test.series.samples.slice(
          Math.max(0, Math.round((word.startMs / 1000 - 0.1) * RATE)),
          Math.round((word.endMs / 1000 + 0.1) * RATE),
        );
        const command = testCommands[index % testCommands.length] ?? new Float32Array(0);
        const lead = new Float32Array(Math.round(1.4 * RATE));
        const audio = concat([lead, wordAudio, new Float32Array(Math.round(0.3 * RATE)), command]);
        const wordEnd = (lead.length + wordAudio.length) / RATE - 0.1;
        const inWindow = scoresOf(model, await embeddingsOf(models, audio)).filter(
          ({ time }) => time >= wordEnd - 0.3 && time <= wordEnd + 1,
        );
        const best = inWindow.reduce((a, b) => (b.score > a.score ? b : a), {
          time: wordEnd,
          score: 0,
        });
        phrases.push({ peak: best.score, voice: voiceAround(audio, best.time) });
      }
    }
    const scoreStart = performance.now();
    const testScores = testEpisodeEmbeddings.map((embeddings) => scoresOf(model, embeddings));
    const scoreSecPerHour = (performance.now() - scoreStart) / 1000 / (testSec / 3600);
    const seriesScores = variant.tests.map((test) => scoresOf(model, test.embeddings));
    const musicScores = variant.music.map((embeddings) => scoresOf(model, embeddings));
    const ownerScores = ownerTestEmbeddings.map((embeddings) => scoresOf(model, embeddings));
    const runningScores = runningEmbeddings.map((embeddings) => scoresOf(model, embeddings));
    const bansheeScores = bansheeEmbeddings.map((embeddings) => scoresOf(model, embeddings));
    const voiceCache = new Map<string, number>();
    const rows = [];
    for (const threshold of THRESHOLDS) {
      const at = (scores: Scores) => events(scores, threshold, REFRACTORY);
      let hits = 0;
      let extra = 0;
      variant.tests.forEach((test, index) => {
        const result = hitsOf(
          test.words.map((word) => word.endMs / 1000),
          at(seriesScores[index] ?? []),
        );
        hits += result.hits;
        extra += result.extra;
      });
      const words = variant.tests.reduce((sum, test) => sum + test.words.length, 0);
      const found = testScores.flatMap((scores, episode) =>
        at(scores).map((time) => ({ episode, time })),
      );
      const sample = capped(found, VERIFY_SAMPLE, random(Math.round(threshold * 10_000))).sort(
        (a, b) => a.episode - b.episode,
      );
      const passed = sample.filter(({ episode, time }) => {
        const key = `${String(episode)}:${time.toFixed(2)}`;
        const known = voiceCache.get(key);
        const value = known ?? voiceAround(testAudio(episode), time);
        voiceCache.set(key, value);
        return value >= VOICE_THRESHOLD;
      }).length;
      const withVoice = sample.length > 0 ? (passed / sample.length) * found.length : 0;
      const phraseHits = phrases.filter((phrase) => phrase.peak >= threshold);
      const row = {
        threshold,
        missPct: (100 * (words - hits)) / words,
        hits: `${String(hits)} з ${String(words)}`,
        extraInSeries: extra,
        phraseMissPct:
          (100 *
            (phrases.length -
              phraseHits.filter((phrase) => phrase.voice >= VOICE_THRESHOLD).length)) /
          Math.max(1, phrases.length),
        music: musicScores.map((scores) => at(scores).length),
        falsePer10h: (found.length * 36_000) / testSec,
        falseWithVoicePer10h: (withVoice * 36_000) / testSec,
        ownerCommandsFalse: ownerScores.reduce((sum, scores) => sum + at(scores).length, 0),
        bansheeInOwnerSpeech: runningScores.filter((scores) => at(scores).length > 0).length,
        bansheeInPodcasts: {
          stage1: bansheeScores.filter((scores) => at(scores).length > 0).length,
          withVoice: bansheeScores.filter((scores, index) =>
            at(scores).some(
              (time) =>
                voiceAround(bansheeAudio[index] ?? new Float32Array(0), time) >= VOICE_THRESHOLD,
            ),
          ).length,
        },
      };
      rows.push(row);
      console.log(
        `${variant.label}, поріг ${String(threshold)}: пропуски ${row.missPct.toFixed(0)} % (${row.hits}), ` +
          `«Banshee, команда» з голосом — ${row.phraseMissPct.toFixed(0)} % · музика ${row.music.join('/')} з 25 · ` +
          `хибних на 10 год ${row.falsePer10h.toFixed(0)} → з голосом ${row.falseWithVoicePer10h.toFixed(1)} · ` +
          `у ${String(ownerTest.length)} командах власника ${String(row.ownerCommandsFalse)} · ` +
          `«банші» в подкастах ${String(row.bansheeInPodcasts.stage1)}→${String(row.bansheeInPodcasts.withVoice)} з 5`,
      );
    }
    report.push({ id: variant.id, label: variant.label, scoreSecPerHour, rows });
  }

  const featureSecPerHour = computedAudioSec > 0 ? computedSec / (computedAudioSec / 3600) : null;
  await writeFile(
    join(OUT, 'results.json'),
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        split: {
          trainEpisodes: split.train.length,
          trainHours: hours(split.train),
          testEpisodes: split.test.length,
          testHours: hours(split.test),
        },
        synthetic: synthetic.length,
        ownerWords: OWNER_WORDS,
        negatives: { base: baseNegatives.length, hard: hard.length },
        trainOptions: TRAIN_OPTIONS,
        featureSecPerHour4Threads: featureSecPerHour,
        variants: report,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nЗвіт: .data/wakeword/results.json · ${seconds(started)} с`);
}

await main();
