// Міст вікна до core й головного процесу (.claude/logic/01-architecture.md, «Процеси»): головний
// процес передає порт MessagePort, сторінка отримує лише функції нижче — без Node і без самого
// порту. Повідомлення перевіряє core на вході, а сторінка — те, що прийшло від core; команди вікна
// перевіряє головний процес (src/shared/ui.ts).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type Listener = (message: unknown) => void;

let port: MessagePort | null = null;
const listeners = new Set<Listener>();
const connectListeners = new Set<() => void>();

// Новий порт — після завантаження сторінки й після кожного перезапуску core.
ipcRenderer.on('core:port', (event) => {
  const [next] = event.ports;
  if (!next) return;
  port?.close();
  port = next;
  next.onmessage = (message: MessageEvent<unknown>) => {
    for (const listener of listeners) listener(message.data);
  };
  for (const listener of connectListeners) listener();
});

contextBridge.exposeInMainWorld('banshee', {
  send(message: unknown): void {
    port?.postMessage(message);
  },
  onMessage(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onConnect(listener: () => void): () => void {
    connectListeners.add(listener);
    if (port) listener();
    return () => {
      connectListeners.delete(listener);
    };
  },
  /** Команда головному процесу: сховати оверлей, відкрити розділ, посилання в браузері. */
  ui(command: unknown): void {
    ipcRenderer.send('ui', command);
  },
  /** Запит до головного процесу: «Про програму», діагностика, «Видалити всі дані», моделі голосу. */
  invoke(channel: unknown): Promise<unknown> {
    return channel === 'about' ||
      channel === 'diagnostics' ||
      channel === 'erase' ||
      channel === 'voiceModels'
      ? ipcRenderer.invoke(`ui:${channel}`)
      : Promise.reject(new Error('Невідомий запит'));
  },
  onUi(listener: Listener): () => void {
    const handler = (_event: IpcRendererEvent, command: unknown) => {
      listener(command);
    };
    ipcRenderer.on('ui', handler);
    return () => {
      ipcRenderer.off('ui', handler);
    };
  },
});
