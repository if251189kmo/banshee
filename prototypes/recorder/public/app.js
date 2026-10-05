// Сторінка записувача кроку 0.2: підказки власнику, запис і збереження WAV на сервер записувача.
import { listMicrophones, openMicrophone } from './audio.js';
import { SAMPLE_RATE, concatInt16, encodeWav, floatToInt16, levels } from './wav.js';

const token = new URLSearchParams(location.search).get('token') ?? '';
window.history.replaceState(null, '', '/');

/** Скільки звуку до натискання пробілу додається на початок: 5 блоків по 100 мс. */
const PREROLL_BLOCKS = 5;
const TAIL_MS = 300;
const MIN_CLIP_SEC = 0.8;
/** Banshee поки слухає Bluetooth-гарнітуру в режимі дзвінка (рішення власника 2026-10-04). */
const OWNER_MIC = /hands-free/i;
const OTHER_MIC_WARNING =
  'Banshee поки слухає Bluetooth-гарнітуру: записуй нею, інакше виміри етапу 0 стосуватимуться не того мікрофона.';

const TABS = [
  { id: 'commands', title: 'Команди' },
  { id: 'wake', title: '«Banshee»' },
  { id: 'profile', title: 'Профіль голосу' },
  { id: 'foreign', title: 'Чужі голоси' },
  { id: 'background', title: 'Фон' },
];

const ui = {
  tabs: document.getElementById('tabs'),
  panel: document.getElementById('panel'),
  status: document.getElementById('status'),
  mic: document.getElementById('mic'),
  processing: document.getElementById('processing'),
  meter: document.getElementById('meter-bar'),
  meterText: document.getElementById('meter-text'),
};

const state = {
  plan: undefined,
  manifest: { entries: [] },
  tab: 'commands',
  index: { commands: 0, profile: 0 },
  /** @type {undefined | { label: string, deviceId: string, sampleRate: number, close(): Promise<void> }} */
  mic: undefined,
  /** Останні блоки — для початку запису до натискання пробілу. */
  recent: [],
  /** Куди йдуть блоки під час запису. */
  sink: undefined,
  /** Поточний запис фрази: пробіл почав, пробіл закінчить. */
  clip: undefined,
  /** Довга дія (серія, кліпи, фон): її можна зупинити Esc. */
  job: undefined,
  saving: false,
};

// ---------- Допоміжне ----------

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'onclick') node.addEventListener('click', value);
    else if (value !== false && value !== undefined) node.setAttribute(name, String(value));
  }
  for (const child of children.flat()) {
    if (child !== undefined && child !== null && child !== false) node.append(child);
  }
  return node;
}

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (samples) => samples / SAMPLE_RATE;
const pad = (value) => String(value).padStart(2, '0');
const finite = (value) => (Number.isFinite(value) ? value : null);

function entry(set, file) {
  return state.manifest.entries.find((item) => item.set === set && item.file === file);
}

function entriesOf(set) {
  return state.manifest.entries.filter((item) => item.set === set);
}

function levelWarning(level) {
  if (level.peakDbfs !== null && level.peakDbfs > -1) {
    return ' Перевантаження: говори тихіше, відійди від мікрофона або зменш його рівень у параметрах звуку Windows.';
  }
  if (level.peakDbfs === null || level.peakDbfs < -35) {
    return ' Дуже тихо: підійди ближче або перевір рівень мікрофона в параметрах звуку Windows.';
  }
  return '';
}

// ---------- Сервер ----------

async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), 'x-recorder-token': token },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${String(response.status)}`);
  return body;
}

/** Зберігає запис; повертає рівні сигналу. */
async function save(set, file, samples, extra = {}) {
  const raw = levels(samples);
  const level = { peakDbfs: finite(raw.peakDbfs), rmsDbfs: finite(raw.rmsDbfs) };
  const meta = {
    ...extra,
    ...level,
    device: state.mic?.label ?? '',
    processing: ui.processing.checked,
  };
  const body = await api(`/api/recordings/${set}/${file}`, {
    method: 'PUT',
    headers: {
      'content-type': 'audio/wav',
      'x-recorder-meta': encodeURIComponent(JSON.stringify(meta)),
    },
    body: encodeWav(samples),
  });
  state.manifest = body.manifest;
  renderTabs();
  return level;
}

// ---------- Мікрофон ----------

function handleFrame(frame) {
  const block = floatToInt16(frame);
  state.recent.push(block);
  if (state.recent.length > PREROLL_BLOCKS) state.recent.shift();
  state.sink?.(block);
  const { rmsDbfs } = levels(block);
  const width = Number.isFinite(rmsDbfs)
    ? Math.max(0, Math.min(100, ((rmsDbfs + 60) / 60) * 100))
    : 0;
  ui.meter.style.width = `${String(width)}%`;
  ui.meterText.textContent = Number.isFinite(rmsDbfs) ? `${String(Math.round(rmsDbfs))} dB` : '—';
}

async function fillMicrophones(selectedId) {
  const microphones = await listMicrophones();
  ui.mic.replaceChildren(
    ...microphones.map((item) =>
      el('option', { value: item.id, selected: item.id === selectedId }, item.label),
    ),
  );
}

async function startMicrophone() {
  await state.mic?.close();
  state.mic = undefined;
  try {
    setStatus('Дозволь браузеру доступ до мікрофона — запит угорі вікна.', 'warn');
    state.mic = await openMicrophone({
      deviceId: ui.mic.value || undefined,
      processing: ui.processing.checked,
      onFrame: handleFrame,
    });
    await fillMicrophones(state.mic.deviceId);
    const ownerMic = OWNER_MIC.test(state.mic.label);
    setStatus(
      `Мікрофон: ${state.mic.label}, ${String(state.mic.sampleRate)} Гц.${ownerMic ? '' : ' ' + OTHER_MIC_WARNING}`,
      ownerMic ? 'ok' : 'warn',
    );
  } catch (error) {
    setStatus(`Мікрофон недоступний: ${error.message}`, 'error');
  }
  render();
}

function capture({ preroll }) {
  const blocks = preroll ? [...state.recent] : [];
  let count = blocks.reduce((sum, block) => sum + block.length, 0);
  state.sink = (block) => {
    blocks.push(block);
    count += block.length;
  };
  return {
    samples: () => count,
    async stop(tailMs) {
      if (tailMs > 0) await wait(tailMs);
      state.sink = undefined;
      return concatInt16(blocks);
    },
  };
}

// ---------- Фрази: команди й профіль ----------

function items(set) {
  return set === 'commands' ? state.plan.commands : state.plan.profile;
}

function moveTo(set, index) {
  const list = items(set);
  state.index[set] = Math.max(0, Math.min(list.length - 1, index));
  render();
}

function nextMissing(set) {
  const list = items(set);
  const from = state.index[set];
  for (let step = 1; step <= list.length; step += 1) {
    const index = (from + step) % list.length;
    if (!entry(set, `${list[index].id}.wav`)) return index;
  }
  return Math.min(from + 1, list.length - 1);
}

async function toggleClip(set) {
  if (!state.mic || state.saving || state.job) return;
  const item = items(set)[state.index[set]];
  if (!state.clip) {
    state.clip = capture({ preroll: true });
    setStatus('Запис… Пробіл — завершити.', 'rec');
    render();
    return;
  }
  state.saving = true;
  const samples = await state.clip.stop(TAIL_MS);
  state.clip = undefined;
  try {
    if (seconds(samples.length) < MIN_CLIP_SEC) {
      setStatus('Закоротко — запиши ще раз.', 'warn');
      return;
    }
    const level = await save(set, `${item.id}.wav`, samples, { text: item.text });
    const warning = levelWarning(level);
    setStatus(
      `Збережено «${item.id}», ${seconds(samples.length).toFixed(1)} с.${warning}`,
      warning ? 'warn' : 'ok',
    );
    if (!warning) state.index[set] = nextMissing(set);
  } catch (error) {
    setStatus(`Не збережено: ${error.message}`, 'error');
  } finally {
    state.saving = false;
    render();
  }
}

function renderPhrases(set) {
  const list = items(set);
  const index = state.index[set];
  const item = list[index];
  const done = entry(set, `${item.id}.wav`);
  const intro =
    set === 'commands'
      ? 'Читай команду так, як сказав би Banshee: звичайним голосом, з місця, де зазвичай сидиш. Слово «Banshee» на початку не потрібне.'
      : 'Фрази для відбитка голосу: спокійно, звичайним голосом, з місця, де зазвичай сидиш.';
  return [
    el('p', { class: 'hint' }, intro),
    el('p', { class: 'counter' }, `${String(index + 1)} з ${String(list.length)} · ${item.id}`),
    el('p', { class: `prompt${state.clip ? ' recording' : ''}` }, item.text),
    el(
      'p',
      { class: done ? 'done' : 'todo' },
      done ? `✓ записано, ${done.durationSec.toFixed(1)} с` : 'ще не записано',
    ),
    el(
      'div',
      { class: 'actions' },
      el(
        'button',
        { onclick: () => moveTo(set, index - 1), disabled: Boolean(state.clip) },
        '← Назад',
      ),
      el(
        'button',
        { class: 'primary', onclick: () => void toggleClip(set), disabled: !state.mic },
        state.clip ? 'Завершити (пробіл)' : done ? 'Перезаписати (пробіл)' : 'Записати (пробіл)',
      ),
      el(
        'button',
        { onclick: () => moveTo(set, index + 1), disabled: Boolean(state.clip) },
        'Далі →',
      ),
    ),
    el('p', { class: 'keys' }, 'Пробіл — почати й завершити · ← → — інша фраза'),
  ];
}

// ---------- Довгі дії: серія «Banshee», чужі голоси, фон ----------

function startJob(kind) {
  const job = { kind, cancelled: false, view: {} };
  state.job = job;
  return job;
}

function finishJob() {
  state.job = undefined;
  state.sink = undefined;
  render();
}

async function runWakeSeries(series) {
  if (!state.mic || state.job) return;
  const job = startJob('wake');
  const { intervalMs, leadInMs } = state.plan.wake;
  const recording = capture({ preroll: false });
  const started = performance.now();
  const cuesMs = [];
  try {
    for (let left = Math.ceil(leadInMs / 1000); left > 0; left -= 1) {
      job.view = {
        big: String(left),
        small: `Серія «${series.label}» почнеться за ${String(left)} с`,
      };
      render();
      await wait(1000);
      if (job.cancelled) throw new Error('скасовано');
    }
    for (let cue = 0; cue < series.count; cue += 1) {
      const at = started + leadInMs + cue * intervalMs;
      while (performance.now() < at) {
        if (job.cancelled) throw new Error('скасовано');
        await wait(20);
      }
      cuesMs.push(Math.round((recording.samples() / SAMPLE_RATE) * 1000));
      job.view = {
        big: 'Banshee',
        small: `${String(cue + 1)} з ${String(series.count)}`,
        cue: true,
      };
      render();
      await wait(900);
      job.view = { big: '…', small: `${String(cue + 1)} з ${String(series.count)}` };
      render();
    }
    await wait(intervalMs);
    const samples = await recording.stop(0);
    const level = await save('wake', `${series.id}.wav`, samples, {
      condition: series.label,
      cuesMs,
    });
    setStatus(`Серію «${series.label}» збережено.${levelWarning(level)}`, 'ok');
  } catch (error) {
    await recording.stop(0);
    setStatus(
      error.message === 'скасовано'
        ? 'Серію скасовано, нічого не збережено.'
        : `Не збережено: ${error.message}`,
      error.message === 'скасовано' ? 'warn' : 'error',
    );
  } finally {
    finishJob();
  }
}

async function runForeign() {
  if (!state.mic || state.job) return;
  const { count, seconds: clipSeconds } = state.plan.foreign;
  const missing = [];
  for (let index = 1; index <= count; index += 1) {
    if (!entry('foreign', `foreign-${pad(index)}.wav`)) missing.push(index);
  }
  const queue = missing.length > 0 ? missing : Array.from({ length: count }, (_, i) => i + 1);
  const job = startJob('foreign');
  let saved = 0;
  try {
    for (const index of queue) {
      const recording = capture({ preroll: false });
      const until = performance.now() + clipSeconds * 1000;
      while (performance.now() < until) {
        if (job.cancelled) throw new Error('скасовано');
        job.view = {
          big: `${String(index)} з ${String(count)}`,
          small: `Кліп ${String(Math.ceil((until - performance.now()) / 1000))} с`,
        };
        render();
        await wait(250);
      }
      const samples = await recording.stop(0);
      await save('foreign', `foreign-${pad(index)}.wav`, samples, { condition: 'ТБ або відео' });
      saved += 1;
    }
    setStatus(`Збережено кліпів: ${String(saved)}.`, 'ok');
  } catch (error) {
    state.sink = undefined;
    setStatus(
      `${error.message === 'скасовано' ? 'Зупинено' : `Помилка: ${error.message}`}. Збережено кліпів: ${String(saved)}.`,
      'warn',
    );
  } finally {
    finishJob();
  }
}

function backgroundStamp(date) {
  return `bg-${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function runBackground() {
  if (!state.mic || state.job) return;
  const job = startJob('background');
  const chunkSamples = state.plan.background.chunkMinutes * 60 * SAMPLE_RATE;
  let chunk = { blocks: [], count: 0, marksMs: [], startedAt: new Date() };
  let savedChunks = 0;
  const pending = [];

  const flush = (current) => {
    if (seconds(current.count) < 10) return;
    const samples = concatInt16(current.blocks);
    pending.push(
      save('background', `${backgroundStamp(current.startedAt)}.wav`, samples, {
        marksMs: current.marksMs,
      })
        .then(() => {
          savedChunks += 1;
        })
        .catch((error) => {
          setStatus(`Частину не збережено: ${error.message}`, 'error');
        }),
    );
  };

  job.mark = () => {
    chunk.marksMs.push(Math.round((chunk.count / SAMPLE_RATE) * 1000));
    setStatus(`Позначку додано: ${String(chunk.marksMs.length)} у цій частині.`, 'ok');
  };
  state.sink = (block) => {
    chunk.blocks.push(block);
    chunk.count += block.length;
    if (chunk.count >= chunkSamples) {
      flush(chunk);
      chunk = { blocks: [], count: 0, marksMs: [], startedAt: new Date() };
    }
  };
  const started = performance.now();
  while (!job.cancelled) {
    const minutes = (performance.now() - started) / 60000;
    job.view = {
      big: `${String(Math.floor(minutes / 60))} год ${pad(Math.floor(minutes % 60))} хв`,
      small: `Частин збережено: ${String(savedChunks)}. M — позначити, якщо прозвучало «Banshee». Esc — зупинити.`,
    };
    render();
    await wait(1000);
  }
  state.sink = undefined;
  flush(chunk);
  await Promise.all(pending);
  setStatus(`Фон зупинено. Частин збережено: ${String(savedChunks)}.`, 'ok');
  finishJob();
}

function renderJob() {
  const view = state.job.view;
  return [
    el('p', { class: `cue${view.cue ? ' on' : ''}` }, view.big ?? ''),
    el('p', { class: 'counter' }, view.small ?? ''),
    el(
      'div',
      { class: 'actions' },
      state.job.kind === 'background'
        ? el('button', { onclick: () => state.job?.mark?.() }, 'Позначити (M)')
        : null,
      el(
        'button',
        {
          onclick: () => {
            if (state.job) state.job.cancelled = true;
          },
        },
        'Зупинити (Esc)',
      ),
    ),
  ];
}

function renderWake() {
  const { series, intervalMs } = state.plan.wake;
  return [
    el(
      'p',
      { class: 'hint' },
      `Чотири серії по 25 разів. Гарнітура лежить на столі; стань на вказану відстань і кажи «Banshee» приблизно раз на ${String(intervalMs / 1000)} с — за підказкою на екрані, якщо її видно. Де саме прозвучало слово, перевірка визначає зі звуку. Для серій з музикою ввімкни музику, як зазвичай.`,
    ),
    el(
      'ul',
      { class: 'series' },
      series.map((item) => {
        const done = entry('wake', `${item.id}.wav`);
        return el(
          'li',
          {},
          el('span', {}, `${item.label} · ${String(item.count)} разів`),
          el('span', { class: 'done' }, done ? '✓ записано' : ''),
          el(
            'button',
            {
              class: done ? '' : 'primary',
              onclick: () => void runWakeSeries(item),
              disabled: !state.mic,
            },
            done ? 'Перезаписати' : 'Почати',
          ),
        );
      }),
    ),
  ];
}

function renderForeign() {
  const { count, seconds: clipSeconds } = state.plan.foreign;
  const done = entriesOf('foreign').length;
  return [
    el(
      'p',
      { class: 'hint' },
      `Ввімкни на колонках ТБ, відео чи подкаст з українською мовою — бажано різних людей. Записувач зробить ${String(count)} кліпів по ${String(clipSeconds)} с підряд. Сам у цей час мовчи.`,
    ),
    el('p', { class: 'done' }, `Записано: ${String(done)} з ${String(count)}`),
    el(
      'div',
      { class: 'actions' },
      el(
        'button',
        { class: 'primary', onclick: () => void runForeign(), disabled: !state.mic },
        done >= count ? 'Перезаписати всі (Enter)' : 'Почати (Enter)',
      ),
    ),
  ];
}

function renderBackground() {
  const hours = entriesOf('background').reduce((sum, item) => sum + item.durationSec, 0) / 3600;
  const { targetHours, chunkMinutes } = state.plan.background;
  return [
    el(
      'p',
      { class: 'hint' },
      `Звичайний день без слова «Banshee»: розмови, подкасти й відео на колонках, тиша. Запис іде частинами по ${String(chunkMinutes)} хв; вкладку можна згорнути, але не закривати. Якщо «Banshee» таки прозвучало — натисни M.`,
    ),
    el('p', { class: 'done' }, `Записано: ${hours.toFixed(1)} год з ${String(targetHours)}`),
    el(
      'div',
      { class: 'actions' },
      el(
        'button',
        { class: 'primary', onclick: () => void runBackground(), disabled: !state.mic },
        'Почати (Enter)',
      ),
    ),
  ];
}

// ---------- Відображення ----------

function progress(id) {
  if (!state.plan) return '';
  const counts = {
    commands: [entriesOf('commands').length, state.plan.commands.length],
    wake: [entriesOf('wake').length, state.plan.wake.series.length],
    profile: [entriesOf('profile').length, state.plan.profile.length],
    foreign: [entriesOf('foreign').length, state.plan.foreign.count],
  };
  if (id === 'background') {
    const hours = entriesOf('background').reduce((sum, item) => sum + item.durationSec, 0) / 3600;
    return `${hours.toFixed(1)} / ${String(state.plan.background.targetHours)} год`;
  }
  const [done, total] = counts[id];
  return `${String(done)} / ${String(total)}`;
}

function renderTabs() {
  ui.tabs.replaceChildren(
    ...TABS.map((tab) =>
      el(
        'button',
        {
          class: tab.id === state.tab ? 'tab active' : 'tab',
          'aria-current': tab.id === state.tab ? 'page' : undefined,
          disabled: Boolean(state.job || state.clip) && tab.id !== state.tab,
          onclick: () => {
            state.tab = tab.id;
            render();
          },
        },
        el('span', {}, tab.title),
        el('small', {}, progress(tab.id)),
      ),
    ),
  );
}

function render() {
  renderTabs();
  if (!state.plan) return;
  ui.mic.disabled = Boolean(state.job || state.clip);
  ui.processing.disabled = Boolean(state.job || state.clip);
  let content;
  if (state.job) content = renderJob();
  else if (state.tab === 'commands' || state.tab === 'profile') content = renderPhrases(state.tab);
  else if (state.tab === 'wake') content = renderWake();
  else if (state.tab === 'foreign') content = renderForeign();
  else content = renderBackground();
  ui.panel.replaceChildren(...content);
}

// ---------- Клавіші й старт ----------

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLSelectElement) return;
  if (event.key === 'Escape' && state.job) {
    state.job.cancelled = true;
    return;
  }
  if (
    (event.key === 'm' || event.key === 'M' || event.key === 'ь' || event.key === 'Ь') &&
    state.job?.mark
  ) {
    state.job.mark();
    return;
  }
  if (state.job) return;
  const phrases = state.tab === 'commands' || state.tab === 'profile';
  if (event.code === 'Space' && phrases) {
    event.preventDefault();
    void toggleClip(state.tab);
  } else if (event.key === 'ArrowLeft' && phrases && !state.clip) {
    moveTo(state.tab, state.index[state.tab] - 1);
  } else if (event.key === 'ArrowRight' && phrases && !state.clip) {
    moveTo(state.tab, state.index[state.tab] + 1);
  } else if (event.key === 'Enter' && state.tab === 'foreign') {
    void runForeign();
  } else if (event.key === 'Enter' && state.tab === 'background') {
    void runBackground();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (state.job || state.clip) event.preventDefault();
});

ui.mic.addEventListener('change', () => void startMicrophone());
ui.processing.addEventListener('change', () => void startMicrophone());

try {
  const body = await api('/api/state');
  state.plan = body.plan;
  state.manifest = body.manifest;
  for (const set of ['commands', 'profile']) {
    const first = items(set).findIndex((item) => !entry(set, `${item.id}.wav`));
    state.index[set] = Math.max(0, first);
  }
  render();
  await startMicrophone();
} catch (error) {
  setStatus(`Записувач не відповідає: ${error.message}`, 'error');
}
