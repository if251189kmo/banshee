// Збірка desktop (.claude/logic/01-architecture.md, «Розробка»): electron-vite — головний процес, core
// і mcp/pc окремими входами (`?modulePath`), preload і сторінка React. Пакети @banshee/* — вихідний
// TypeScript, тож Vite збирає їх разом із залежностями; зовнішніми лишаються лише нативні модулі
// з `dependencies` — вони беруться з node_modules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  main: {},
  preload: {
    // Ізольований preload (sandbox) вантажиться лише як CommonJS.
    build: { rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: {
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    // Дві сторінки: центр керування й оверлей.
    build: {
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
          overlay: fileURLToPath(new URL('./src/renderer/overlay.html', import.meta.url)),
        },
      },
    },
  },
});
