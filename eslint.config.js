// ESLint для Banshee: typescript-eslint з перевіркою типів; форматування — справа Prettier.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const BROWSER_GLOBALS = Object.fromEntries(
  [
    'window',
    'document',
    'navigator',
    'location',
    'fetch',
    'console',
    'performance',
    'requestAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'URL',
    'URLSearchParams',
    'Blob',
    'AudioContext',
    'AudioWorkletNode',
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'HTMLSelectElement',
  ].map((name) => [name, 'readonly']),
);

export default defineConfig(
  globalIgnores([
    'node_modules/',
    '**/out/',
    '**/dist/',
    '**/.data/',
    'coverage/',
    'evals/results/',
    '.claude/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    // Скрипти головного процесу Electron (крок 0.8): ESM без типів, середовище Node.
    files: ['apps/desktop/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // Сторінки прототипів працюють у браузері й AudioWorklet.
    files: ['prototypes/**/public/**/*.js'],
    languageOptions: { globals: BROWSER_GLOBALS },
  },
  prettier,
);
