// Міст до core й головного процесу з preload (src/preload/index.ts): сторінка бачить лише ці функції.
/// <reference types="vite/client" />
import type { DesktopMessage } from '@banshee/shared';
import type { InvokeChannel, UiToMain } from '../shared/ui.ts';

declare global {
  /** Версія з package.json, підставляє збірка (electron.vite.config.ts). */
  const __APP_VERSION__: string;

  interface BansheeBridge {
    send(message: DesktopMessage): void;
    onMessage(listener: (message: unknown) => void): () => void;
    onConnect(listener: () => void): () => void;
    ui(command: UiToMain): void;
    invoke(channel: InvokeChannel): Promise<unknown>;
    onUi(listener: (command: unknown) => void): () => void;
  }

  /** Вікно звуку (src/preload/audio.ts): керування мікрофоном від головного процесу. */
  interface BansheeAudioBridge {
    onControl(listener: (control: unknown) => void): void;
  }

  interface Window {
    readonly banshee: BansheeBridge;
    readonly bansheeAudio: BansheeAudioBridge;
  }
}

export {};
