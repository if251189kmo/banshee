// Класифікатор слова над ознаками мовлення: маленька нейромережа (прихований шар ReLU) або,
// якщо hidden = 0, логістична регресія. Навчання — Adam з L2; навчається за хвилину на процесорі,
// тож у продукті вчиться на ПК власника з його вимов.

export interface Model {
  readonly dim: number;
  readonly hidden: number;
  /** Прихований шар: hidden × dim ваг і hidden зсувів; без шару — порожні. */
  readonly w1: Float32Array;
  readonly b1: Float32Array;
  /** Вихід: hidden ваг (або dim — для логістичної регресії) і зсув. */
  readonly w2: Float32Array;
  readonly b2: number;
  /** Середнє й розкид ознак: вхід нормується перед мережею. */
  readonly mean: Float32Array;
  readonly scale: Float32Array;
}

export interface Example {
  readonly x: Float32Array;
  readonly y: 0 | 1;
  /** Вага прикладу; типово 1. Вимови власника важать більше за синтетичні. */
  readonly weight?: number;
}

export interface TrainOptions {
  /** Нейронів у прихованому шарі; 0 — логістична регресія. */
  readonly hidden: number;
  readonly epochs: number;
  readonly learningRate: number;
  readonly l2: number;
  /** Вага позитивних прикладів: їх у сотні разів менше, ніж негативних. */
  readonly positiveWeight: number;
  readonly seed: number;
  /** Прикладів на один крок Adam; типово 1. Пакет у десятки прикладів учить у рази швидше. */
  readonly batch?: number;
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

/** Детермінований генератор випадкових чисел: експеримент повторюваний. */
export function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function normalize(model: Pick<Model, 'mean' | 'scale'>, x: Float32Array): Float32Array {
  return Float32Array.from(
    x,
    (value, index) => (value - (model.mean[index] ?? 0)) * (model.scale[index] ?? 1),
  );
}

/** Логіт моделі для нормованого входу; hiddenOut — куди покласти виходи прихованого шару. */
function forward(model: Model, input: Float32Array, hiddenOut: Float32Array): number {
  if (model.hidden === 0) {
    let sum = model.b2;
    for (let index = 0; index < model.dim; index += 1) {
      sum += (model.w2[index] ?? 0) * (input[index] ?? 0);
    }
    return sum;
  }
  let out = model.b2;
  for (let unit = 0; unit < model.hidden; unit += 1) {
    let sum = model.b1[unit] ?? 0;
    const offset = unit * model.dim;
    for (let index = 0; index < model.dim; index += 1) {
      sum += (model.w1[offset + index] ?? 0) * (input[index] ?? 0);
    }
    const activation = sum > 0 ? sum : 0;
    hiddenOut[unit] = activation;
    out += (model.w2[unit] ?? 0) * activation;
  }
  return out;
}

export function score(model: Model, x: Float32Array): number {
  return sigmoid(forward(model, normalize(model, x), new Float32Array(model.hidden)));
}

/** Те саме, що score, але без виділення пам'яті на кожен виклик: для проходу по годинах звуку. */
export function scorer(model: Model): (x: Float32Array) => number {
  const input = new Float32Array(model.dim);
  const hiddenOut = new Float32Array(model.hidden);
  return (x) => {
    for (let index = 0; index < model.dim; index += 1) {
      input[index] = ((x[index] ?? 0) - (model.mean[index] ?? 0)) * (model.scale[index] ?? 1);
    }
    return sigmoid(forward(model, input, hiddenOut));
  };
}

class Adam {
  private readonly m: Float32Array;
  private readonly v: Float32Array;
  private readonly rate: number;
  private step = 0;
  constructor(size: number, rate: number) {
    this.m = new Float32Array(size);
    this.v = new Float32Array(size);
    this.rate = rate;
  }
  begin(): void {
    this.step += 1;
  }
  /** Оновлює параметр index з градієнтом gradient; повертає зміну. */
  delta(index: number, gradient: number): number {
    const m = 0.9 * (this.m[index] ?? 0) + 0.1 * gradient;
    const v = 0.999 * (this.v[index] ?? 0) + 0.001 * gradient * gradient;
    this.m[index] = m;
    this.v[index] = v;
    const mHat = m / (1 - 0.9 ** this.step);
    const vHat = v / (1 - 0.999 ** this.step);
    return (this.rate * mHat) / (Math.sqrt(vHat) + 1e-8);
  }
}

export function train(examples: readonly Example[], options: TrainOptions): Model {
  const first = examples[0];
  if (!first) throw new Error('Немає прикладів для навчання');
  const dim = first.x.length;
  const mean = new Float32Array(dim);
  const variance = new Float32Array(dim);
  for (const { x } of examples) {
    for (let index = 0; index < dim; index += 1) mean[index] = (mean[index] ?? 0) + (x[index] ?? 0);
  }
  for (let index = 0; index < dim; index += 1) mean[index] = (mean[index] ?? 0) / examples.length;
  for (const { x } of examples) {
    for (let index = 0; index < dim; index += 1) {
      variance[index] = (variance[index] ?? 0) + ((x[index] ?? 0) - (mean[index] ?? 0)) ** 2;
    }
  }
  const scale = Float32Array.from(
    variance,
    (value) => 1 / Math.sqrt(value / examples.length + 1e-6),
  );
  const rand = random(options.seed);
  const hidden = options.hidden;
  // Усі параметри — один масив: w1, b1, w2, b2. Градієнти пакета — масив того самого розміру.
  const sizeW1 = hidden * dim;
  const sizeW2 = hidden === 0 ? dim : hidden;
  const size = sizeW1 + hidden + sizeW2 + 1;
  const params = new Float32Array(size);
  const limitW1 = Math.sqrt(6 / dim);
  const limitW2 = hidden === 0 ? 0 : Math.sqrt(6 / hidden);
  for (let index = 0; index < sizeW1; index += 1) params[index] = (rand() * 2 - 1) * limitW1;
  for (let index = sizeW1 + hidden; index < size - 1; index += 1) {
    params[index] = (rand() * 2 - 1) * limitW2;
  }
  const w1 = params.subarray(0, sizeW1);
  const b1 = params.subarray(sizeW1, sizeW1 + hidden);
  const w2 = params.subarray(sizeW1 + hidden, size - 1);
  const offsetW2 = sizeW1 + hidden;
  const model = (): Model => ({ dim, hidden, w1, b1, w2, b2: params[size - 1] ?? 0, mean, scale });
  const inputs = examples.map((example) => normalize({ mean, scale }, example.x));
  const adam = new Adam(size, options.learningRate);
  const gradients = new Float32Array(size);
  const hiddenOut = new Float32Array(hidden);
  const batch = Math.max(1, options.batch ?? 1);
  let inBatch = 0;
  const step = (): void => {
    adam.begin();
    for (let index = 0; index < size; index += 1) {
      const isWeight = index < sizeW1 || (index >= offsetW2 && index < size - 1);
      const value = params[index] ?? 0;
      const gradient = (gradients[index] ?? 0) / inBatch + (isWeight ? options.l2 * value : 0);
      params[index] = value - adam.delta(index, gradient);
    }
    gradients.fill(0);
    inBatch = 0;
  };
  const order = examples.map((_, index) => index);
  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    for (let index = order.length - 1; index > 0; index -= 1) {
      const other = Math.floor(rand() * (index + 1));
      const a = order[index] ?? 0;
      order[index] = order[other] ?? 0;
      order[other] = a;
    }
    for (const position of order) {
      const input = inputs[position];
      const example = examples[position];
      if (!input || !example) continue;
      const logit = forward(model(), input, hiddenOut);
      const weight = (example.weight ?? 1) * (example.y === 1 ? options.positiveWeight : 1);
      const error = (sigmoid(logit) - example.y) * weight;
      if (hidden === 0) {
        for (let index = 0; index < dim; index += 1) {
          gradients[offsetW2 + index] =
            (gradients[offsetW2 + index] ?? 0) + error * (input[index] ?? 0);
        }
      } else {
        for (let unit = 0; unit < hidden; unit += 1) {
          const activation = hiddenOut[unit] ?? 0;
          if (activation <= 0) continue;
          gradients[offsetW2 + unit] = (gradients[offsetW2 + unit] ?? 0) + error * activation;
          const back = error * (w2[unit] ?? 0);
          const offset = unit * dim;
          for (let index = 0; index < dim; index += 1) {
            gradients[offset + index] =
              (gradients[offset + index] ?? 0) + back * (input[index] ?? 0);
          }
          gradients[sizeW1 + unit] = (gradients[sizeW1 + unit] ?? 0) + back;
        }
      }
      gradients[size - 1] = (gradients[size - 1] ?? 0) + error;
      inBatch += 1;
      if (inBatch === batch) step();
    }
  }
  if (inBatch > 0) step();
  return { ...model(), w1: w1.slice(), b1: b1.slice(), w2: w2.slice() };
}

/** Моменти спрацювань: оцінка вища за поріг; після спрацювання — пауза refractory секунд. */
export function events(
  scores: readonly { time: number; score: number }[],
  threshold: number,
  refractory: number,
): number[] {
  const found: number[] = [];
  for (const { time, score: value } of scores) {
    const last = found.at(-1);
    if (value >= threshold && (last === undefined || time - last >= refractory)) found.push(time);
  }
  return found;
}
