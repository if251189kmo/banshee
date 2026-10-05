import { describe, expect, it } from 'vitest';
import {
  changeVerdict,
  defaultSettings,
  loadSettings,
  migrateSettings,
  parseSetting,
  sectionOf,
  SETTING_KEYS,
  SETTINGS,
  toStored,
} from './settings.ts';

describe('схема налаштувань', () => {
  it('кожне типове значення проходить свою схему', () => {
    for (const key of SETTING_KEYS) {
      expect(parseSetting(key, SETTINGS[key].defaultValue), key).toMatchObject({ ok: true });
    }
  });

  it('кожен пункт має розділ, підпис і опис українською', () => {
    for (const key of SETTING_KEYS) {
      expect(() => sectionOf(key)).not.toThrow();
      expect(SETTINGS[key].label, key).toMatch(/[а-яіїєґ]/i);
      expect(SETTINGS[key].description, key).toMatch(/[а-яіїєґ]/i);
    }
  });

  it('типові значення з 10-settings.md', () => {
    const settings = defaultSettings();
    expect(settings['ai.limits']).toEqual({ dayUsd: 1, monthUsd: 20 });
    expect(settings['general.hotkeys']).toEqual({
      overlay: 'Ctrl+Shift+B',
      micPause: 'Ctrl+Shift+M',
      stop: 'Ctrl+Shift+X',
    });
    expect(settings['voice.tts']).toEqual({ voice: 'tetiana', speed: 1 });
    expect(settings['voice.endPauseSec']).toBe(0.5);
    expect(settings['security.voiceConfirm']).toEqual({ enabled: true, seconds: 8 });
    expect(settings['security.massOperationFiles']).toBe(20);
    expect(settings['learning.transcriptDays']).toBe(90);
  });

  it('типові значення не спільні між викликами', () => {
    const first = defaultSettings();
    first['security.projectFolders'].push('D:\\Projects');
    expect(defaultSettings()['security.projectFolders']).toEqual([]);
  });

  it('відкидає значення поза межами з поясненням українською', () => {
    const tooLow = parseSetting('voice.endPauseSec', 0.1);
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.error).toMatch(/[а-яі]/i);
    expect(parseSetting('ai.limits', { dayUsd: 30, monthUsd: 20 })).toMatchObject({ ok: false });
    expect(
      parseSetting('general.hotkeys', {
        overlay: 'Ctrl+Shift+B',
        micPause: 'Ctrl+Shift+B',
        stop: 'Ctrl+Shift+X',
      }),
    ).toMatchObject({ ok: false, error: 'Гарячі клавіші мають бути різними' });
    expect(
      parseSetting('general.hotkeys', { overlay: 'B', micPause: 'Ctrl+M', stop: 'Ctrl+X' }).ok,
    ).toBe(false);
    expect(parseSetting('security.projectFolders', ['projects']).ok).toBe(false);
    expect(parseSetting('security.projectFolders', ['D:\\work-project\\banshee']).ok).toBe(true);
  });

  it('ID моделі — без дати, і для кожної моделі є ціна', () => {
    const models = SETTINGS['ai.models'].defaultValue;
    expect(parseSetting('ai.models', { ...models, default: 'claude-haiku-4-5-20251001' }).ok).toBe(
      false,
    );
    expect(parseSetting('ai.models', { ...models, complex: 'claude-opus-5-5' }).ok).toBe(false);
  });
});

describe('налаштування з БД', () => {
  it('зіпсоване й невідоме не кладе старт: типове значення й пояснення', () => {
    const { settings, problems } = loadSettings([
      toStored('voice.endPauseSec', 0.8),
      { key: 'voice.followUp', valueJson: '{"enabled":true,"seconds":99}', scope: 'user' },
      { key: 'general.theme', valueJson: 'не json', scope: 'user' },
      { key: 'voice.removed', valueJson: 'true', scope: 'user' },
    ]);
    expect(settings['voice.endPauseSec']).toBe(0.8);
    expect(settings['voice.followUp']).toEqual({ enabled: true, seconds: 5 });
    expect(settings['general.theme']).toBe('system');
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/voice\.removed/);
  });

  it('рядок для БД — JSON і рівень з схеми', () => {
    expect(toStored('ai.enabled', false)).toEqual({
      key: 'ai.enabled',
      valueJson: 'false',
      scope: 'device',
    });
  });
});

describe('хто може змінити налаштування', () => {
  it('самонавчання — ніколи', () => {
    expect(changeVerdict('voice.tts', { voice: 'tetiana', speed: 0.9 }, 'learning').allowed).toBe(
      false,
    );
  });

  it('голосом — 🟡, безпекові й грошові — ні', () => {
    expect(changeVerdict('voice.tts', { voice: 'tetiana', speed: 0.9 }, 'voice')).toEqual({
      allowed: true,
      confirm: 'voice',
    });
    expect(changeVerdict('ai.limits', { dayUsd: 5, monthUsd: 50 }, 'voice').allowed).toBe(false);
    expect(changeVerdict('security.voiceFilter', false, 'voice').allowed).toBe(false);
    expect(changeVerdict('general.autostart', false, 'voice').allowed).toBe(false);
  });

  it('ШІ голосом вимикається одразу, вмикається з підтвердженням', () => {
    expect(changeVerdict('ai.enabled', false, 'voice')).toEqual({ allowed: true, confirm: 'none' });
    expect(changeVerdict('ai.enabled', true, 'voice')).toEqual({ allowed: true, confirm: 'voice' });
  });

  it('у центрі керування безпекові — з підтвердженням кліком', () => {
    expect(changeVerdict('security.massOperationFiles', 50, 'ui')).toEqual({
      allowed: true,
      confirm: 'click',
    });
    expect(changeVerdict('general.theme', 'dark', 'ui')).toEqual({
      allowed: true,
      confirm: 'none',
    });
  });

  it('синхронізація — лише налаштування користувача; безпекові діють після кліку на цьому ПК', () => {
    expect(changeVerdict('voice.microphone', 'usb', 'sync').allowed).toBe(false);
    expect(changeVerdict('security.massOperationFiles', 50, 'sync')).toEqual({
      allowed: true,
      confirm: 'click',
    });
    expect(changeVerdict('voice.endPauseSec', 0.7, 'sync')).toEqual({
      allowed: true,
      confirm: 'none',
    });
  });
});

describe('міграції налаштувань', () => {
  const migrations = [
    {
      from: 1,
      migrate: ({ 'voice.pause': pause, ...rest }: Readonly<Record<string, unknown>>) => ({
        ...rest,
        'voice.endPauseSec': pause,
      }),
    },
    { from: 2, migrate: (values: Readonly<Record<string, unknown>>) => ({ ...values, v3: true }) },
  ];

  it('переводить по одній версії за крок', () => {
    expect(migrateSettings({ 'voice.pause': 0.7 }, 1, migrations, 3)).toEqual({
      'voice.endPauseSec': 0.7,
      v3: true,
    });
    expect(migrateSettings({ a: 1 }, 3, migrations, 3)).toEqual({ a: 1 });
  });

  it('новіша версія чи пропущена міграція — помилка', () => {
    expect(() => migrateSettings({}, 4, migrations, 3)).toThrow('новішої версії');
    expect(() => migrateSettings({}, 0, migrations, 3)).toThrow('з версії 0');
  });
});
