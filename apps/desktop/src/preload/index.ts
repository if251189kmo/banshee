// Міст вікна до core (.claude/logic/01-architecture.md, «Процеси»): головний процес передає порт
// MessagePort, сторінка отримує лише send, onMessage і onConnect — без Node і без самого порту.
// Повідомлення перевіряє core на вході, а сторінка — те, що прийшло від core.
import { contextBridge, ipcRenderer } from 'electron';

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
});
