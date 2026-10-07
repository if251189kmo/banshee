// Міст вікна звуку (.claude/logic/02-voice.md, «Реалізація — етап 2»): головний процес передає порт
// до процесу voice, preload віддає його сторінці через window.postMessage — так MessagePort доходить
// до сторінки з contextIsolation. Керування мікрофоном — каналом `audio:control`. Порт і керування
// головний процес шле лише після `audio:ready`: сторінка сама каже, що слухає (інакше порт губився).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

ipcRenderer.on('audio:port', (event) => {
  const [port] = event.ports;
  if (port) window.postMessage({ type: 'banshee-audio-port' }, '*', [port]);
});

contextBridge.exposeInMainWorld('bansheeAudio', {
  onControl(listener: (control: unknown) => void): void {
    ipcRenderer.on('audio:control', (_event: IpcRendererEvent, control: unknown) => {
      listener(control);
    });
  },
  /** Сторінка підписалася на порт і керування — можна слати. */
  ready(): void {
    ipcRenderer.send('audio:ready');
  },
});
