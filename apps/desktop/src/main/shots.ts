// Знімки інтерфейсу для перевірки вигляду (`--ui-shots`, крок 1.7): центр керування в кожному розділі
// й оверлей, у світлій і темній темах. Працює в окремій теці перевірки, без ключа Claude; команди —
// лише ті, що нічого не змінюють на ПК: «котра година», «яке сьогодні число».
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Log } from '@banshee/shared/log';
import { nativeTheme, type BrowserWindow } from 'electron';
import type { UiToWindow } from '../shared/ui.ts';

export interface ShotsTarget {
  readonly coreReadyAt: readonly number[];
  openCenter(): BrowserWindow;
  openOverlay(): BrowserWindow;
  command(text: string): void;
  readonly log: Log;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('не дочекалися core');
    await sleep(50);
  }
}

const VIEWS: readonly { name: string; command: UiToWindow }[] = [
  { name: 'overview', command: { type: 'center.section', section: 'overview' } },
  { name: 'activity', command: { type: 'center.section', section: 'activity' } },
  { name: 'journal', command: { type: 'center.section', section: 'journal' } },
  { name: 'settings-general', command: { type: 'center.section', section: 'settings' } },
  {
    name: 'settings-brain',
    command: { type: 'center.section', section: 'settings', anchor: 'brain' },
  },
  {
    name: 'settings-security',
    command: { type: 'center.section', section: 'settings', anchor: 'security.massOperationFiles' },
  },
  { name: 'wizard', command: { type: 'center.section', section: 'wizard' } },
];

async function capture(win: BrowserWindow, file: string): Promise<void> {
  const image = await win.webContents.capturePage();
  writeFileSync(file, image.toPNG());
}

export async function runShots(target: ShotsTarget, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await waitFor(() => target.coreReadyAt.length > 0, 30_000);
  target.command('котра година');
  target.command('яке сьогодні число');
  target.command('розкажи щось цікаве про космос');
  const center = target.openCenter();
  center.setSize(1040, 760);
  await sleep(1500);
  for (const theme of ['light', 'dark'] as const) {
    nativeTheme.themeSource = theme;
    for (const view of VIEWS) {
      center.webContents.send('ui', view.command);
      await sleep(700);
      await capture(center, join(dir, `${theme}-${view.name}.png`));
    }
    // Оверлей з клавіатури: набрати команду й Enter — як власник.
    const overlay = target.openOverlay();
    await sleep(500);
    for (const char of 'котра година')
      overlay.webContents.sendInputEvent({ type: 'char', keyCode: char });
    overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    overlay.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await sleep(1200);
    await capture(overlay, join(dir, `${theme}-overlay.png`));
  }
  nativeTheme.themeSource = 'system';
  target.log.info('ui-shots', { dir });
}
