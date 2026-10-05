// Вбудовані команди (.claude/logic/03-brain.md, «Стан ШІ й базовий режим»): рутини, що постачаються
// з Banshee (`origin = builtin`) і працюють без ШІ з першого дня — гучність, медіа, програми, теки й
// сайти зі словника, вікна, час і дата, блокування, перемикач ШІ.
// Шаблон — слова й слоти: {n} — число 0–100, {app}, {site}, {folder} — назва зі словника.

export type SlotType = 'n' | 'app' | 'site' | 'folder';

export interface RoutineStep {
  readonly tool: string;
  /** Значення "{n}", "{app}" тощо підставляються зі слотів. */
  readonly args: Readonly<Record<string, unknown>>;
}

export interface Routine {
  /** Стабільний ідентифікатор: `uid` рядка в `routines`, на нього посилаються ходи. */
  readonly id: string;
  readonly templates: readonly string[];
  readonly steps: readonly RoutineStep[];
}

const step = (tool: string, args: Readonly<Record<string, unknown>> = {}): RoutineStep => ({
  tool,
  args,
});

export const BUILTIN_ROUTINES: readonly Routine[] = [
  {
    id: 'builtin.volume.set',
    templates: [
      'гучність {n}',
      'гучність на {n}',
      'зроби гучність {n}',
      'зроби гучність на {n}',
      'постав гучність {n}',
      'постав гучність на {n}',
      'звук {n}',
      'звук на {n}',
      'сделай громкость {n}',
    ],
    steps: [step('volume', { level: '{n}' })],
  },
  {
    id: 'builtin.volume.max',
    templates: [
      'гучність на повну',
      'зроби гучність на повну',
      'звук на повну',
      'на повну гучність',
      'гучність на максимум',
      'максимальна гучність',
    ],
    steps: [step('volume', { level: 100 })],
  },
  {
    id: 'builtin.volume.half',
    templates: [
      'пів гучності',
      'зроби пів гучності',
      'гучність наполовину',
      'гучність на половину',
    ],
    steps: [step('volume', { level: 50 })],
  },
  {
    id: 'builtin.volume.down',
    templates: ['тихіше', 'зроби тихіше', 'трохи тихіше', 'зменш гучність', 'тише', 'сделай тише'],
    steps: [step('volume', { delta: -10 })],
  },
  {
    id: 'builtin.volume.up',
    templates: [
      'голосніше',
      'гучніше',
      'зроби голосніше',
      'зроби гучніше',
      'трохи голосніше',
      'збільш гучність',
      'громче',
    ],
    steps: [step('volume', { delta: 10 })],
  },
  {
    id: 'builtin.volume.mute',
    templates: ['вимкни звук', 'без звуку', 'заглуши звук', 'выключи звук'],
    steps: [step('volume', { mute: true })],
  },
  {
    id: 'builtin.volume.unmute',
    templates: ['увімкни звук', 'включи звук', 'поверни звук'],
    steps: [step('volume', { mute: false })],
  },
  {
    id: 'builtin.media.pause',
    templates: ['пауза', 'постав на паузу', 'на паузу', 'зупини музику', 'зупини відтворення'],
    steps: [step('media', { action: 'pause' })],
  },
  {
    id: 'builtin.media.play',
    templates: ['продовж', 'продовж музику', 'грай', 'відтвори', 'увімкни музику', 'включи музику'],
    steps: [step('media', { action: 'play' })],
  },
  {
    id: 'builtin.media.next',
    templates: [
      'наступний трек',
      'наступна пісня',
      'наступну пісню',
      'перемкни трек',
      'далі',
      'следующий трек',
    ],
    steps: [step('media', { action: 'next' })],
  },
  {
    id: 'builtin.media.previous',
    templates: [
      'попередній трек',
      'попередня пісня',
      'попередню пісню',
      'попередній',
      'предыдущий трек',
    ],
    steps: [step('media', { action: 'previous' })],
  },
  {
    id: 'builtin.window.minimize_all',
    templates: ['згорни все', 'згорни всі вікна', 'покажи робочий стіл', 'сверни все'],
    steps: [step('window', { action: 'minimize_all' })],
  },
  {
    id: 'builtin.window.minimize',
    templates: ['згорни вікно', 'згорни'],
    steps: [step('window', { action: 'minimize' })],
  },
  {
    id: 'builtin.window.maximize',
    templates: ['розгорни вікно', 'розгорни на весь екран', 'на весь екран'],
    steps: [step('window', { action: 'maximize' })],
  },
  {
    id: 'builtin.window.maximize_app',
    templates: ['розгорни {app}', 'розгорни {app} на весь екран'],
    steps: [step('window', { action: 'maximize', app: '{app}' })],
  },
  {
    id: 'builtin.open.app',
    templates: ['відкрий {app}', 'запусти {app}', 'включи {app}', 'увімкни {app}', 'открой {app}'],
    steps: [step('open_app', { app: '{app}' })],
  },
  {
    id: 'builtin.open.site',
    templates: ['відкрий {site}', 'зайди на {site}', 'открой {site}'],
    steps: [step('open_target', { target: '{site}' })],
  },
  {
    id: 'builtin.open.folder',
    templates: [
      'відкрий {folder}',
      'відкрий теку {folder}',
      'відкрий папку {folder}',
      'открой {folder}',
    ],
    steps: [step('open_target', { target: '{folder}' })],
  },
  {
    id: 'builtin.close.app',
    templates: ['закрий {app}', 'вимкни {app}', 'вирубай {app}', 'закрой {app}'],
    steps: [step('close_app', { app: '{app}' })],
  },
  {
    id: 'builtin.lock',
    templates: ['заблокуй комп', "заблокуй комп'ютер", 'заблокуй пк', 'заблокируй компьютер'],
    steps: [step('lock_pc')],
  },
  {
    id: 'builtin.time',
    templates: [
      'котра година',
      'скільки часу',
      'скільки зараз часу',
      'который час',
      'сколько времени',
    ],
    steps: [step('system_info', { kind: 'time' })],
  },
  {
    id: 'builtin.date',
    templates: [
      'яке сьогодні число',
      'яка сьогодні дата',
      'який сьогодні день',
      'какое сегодня число',
    ],
    steps: [step('system_info', { kind: 'date' })],
  },
  {
    id: 'builtin.ai.off',
    templates: ['базовий режим', 'вимкни ші', 'без ші', 'вимкни штучний інтелект'],
    steps: [step('settings.set', { key: 'ai.enabled', value: false })],
  },
  {
    id: 'builtin.ai.on',
    templates: ['увімкни ші', 'ввімкни ші', 'включи ші', 'увімкни штучний інтелект'],
    steps: [step('settings.set', { key: 'ai.enabled', value: true })],
  },
];

/** Команди керування: діють завжди й одразу, до розпізнавання рутин. */
export const CONTROL_COMMANDS: Readonly<Record<string, 'stop' | 'undo' | 'new_episode'>> = {
  стоп: 'stop',
  зупинись: 'stop',
  stop: 'stop',
  скасуй: 'undo',
  відміни: 'undo',
  отмени: 'undo',
  'нова розмова': 'new_episode',
  'новый разговор': 'new_episode',
};
