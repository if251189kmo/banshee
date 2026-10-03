#!/usr/bin/env node
// PostToolUse-хук: проганяє eslint --fix по щойно зміненому файлу.
// Код виходу 2 повертає stderr назад у Claude Code, тож модель бачить помилку
// одразу після запису, а не на коміті.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const LINTABLE = /\.(ts|tsx|mts|cts)$/;
const ESLINT = 'node_modules/eslint/bin/eslint.js';

function readStdin() {
  return new Promise(resolve => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (raw += chunk));
    process.stdin.on('end', () => resolve(raw));
  });
}

const raw = await readStdin();

let filePath;
try {
  filePath = JSON.parse(raw)?.tool_input?.file_path;
} catch {
  process.exit(0);
}

const isLintable = Boolean(filePath) && LINTABLE.test(filePath);
// До етапу 1 eslint ще не встановлено: тоді хук мовчить, а не повертає помилку на кожен запис.
if (!isLintable || !existsSync(ESLINT)) process.exit(0);

try {
  execFileSync(process.execPath, [ESLINT, filePath, '--fix', '--max-warnings', '0', '--no-warn-ignored'], {
    stdio: 'pipe',
  });
} catch (error) {
  const report = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  console.error(report || `eslint впав на ${filePath}`);
  process.exit(2);
}
