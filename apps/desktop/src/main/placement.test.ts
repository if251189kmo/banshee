import { describe, expect, it } from 'vitest';
import { overlayBounds, supportsMica, toAccelerator } from './placement.ts';

describe('оверлей і клавіші', () => {
  it('оверлей по центру вгорі монітора, висота за вмістом у межах', () => {
    const area = { x: 1920, y: 0, width: 1920, height: 1040 };
    expect(overlayBounds(area, 120)).toEqual({ x: 2560, y: 72, width: 640, height: 120 });
    expect(overlayBounds(area, 10).height).toBe(64);
    expect(overlayBounds(area, 5000).height).toBe(560);
  });

  it('вузький екран: оверлей не ширший за екран', () => {
    expect(overlayBounds({ x: 0, y: 0, width: 600, height: 400 }, 300)).toEqual({
      x: 16,
      y: 72,
      width: 568,
      height: 300,
    });
  });

  it('гаряча клавіша з налаштувань — прискорювач Electron', () => {
    expect(toAccelerator('Ctrl+Shift+B')).toBe('Ctrl+Shift+B');
    expect(toAccelerator('Win+Alt+F12')).toBe('Super+Alt+F12');
  });

  it('Mica — лише з Windows 11 22H2', () => {
    expect(supportsMica('10.0.19045')).toBe(false);
    expect(supportsMica('10.0.22000')).toBe(false);
    expect(supportsMica('10.0.22621')).toBe(true);
    expect(supportsMica('10.0.26100')).toBe(true);
  });
});
