#!/usr/bin/env node
// PostToolUse-хук: форматує щойно змінений файл Prettier і проганяє по ньому eslint --fix.
// Код виходу 2 повертає stderr назад у Claude Code, тож модель бачить помилку
// одразу після запису, а не на коміті.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const LINTABLE = /\.(ts|tsx|mts|cts)$/;
const ESLINT = 'node_modules/eslint/bin/eslint.js';
const PRETTIER = 'node_modules/prettier/bin/prettier.cjs';

function readStdin() {
  return new Promise(resolve => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (raw += chunk));
    process.stdin.on('end', () => resolve(raw));
  });
}

function run(script, args) {
  execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
}

const raw = await readStdin();

let filePath;
try {
  filePath = JSON.parse(raw)?.tool_input?.file_path;
} catch {
  process.exit(0);
}

const isLintable = Boolean(filePath) && LINTABLE.test(filePath);
// Поки інструментів немає в node_modules, хук мовчить, а не повертає помилку на кожен запис.
if (!isLintable || !existsSync(ESLINT)) process.exit(0);

try {
  if (existsSync(PRETTIER)) run(PRETTIER, ['--write', '--log-level', 'warn', filePath]);
  run(ESLINT, [filePath, '--fix', '--max-warnings', '0', '--no-warn-ignored']);
} catch (error) {
  const report = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  console.error(report || `lint-fix впав на ${filePath}`);
  process.exit(2);
}
