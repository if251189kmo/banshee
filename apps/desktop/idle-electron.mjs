// Крок 0.8: ресурси в спокої всередині Electron — модель слова, VAD, відбиток голосу й Parakeet у
// головному процесі плюс процеси Chromium (GPU, мережа), бо N6 рахує весь Banshee, а не лише Node.
// Запуск: npm run desktop:idle. Результат — .data/idle-electron.json (консолі в Electron на Windows немає).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';

const root = join(import.meta.dirname, '..', '..');

void app.whenReady().then(async () => {
  const result = { electron: process.versions.electron };
  try {
    const { measureIdle } = await import(pathToFileURL(join(root, 'prototypes/idle/run.ts')).href);
    result.node = await measureIdle();
    const metrics = app.getAppMetrics();
    result.processes = metrics.map((metric) => ({
      type: metric.type,
      cpuPct: Number(metric.cpu.percentCPUUsage.toFixed(2)),
      workingSetMb: Math.round(metric.memory.workingSetSize / 1024),
    }));
    result.totalWorkingSetMb = result.processes.reduce((sum, item) => sum + item.workingSetMb, 0);
  } catch (error) {
    result.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  }
  writeFileSync(join(root, '.data/idle-electron.json'), JSON.stringify(result, null, 2));
  app.quit();
});
