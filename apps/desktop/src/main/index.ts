// Головний процес Banshee (.claude/logic/01-architecture.md, «Процеси»): один екземпляр, значок у
// треї, core в utilityProcess під наглядом, оверлей і центр керування з портами MessagePort до
// core — без мережевих портів. Гарячі клавіші, тема й автозапуск — з налаштувань core.
// `--self-check` — перевірка програми: старт, вікно, перезапуск core, другий екземпляр.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  parseControlFromCore,
  parseCoreMessage,
  PROTOCOL_VERSION,
  ulid,
  type AiState,
  type ControlFromVoice,
  type ControlToCore,
  type CoreMessage,
  type DesktopMessage,
  type SettingKey,
  type Settings,
} from '@banshee/shared';
import { createLog } from '@banshee/shared/log';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
  type MenuItemConstructorOptions,
  type MessagePortMain,
  type NativeImage,
  type UtilityProcess,
} from 'electron';
import corePath from '../core/core.ts?modulePath';
import pcPath from '../pc/pc.ts?modulePath';
import voicePath from '../voice/voice.ts?modulePath';
import { EXTERNAL_LINKS, uiToMain, type Section, type UiToWindow } from '../shared/ui.ts';
import { aboutInfo, collectDiagnostics } from './about.ts';
import { eraseScript, eraseTarget } from './erase.ts';
import { bansheePaths, selfCheckPaths } from './paths.ts';
import {
  OVERLAY_MIN_HEIGHT,
  OVERLAY_WIDTH,
  overlayBounds,
  supportsMica,
  toAccelerator,
} from './placement.ts';
import { runSelfCheck } from './self-check.ts';
import { runShots } from './shots.ts';
import { MAX_CRASHES, Supervisor, type ChildHandle } from './supervisor.ts';
import { trayView, type TrayIcon } from './tray-view.ts';
import { VoiceHost, type VoiceHostState } from './voice.ts';
import {
  MODELS_TOTAL_BYTES,
  downloadModels,
  missingDownloads,
  type DownloadProgress,
} from '@banshee/voice/download';

/** Знімки інтерфейсу для перевірки вигляду — теж в окремій теці й без ключа. */
const UI_SHOTS = process.argv.includes('--ui-shots');
const SELF_CHECK = process.argv.includes('--self-check') || UI_SHOTS;
const launchedAt = performance.now();

const basePaths = bansheePaths({
  packaged: app.isPackaged,
  exe: app.getPath('exe'),
  appPath: app.getAppPath(),
});
const paths = SELF_CHECK ? selfCheckPaths(basePaths) : basePaths;
// До події ready: Electron типово пише профіль у %APPDATA%, а все Banshee живе в його теці.
app.setPath('userData', paths.chromium);
app.setPath('sessionData', paths.chromium);
app.setPath('logs', paths.logs);
app.setPath('crashDumps', join(paths.logs, 'crashes'));
app.setAppUserModelId('ua.banshee.desktop');

const log = createLog({ dir: paths.logs, source: 'desktop' });
const resource = (name: string): string => join(app.getAppPath(), 'resources', name);

type WindowKind = 'center' | 'overlay';

let tray: Tray | null = null;
let icons: Record<TrayIcon, NativeImage> | null = null;
let center: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let overlayHeight = OVERLAY_MIN_HEIGHT;
/** Коли оверлей показано: запит «сховати через бездіяльність» одразу після показу — застарілий. */
let overlayShownAt = 0;
const STALE_IDLE_HIDE_MS = 1500;
const windows = new Map<BrowserWindow, WindowKind>();
let core: UtilityProcess | null = null;
let mainPort: MessagePortMain | null = null;
let aiState: AiState | null = null;
let settings: Settings | null = null;
let wizardOffered = false;
let quitting = false;
let secondInstances = 0;
const coreReadyAt: number[] = [];
const coreExitAt: number[] = [];
const pcPids: (number | null)[] = [];
let turnsDone = 0;
let lastDiagnostics: string | null = null;
let audioWindow: BrowserWindow | null = null;
let voiceSelfTest: Extract<ControlFromVoice, { type: 'voice.selfTest' }> | null = null;
let voiceReadyAt: number | null = null;
/** Остання самоперевірка процесу voice: модель слова й профіль голосу. */
let voiceInfo: { wakeModel: 'own' | 'base' | 'none'; profile: boolean } | null = null;
let modelsDownload: {
  state: 'running' | 'done' | 'failed';
  progress: DownloadProgress | null;
  error?: string;
} | null = null;
const replies = new Map<string, (reply: Extract<CoreMessage, { type: 'reply' }>) => void>();

const supervisor = new Supervisor({
  spawn: spawnCore,
  onState: (state) => {
    log.info('core.state', { state });
    refreshTray();
  },
  onCrash: ({ code, recent }) => {
    coreExitAt.push(performance.now());
    log.error('core.exit', { code, recent });
    if (recent >= MAX_CRASHES) {
      notify('Ядро Banshee зупинилося після 3 збоїв за хвилину. Перезапусти його з меню в треї.');
    }
  },
});

/** Голос (02-voice.md, «Реалізація — етап 2»); перевірка програми — без мікрофона й динаміків. */
const voice = new VoiceHost({
  script: voicePath,
  appVersion: app.getVersion(),
  modelsDir: paths.models,
  // Нативний код читає файли з диска, не з asar: ресурси розпаковано (asarUnpack).
  espeakDir: resource('espeak-ng-data').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`),
  dataDir: paths.data,
  logsDir: paths.logs,
  log,
  selfTest: SELF_CHECK,
  attachCore: (port) => {
    if (!core) return false;
    post(core, { type: 'core.attach', client: 'voice' }, [port]);
    return true;
  },
  createAudioWindow: () => (SELF_CHECK ? null : createAudioWindow()),
  onState: (state, speaking) => {
    onVoiceState(state, speaking);
  },
  onMessage: (message) => {
    onVoiceMessage(message);
  },
});

function post(child: UtilityProcess, message: ControlToCore, ports: MessagePortMain[] = []): void {
  child.postMessage(message, ports);
}

function send(message: DesktopMessage): void {
  mainPort?.postMessage(message);
}

/** Запит головного процесу до core з відповіддю `reply`. */
function ask(message: Extract<DesktopMessage, { id: string }>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      replies.delete(message.id);
      reject(new Error('core не відповів'));
    }, 15_000);
    replies.set(message.id, (reply) => {
      clearTimeout(timer);
      if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.error ?? 'помилка core'));
    });
    send(message);
  });
}

function setSetting(key: SettingKey, value: unknown): void {
  send({ type: 'settings.set', id: ulid(), key, value, source: 'ui' });
}

function spawnCore(): ChildHandle {
  const child = utilityProcess.fork(corePath, [], { serviceName: 'Banshee core', stdio: 'pipe' });
  const spawnedAt = performance.now();
  core = child;
  aiState = null;
  child.stderr?.on('data', (chunk: Buffer) => {
    log.warn('core.stderr', { text: chunk.toString('utf8') });
  });
  child.on('message', (data: unknown) => {
    onControl(child, data, spawnedAt);
  });

  const channel = new MessageChannelMain();
  mainPort?.close();
  replies.clear();
  mainPort = channel.port2;
  channel.port2.on('message', (event) => {
    onCoreMessage(event.data);
  });
  channel.port2.start();
  post(
    child,
    {
      type: 'core.init',
      appVersion: app.getVersion(),
      dataDir: paths.data,
      logsDir: paths.logs,
      dbFile: paths.db,
      pcScript: pcPath,
      ai: !SELF_CHECK,
    },
    [channel.port1],
  );
  send({ type: 'hello', version: PROTOCOL_VERSION, appVersion: app.getVersion() });
  for (const win of windows.keys()) {
    if (!win.webContents.isLoading()) connectWindow(win);
  }
  voice.coreRestarted();
  // Жорстко, як справжнє падіння: м'яке kill() Electron інколи чекає до 2 с.
  return {
    kill: () => {
      if (child.pid === undefined) child.kill();
      else process.kill(child.pid);
    },
    onExit: (handler) => {
      child.once('exit', handler);
    },
  };
}

function onControl(child: UtilityProcess, data: unknown, spawnedAt: number): void {
  if (child !== core) return;
  const parsed = parseControlFromCore(data);
  if (!parsed.ok) {
    log.warn('core.control', { error: parsed.error });
    return;
  }
  const message = parsed.message;
  if (message.type === 'core.failed') {
    log.error('core.failed', { error: message.error });
    notify(`Ядро Banshee не запустилося: ${message.error}`);
    return;
  }
  const now = performance.now();
  log.info('core.ready', { ms: Math.round(now - spawnedAt), pc: message.pcTools });
  coreReadyAt.push(now);
  pcPids.push(message.pcPid);
  aiState = message.aiState;
  supervisor.ready();
  refreshTray();
  void loadSettings();
}

async function loadSettings(): Promise<void> {
  try {
    settings = (await ask({ type: 'settings.get', id: ulid() })) as Settings;
  } catch (error) {
    log.warn('settings.load', { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  for (const key of Object.keys(settings) as SettingKey[]) applySetting(key);
  refreshTray();
}

/** Налаштування, що діють у головному процесі: тема, клавіші, автозапуск, майстер. */
function applySetting(key: SettingKey): void {
  if (!settings) return;
  switch (key) {
    case 'general.theme':
      nativeTheme.themeSource = settings['general.theme'];
      return;
    case 'general.hotkeys':
      registerShortcuts();
      return;
    case 'general.autostart':
      // Лише зібрана програма: у розробці автозапуск записав би electron.exe.
      if (app.isPackaged && !SELF_CHECK) {
        // Назва запису Run — «Banshee»: її прибирає деінсталятор (build/installer.nsh).
        app.setLoginItemSettings({ openAtLogin: settings['general.autostart'], name: 'Banshee' });
      }
      return;
    case 'voice.enabled':
    case 'voice.microphone':
    case 'voice.speakers':
      applyVoice();
      registerShortcuts();
      return;
    case 'general.setupDone':
      if (!settings['general.setupDone'] && !wizardOffered && !SELF_CHECK) {
        wizardOffered = true;
        showCenter('wizard');
      }
      return;
    default:
      return;
  }
}

/** Оверлей, «стоп» і пауза мікрофона. */
function registerShortcuts(): void {
  if (!settings || SELF_CHECK) return;
  globalShortcut.unregisterAll();
  const hotkeys = settings['general.hotkeys'];
  const busy: string[] = [];
  const bind = (hotkey: string, action: () => void) => {
    try {
      if (!globalShortcut.register(toAccelerator(hotkey), action)) busy.push(hotkey);
    } catch {
      busy.push(hotkey);
    }
  };
  bind(hotkeys.overlay, toggleOverlay);
  bind(hotkeys.stop, () => {
    send({ type: 'stop' });
    voice.hush();
  });
  // Пауза мікрофона — лише коли голос увімкнено: інакше її поєднання в інших програмах не чіпаємо.
  if (settings['voice.enabled']) bind(hotkeys.micPause, toggleMicPause);
  if (busy.length > 0) {
    log.warn('hotkeys.busy', { keys: busy.join(', ') });
    notify(`Гаряча клавіша ${busy.join(', ')} зайнята іншою програмою — зміни її в налаштуваннях.`);
  }
}

function onCoreMessage(data: unknown): void {
  const parsed = parseCoreMessage(data);
  if (!parsed.ok) {
    log.warn('core.message', { error: parsed.error });
    return;
  }
  const message = parsed.message;
  switch (message.type) {
    case 'reply': {
      const resolve = replies.get(message.id);
      replies.delete(message.id);
      resolve?.(message);
      return;
    }
    case 'ready':
      aiState = message.aiState;
      refreshTray();
      return;
    case 'ai.state':
      aiState = message.state;
      refreshTray();
      return;
    case 'settings.changed':
      if (settings) {
        settings = { ...settings, [message.key]: message.value };
        applySetting(message.key as SettingKey);
        refreshTray();
      }
      return;
    case 'confirm.request':
      // Картку підтвердження видно в оверлеї, якщо центр керування не перед очима.
      if (!SELF_CHECK && !overlay?.isVisible() && !center?.isFocused()) showOverlay();
      return;
    case 'notice':
      notify(message.text);
      return;
    case 'open':
      // «Довідка» голосом чи в оверлеї — центр керування на темі.
      if (!SELF_CHECK) showCenter('help', message.topic);
      return;
    case 'turn.done':
      turnsDone += 1;
      return;
    default:
      return;
  }
}

/** Новий порт до core для вікна: після завантаження сторінки й після перезапуску core. */
function connectWindow(win: BrowserWindow): void {
  const kind = windows.get(win);
  if (!core || !kind || win.isDestroyed()) return;
  const channel = new MessageChannelMain();
  post(core, { type: 'core.attach', client: kind }, [channel.port1]);
  win.webContents.postMessage('core:port', null, [channel.port2]);
}

function toWindow(win: BrowserWindow, command: UiToWindow): void {
  if (!win.isDestroyed()) win.webContents.send('ui', command);
}

const WEB_PREFERENCES = {
  preload: join(import.meta.dirname, '../preload/index.cjs'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
} as const;

function createWindow(
  kind: WindowKind,
  options: Electron.BrowserWindowConstructorOptions,
  hash: string,
): BrowserWindow {
  const win = new BrowserWindow({ ...options, webPreferences: WEB_PREFERENCES });
  windows.set(win, kind);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  win.webContents.on('did-finish-load', () => {
    connectWindow(win);
  });
  win.on('closed', () => {
    windows.delete(win);
  });
  const page = kind === 'overlay' ? 'overlay.html' : 'index.html';
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/${page}${hash ? `#${hash}` : ''}`);
  else {
    void win.loadFile(join(import.meta.dirname, '../renderer', page), hash ? { hash } : {});
  }
  return win;
}

const background = (): string => (nativeTheme.shouldUseDarkColors ? '#141a19' : '#f1f4f3');

function showCenter(section?: Section, anchor?: string): BrowserWindow {
  if (center && !center.isDestroyed()) {
    if (center.isMinimized()) center.restore();
    if (!SELF_CHECK) center.show();
    center.focus();
    if (section)
      toWindow(center, { type: 'center.section', section, ...(anchor ? { anchor } : {}) });
    return center;
  }
  const hash = section ? `${section}${anchor ? `/${anchor}` : ''}` : '';
  const win = createWindow(
    'center',
    {
      width: 1040,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      show: false,
      title: 'Banshee',
      icon: resource('icon.ico'),
      autoHideMenuBar: true,
      backgroundColor: background(),
    },
    hash,
  );
  center = win;
  win.once('ready-to-show', () => {
    if (!SELF_CHECK) win.show();
  });
  win.on('closed', () => {
    if (center === win) center = null;
  });
  return win;
}

function ensureOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const mica = supportsMica(release());
  const win = createWindow(
    'overlay',
    {
      width: OVERLAY_WIDTH,
      height: OVERLAY_MIN_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Banshee',
      ...(mica ? { backgroundMaterial: 'mica' as const } : { backgroundColor: background() }),
    },
    mica ? 'mica' : '',
  );
  overlay = win;
  win.on('closed', () => {
    if (overlay === win) overlay = null;
  });
  return win;
}

/**
 * Оверлей — на моніторі з курсором: активне вікно іншої програми Electron не бачить.
 * focus = false — слово «Banshee»: показати, що слухає, не забираючи фокус у програми власника.
 */
function showOverlay(focus = true): void {
  const win = ensureOverlay();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win.setBounds(overlayBounds(display.workArea, overlayHeight));
  overlayShownAt = performance.now();
  if (focus) {
    win.show();
    win.focus();
    toWindow(win, { type: 'overlay.shown' });
  } else win.showInactive();
}

function toggleOverlay(): void {
  if (overlay?.isVisible() && overlay.isFocused()) overlay.hide();
  else showOverlay();
}

function resizeOverlay(height: number): void {
  overlayHeight = height;
  if (!overlay?.isVisible()) return;
  const display = screen.getDisplayMatching(overlay.getBounds());
  overlay.setBounds(overlayBounds(display.workArea, height));
}

ipcMain.on('ui', (event, data: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !windows.has(win)) return;
  const parsed = uiToMain.safeParse(data);
  if (!parsed.success) {
    log.warn('ui.invalid', { kind: windows.get(win) ?? '?' });
    return;
  }
  const command = parsed.data;
  switch (command.type) {
    case 'overlay.hide':
      // Таймер бездіяльності сторінки, що «спав», поки оверлей був прихований, може спрацювати
      // раніше за повідомлення про показ — такий запит ігноруємо; Esc діє завжди.
      if (command.reason === 'idle' && performance.now() - overlayShownAt < STALE_IDLE_HIDE_MS)
        return;
      overlay?.hide();
      return;
    case 'overlay.resize':
      resizeOverlay(command.height);
      return;
    case 'center.open':
      showCenter(command.section, command.anchor);
      return;
    case 'external.open':
      void shell.openExternal(EXTERNAL_LINKS[command.link]);
      return;
    case 'folder.open':
      void shell.openPath(paths.root);
      return;
    case 'diagnostics.show':
      if (lastDiagnostics) shell.showItemInFolder(lastDiagnostics);
      return;
    case 'voice.listen':
      voice.listen();
      return;
    case 'voice.download':
      void downloadVoiceModels();
      return;
  }
});

const about = () =>
  aboutInfo({ version: app.getVersion(), packaged: app.isPackaged, root: paths.root });

ipcMain.handle('ui:about', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !windows.has(win)) throw new Error('Невідоме вікно');
  return about();
});

/**
 * «Видалити всі дані»: ключ — через core, далі окремий PowerShell після виходу Banshee запускає
 * деінсталятор і кладе теку Banshee в Кошик. У розробці й розпакованій збірці — відмова.
 */
ipcMain.handle('ui:erase', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !windows.has(win)) throw new Error('Невідоме вікно');
  const target = SELF_CHECK ? null : eraseTarget(paths.root, app.isPackaged);
  if (!target) throw new Error('Лише у встановленій програмі.');
  await ask({ type: 'key.delete', id: ulid() });
  const script = join(tmpdir(), `banshee-erase-${String(Date.now())}.ps1`);
  writeFileSync(script, `\uFEFF${eraseScript(target, process.pid)}`);
  spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
    { detached: true, stdio: 'ignore' },
  ).unref();
  log.info('erase', { root: target.root });
  setTimeout(() => {
    app.quit();
  }, 200);
  return true;
});

/** Моделі голосу для Налаштувань → Голос: чого бракує, хід завантаження, модель слова й профіль. */
ipcMain.handle('ui:voiceModels', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !windows.has(win)) throw new Error('Невідоме вікно');
  const missing = missingDownloads(paths.models);
  return {
    missingFiles: missing.files.length,
    missingBytes: missing.bytes,
    totalBytes: MODELS_TOTAL_BYTES,
    folder: paths.models,
    download: modelsDownload,
    voice: voiceInfo,
  };
});

function broadcast(message: UiToWindow): void {
  for (const win of windows.keys()) toWindow(win, message);
}

/**
 * Моделі голосу, яких бракує (01-architecture.md, «Встановлення й оновлення»): ≈ 0,8 ГБ, з
 * перевіркою SHA-256 і докачуванням. net.fetch бере проксі з налаштувань Windows.
 */
async function downloadVoiceModels(): Promise<void> {
  if (modelsDownload?.state === 'running') return;
  modelsDownload = { state: 'running', progress: null };
  let last = 0;
  const seen: { progress: DownloadProgress | null } = { progress: null };
  try {
    await downloadModels(paths.models, {
      fetch: (url, init) => net.fetch(url, init),
      onProgress: (progress) => {
        seen.progress = progress;
        if (modelsDownload) modelsDownload.progress = progress;
        // Не частіше, ніж раз на 300 мс: сторінці досить.
        if (performance.now() - last < 300) return;
        last = performance.now();
        broadcast({
          type: 'voice.download',
          state: 'running',
          done: progress.done,
          total: progress.total,
        });
      },
    });
    modelsDownload = { state: 'done', progress: null };
    broadcast({
      type: 'voice.download',
      state: 'done',
      done: MODELS_TOTAL_BYTES,
      total: MODELS_TOTAL_BYTES,
    });
    log.info('voice.models', { state: 'done' });
    voice.retry();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    modelsDownload = { state: 'failed', progress: seen.progress, error: text };
    broadcast({
      type: 'voice.download',
      state: 'failed',
      done: seen.progress?.done ?? 0,
      total: MODELS_TOTAL_BYTES,
      error: text,
    });
    log.warn('voice.models', { state: 'failed', error: text });
  }
}

ipcMain.handle('ui:diagnostics', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !windows.has(win)) throw new Error('Невідоме вікно');
  lastDiagnostics = await collectDiagnostics({
    info: await about(),
    logsDir: paths.logs,
    outDir: app.getPath('downloads'),
  });
  log.info('diagnostics', { files: 1 });
  return lastDiagnostics;
});

/** «Голосові команди», мікрофон і динаміки з налаштувань. Перевірка програми вмикає голос сама. */
function applyVoice(): void {
  if (!settings || UI_SHOTS) return;
  if (settings['voice.enabled'] || SELF_CHECK)
    voice.enable({
      microphone: settings['voice.microphone'],
      speakers: settings['voice.speakers'],
    });
  else void voice.disable();
}

function toggleMicPause(): void {
  voice.setPaused(!voice.isPaused);
  notify(voice.isPaused ? 'Мікрофон на паузі.' : 'Мікрофон знову слухає.');
}

const VOICE_TEXT: Record<VoiceHostState, string> = {
  off: '',
  failed: 'голос не працює',
  loading: 'голос завантажується',
  idle: 'слухає слово «Banshee»',
  listening: 'слухає команду',
  recognizing: 'розпізнає',
  busy: 'виконує',
  followUp: 'слухає продовження',
  paused: 'мікрофон на паузі',
};

function onVoiceState(state: VoiceHostState, speaking: boolean): void {
  const message = { type: 'voice', state, speaking, problem: voice.problem } as const;
  for (const win of windows.keys()) toWindow(win, message);
  // Слово «Banshee» — оверлей показує, що Banshee слухає, але фокус не забирає.
  if (state === 'listening' && !SELF_CHECK && !overlay?.isVisible()) showOverlay(false);
  refreshTray();
}

function onVoiceMessage(message: ControlFromVoice): void {
  switch (message.type) {
    case 'voice.started':
      voiceReadyAt = performance.now();
      voiceInfo = { wakeModel: message.wakeModel, profile: message.profile };
      return;
    case 'voice.heard':
      if (overlay) toWindow(overlay, message);
      return;
    case 'voice.capture':
      if (!message.ok) {
        log.warn('voice.capture', { error: message.error ?? '' });
        notify(
          'Мікрофон не відкрився. Перевір у Windows: Параметри → Конфіденційність → Мікрофон → доступ для класичних програм.',
        );
      }
      return;
    case 'voice.failed':
      notify(
        message.missing.length > 0
          ? 'Голос не запустився: немає моделей голосу в теці models.'
          : `Голос не запустився: ${message.error}`,
      );
      return;
    case 'voice.selfTest':
      voiceSelfTest = message;
      return;
    default:
      return;
  }
}

/** Приховане вікно звуку: мікрофон і озвучка в одному renderer — для ехоподавлення. */
function createAudioWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 120,
    skipTaskbar: true,
    title: 'Banshee — звук',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/audio.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  audioWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  win.on('closed', () => {
    if (audioWindow === win) audioWindow = null;
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/audio.html`);
  else void win.loadFile(join(import.meta.dirname, '../renderer', 'audio.html'));
  return win;
}

function notify(text: string): void {
  log.info('notice', { text });
  if (SELF_CHECK || !Notification.isSupported()) return;
  new Notification({ title: 'Banshee', body: text, icon: resource('icon.png') }).show();
}

function refreshTray(): void {
  if (!tray || !icons) return;
  const view = trayView(supervisor.state, aiState);
  tray.setImage(icons[view.icon]);
  const voiceText = VOICE_TEXT[voice.state];
  tray.setToolTip(voiceText ? `${view.tooltip} · ${voiceText}` : view.tooltip);
  const items: MenuItemConstructorOptions[] = [
    {
      label: `Оверлей (${settings?.['general.hotkeys'].overlay ?? 'Ctrl+Shift+B'})`,
      click: () => {
        showOverlay();
      },
    },
    ...(voice.state === 'off'
      ? []
      : [
          {
            label: `Пауза мікрофона (${settings?.['general.hotkeys'].micPause ?? 'Ctrl+Shift+M'})`,
            type: 'checkbox' as const,
            checked: voice.isPaused,
            enabled: voice.state !== 'failed' && voice.state !== 'loading',
            click: toggleMicPause,
          },
        ]),
    {
      label: 'Використовувати ШІ',
      type: 'checkbox',
      checked: settings?.['ai.enabled'] ?? true,
      enabled: settings !== null && supervisor.state === 'running',
      click: (item) => {
        setSetting('ai.enabled', item.checked);
      },
    },
    { label: 'Центр керування', click: () => showCenter() },
    { label: 'Довідка', click: () => showCenter('help') },
    ...(view.canRestart
      ? [
          {
            label: 'Перезапустити core',
            click: () => {
              supervisor.start();
            },
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: 'Вийти',
      click: () => {
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function start(): void {
  log.info('desktop.start', { version: app.getVersion(), packaged: app.isPackaged });
  Menu.setApplicationMenu(null);
  // Мікрофон — лише прихованому вікну звуку й лише звук; решті сторінок не дозволено нічого.
  const isAudio = (contents: Electron.WebContents | null): boolean =>
    contents !== null && audioWindow !== null && !audioWindow.isDestroyed()
      ? contents.id === audioWindow.webContents.id
      : false;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    callback(
      permission === 'media' &&
        isAudio(contents) &&
        types.length > 0 &&
        types.every((type) => type === 'audio'),
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) => permission === 'media' && isAudio(contents),
  );
  icons = {
    idle: nativeImage.createFromPath(resource('tray-idle.png')),
    basic: nativeImage.createFromPath(resource('tray-basic.png')),
    down: nativeImage.createFromPath(resource('tray-down.png')),
  };
  tray = new Tray(icons.down);
  tray.on('click', () => {
    showCenter();
  });
  refreshTray();
  supervisor.start();
  if (!SELF_CHECK) ensureOverlay();
  // Після сну чи гібернації аудіоконвеєр перезапускається сам (02-voice.md, «Зміна пристроїв і сон»).
  powerMonitor.on('resume', () => {
    log.info('power.resume');
    voice.reopen();
  });
  log.info('desktop.tray', { ms: Math.round(performance.now() - launchedAt) });
  if (UI_SHOTS) {
    void runShots(
      {
        coreReadyAt,
        openCenter: () => showCenter(),
        openOverlay: () => {
          showOverlay();
          return ensureOverlay();
        },
        command: (text) => {
          send({ type: 'command', id: ulid(), text, source: 'text' });
        },
        log,
      },
      join(basePaths.root, 'ui-shots'),
    )
      .catch((error: unknown) => {
        log.error('ui-shots', { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        app.quit();
      });
  } else if (SELF_CHECK) {
    void runSelfCheck(
      {
        launchedAt,
        coreReadyAt,
        coreExitAt,
        pcPids,
        secondInstances: () => secondInstances,
        turnsDone: () => turnsDone,
        voice: () => ({
          state: voice.state,
          problem: voice.problem,
          readyMs: voiceReadyAt === null ? null : Math.round(voiceReadyAt - launchedAt),
          selfTest: voiceSelfTest,
        }),
        crashCore: () => {
          supervisor.crash();
        },
        openCenter: () => showCenter(),
        command: (text) => {
          send({ type: 'command', id: `check-${String(Date.now())}`, text, source: 'text' });
        },
        log,
      },
      join(basePaths.root, 'desktop-check.json'),
    ).finally(() => {
      app.quit();
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  // Banshee вже працює: той екземпляр покаже центр керування.
  app.quit();
} else {
  app.on('second-instance', () => {
    secondInstances += 1;
    log.info('desktop.second-instance');
    if (!SELF_CHECK) showCenter();
  });
  // Banshee живе в треї: закриті вікна не завершують програму.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void Promise.all([
      voice.stop(),
      supervisor.stop(() => {
        if (core) post(core, { type: 'core.stop' });
      }),
    ]).finally(() => {
      log.info('desktop.quit');
      app.quit();
    });
  });
  // ESM без top-level await навколо whenReady: подія ready настає лише після завантаження модуля.
  void app.whenReady().then(start);
}
