import { SETTINGS, SETTING_KEYS } from '@banshee/shared';
import { describe, expect, it } from 'vitest';
import { controlFor, formatValue, sectionOf, visibleKeys } from './settings-model.ts';

describe('налаштування на сторінці', () => {
  it('кожен пункт схеми має елемент керування і розділ', () => {
    for (const key of SETTING_KEYS) {
      expect(controlFor(SETTINGS[key].schema).kind).toBeTruthy();
      expect(['general', 'voice', 'ai', 'learning', 'security', 'sync', 'storage']).toContain(
        sectionOf(key),
      );
    }
  });

  it('елементи — зі схеми: перемикач, вибір, число з межами, групи, списки', () => {
    expect(controlFor(SETTINGS['general.autostart'].schema)).toEqual({ kind: 'toggle' });
    expect(controlFor(SETTINGS['general.theme'].schema)).toEqual({
      kind: 'choice',
      options: [
        { value: 'system', label: 'Як у Windows' },
        { value: 'light', label: 'Світла' },
        { value: 'dark', label: 'Темна' },
      ],
    });
    expect(controlFor(SETTINGS['voice.endPauseSec'].schema)).toEqual({
      kind: 'number',
      min: 0.3,
      max: 2,
      integer: false,
      nullable: false,
    });
    expect(controlFor(SETTINGS['ai.credits'].schema)).toMatchObject({
      kind: 'number',
      nullable: true,
    });
    expect(controlFor(SETTINGS['ai.limits'].schema)).toMatchObject({ kind: 'group' });
    expect(controlFor(SETTINGS['security.powershellAllowlist'].schema)).toEqual({ kind: 'lines' });
    expect(controlFor(SETTINGS['security.lockedActions'].schema)).toMatchObject({ kind: 'checks' });
    expect(controlFor(SETTINGS['ai.models'].schema)).toEqual({ kind: 'json' });
  });

  it('значення словами', () => {
    const limits = controlFor(SETTINGS['ai.limits'].schema);
    expect(formatValue(limits, { dayUsd: 1, monthUsd: 20 })).toBe('на день, $ 1, на місяць, $ 20');
    expect(formatValue(controlFor(SETTINGS['voice.endPauseSec'].schema), 0.5)).toBe('0,5');
  });

  it('приховані пункти й майстер не показуються; пошук — по всіх розділах', () => {
    expect(visibleKeys('ai', '', false)).not.toContain('ai.models');
    expect(visibleKeys('ai', '', true)).toContain('ai.models');
    expect(visibleKeys('general', '', true)).not.toContain('general.setupDone');
    expect(visibleKeys('general', 'ліміт', false)).toEqual(['ai.limits']);
  });
});
