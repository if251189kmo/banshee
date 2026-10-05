import { describe, expect, it } from 'vitest';
import { trayView } from './tray-view.ts';

describe('значок у треї', () => {
  it('ШІ активний — звичайний значок', () => {
    expect(trayView('running', 'active')).toEqual({
      icon: 'idle',
      tooltip: 'Banshee — ШІ активний',
      canRestart: false,
    });
  });

  it('базовий режим — позначка й причина в підказці', () => {
    expect(trayView('running', 'no_key')).toMatchObject({
      icon: 'basic',
      tooltip: 'Banshee — Базовий режим: немає ключа',
    });
    expect(trayView('running', 'day_limit').icon).toBe('basic');
  });

  it('core не працює — сірий значок; після 3 збоїв — «Перезапустити»', () => {
    expect(trayView('restarting', 'active')).toMatchObject({ icon: 'down', canRestart: false });
    expect(trayView('failed', null)).toMatchObject({ icon: 'down', canRestart: true });
    expect(trayView('starting', null).tooltip).toBe('Banshee — запускається…');
  });
});
