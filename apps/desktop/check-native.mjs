// Крок 0.8: нативні модулі Banshee в головному процесі Electron (не в Node) — готові збірки на
// Node-API, без перезбирання й Build Tools. Секретів не читає: keyring лише завантажується.
// onnxruntime-node — першим: sherpa-onnx везе власний onnxruntime.dll 1.28, і якщо він завантажиться
// раніше, onnxruntime-node (1.30) отримає чужу DLL з тією самою назвою.
// Запуск: npm run desktop:check-native
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..', '..');

const checks = {
  'better-sqlite3': () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    const version = db.prepare('SELECT sqlite_version() AS v').get().v;
    db.close();
    return `SQLite ${version}`;
  },
  'onnxruntime-node': async () => {
    const ort = require('onnxruntime-node');
    const session = await ort.InferenceSession.create(
      join(root, '.data/models/oww/melspectrogram.onnx'),
    );
    return `модель ознак слова відкрито: ${session.inputNames.join(', ')}`;
  },
  'sherpa-onnx-node': () => {
    const sherpa = require('sherpa-onnx-node');
    return typeof sherpa.OfflineRecognizer === 'function'
      ? 'OfflineRecognizer є'
      : 'немає OfflineRecognizer';
  },
  '@napi-rs/keyring': () => {
    const keyring = require('@napi-rs/keyring');
    return typeof keyring.Entry === 'function' ? 'модуль завантажено' : 'немає Entry';
  },
};

// Не top-level await: у головному ESM-скрипті Electron подія ready настає лише після завантаження модуля.
void app.whenReady().then(async () => {
  const result = {
    electron: process.versions.electron,
    node: process.versions.node,
    modules: process.versions.modules,
  };
  for (const [name, check] of Object.entries(checks)) {
    try {
      result[name] = await check();
    } catch (error) {
      result[name] = `ПОМИЛКА: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  // Головний процес Electron на Windows не пише в консоль — результат іде у файл.
  writeFileSync(join(root, '.data/check-native.json'), JSON.stringify(result, null, 2));
  app.quit();
});
