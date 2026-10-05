// Головний процес Banshee (.claude/logic/01-architecture.md, «Процеси»): один екземпляр, значок у
// треї, core в utilityProcess під наглядом, вікна з портами MessagePort до core — без мережевих
// портів. `--self-check` — перевірка програми: старт, вікно, перезапуск core, другий екземпляр.
import { join } from 'node:path';
import {
  parseControlFromCore,
  parseCoreMessage,
  PROTOCOL_VERSION,
  type AiState,
  type ControlToCore,
  type DesktopMessage,
} from '@banshee/shared';
import { createLog } from '@banshee/shared/log';
import {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  Notification,
  session,
  Tray,
  utilityProcess,
  type MessagePortMain,
  type NativeImage,
  type UtilityProcess,
} from 'electron';
import corePath from '../core/core.ts?modulePath';
import pcPath from '../pc/pc.ts?modulePath';
import { bansheePaths, selfCheckPaths } from './paths.ts';
import { runSelfCheck } from './self-check.ts';
import { MAX_CRASHES, Supervisor, type ChildHandle } from './supervisor.ts';
import { trayView, type TrayIcon } from './tray-view.ts';

const SELF_CHECK = process.argv.includes('--self-check');
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

let tray: Tray | null = null;
let icons: Record<TrayIcon, NativeImage> | null = null;
let center: BrowserWindow | null = null;
let core: UtilityProcess | null = null;
let mainPort: MessagePortMain | null = null;
let aiState: AiState | null = null;
let quitting = false;
let secondInstances = 0;
const coreReadyAt: number[] = [];
const coreExitAt: number[] = [];
const pcPids: (number | null)[] = [];
let turnsDone = 0;

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

function post(child: UtilityProcess, message: ControlToCore, ports: MessagePortMain[] = []): void {
  child.postMessage(message, ports);
}

function send(message: DesktopMessage): void {
  mainPort?.postMessage(message);
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
  if (center && !center.webContents.isLoading()) connectWindow(center);
  return {
    // Жорстко, як справжнє падіння: м'яке kill() Electron інколи чекає до 2 с.
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
}

function onCoreMessage(data: unknown): void {
  const parsed = parseCoreMessage(data);
  if (!parsed.ok) {
    log.warn('core.message', { error: parsed.error });
    return;
  }
  const message = parsed.message;
  switch (message.type) {
    case 'ready':
      aiState = message.aiState;
      refreshTray();
      return;
    case 'ai.state':
      aiState = message.state;
      refreshTray();
      return;
    case 'notice':
      notify(message.text);
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
  if (!core || win.isDestroyed()) return;
  const channel = new MessageChannelMain();
  post(core, { type: 'core.attach', client: 'center' }, [channel.port1]);
  win.webContents.postMessage('core:port', null, [channel.port2]);
}

function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
}

function showCenter(): BrowserWindow {
  if (center && !center.isDestroyed()) {
    if (center.isMinimized()) center.restore();
    if (!SELF_CHECK) center.show();
    center.focus();
    return center;
  }
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 560,
    minHeight: 400,
    show: false,
    title: 'Banshee',
    icon: resource('icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141a19' : '#f1f4f3',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  center = win;
  harden(win);
  win.once('ready-to-show', () => {
    if (!SELF_CHECK) win.show();
  });
  win.webContents.on('did-finish-load', () => {
    connectWindow(win);
  });
  win.on('closed', () => {
    if (center === win) center = null;
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
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
  tray.setToolTip(view.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Центр керування', click: () => showCenter() },
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
    ]),
  );
}

function start(): void {
  log.info('desktop.start', { version: app.getVersion(), packaged: app.isPackaged });
  Menu.setApplicationMenu(null);
  // Мікрофон і решта дозволів — з етапу 2; до того сторінкам не дозволено нічого.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
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
  log.info('desktop.tray', { ms: Math.round(performance.now() - launchedAt) });
  if (SELF_CHECK) {
    void runSelfCheck(
      {
        launchedAt,
        coreReadyAt,
        coreExitAt,
        pcPids,
        secondInstances: () => secondInstances,
        turnsDone: () => turnsDone,
        crashCore: () => {
          supervisor.crash();
        },
        openCenter: showCenter,
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
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void supervisor
      .stop(() => {
        if (core) post(core, { type: 'core.stop' });
      })
      .finally(() => {
        log.info('desktop.quit');
        app.quit();
      });
  });
  // ESM без top-level await навколо whenReady: подія ready настає лише після завантаження модуля.
  void app.whenReady().then(start);
}
