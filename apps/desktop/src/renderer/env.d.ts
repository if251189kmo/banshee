// Міст до core з preload (src/preload/index.ts): сторінка бачить лише ці три функції.
/// <reference types="vite/client" />
import type { DesktopMessage } from '@banshee/shared';
import type { UiToMain } from '../shared/ui.ts';

declare global {
  /** Версія з package.json, підставляє збірка (electron.vite.config.ts). */
  const __APP_VERSION__: string;

  interface BansheeBridge {
    send(message: DesktopMessage): void;
    onMessage(listener: (message: unknown) => void): () => void;
    onConnect(listener: () => void): () => void;
    ui(command: UiToMain): void;
    onUi(listener: (command: unknown) => void): () => void;
  }

  interface Window {
    readonly banshee: BansheeBridge;
  }
}

export {};
