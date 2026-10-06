import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ESPEAK = join(import.meta.dirname, '..', '..', 'resources', 'espeak-ng-data');

describe('дані вимови espeak-ng у ресурсах програми', () => {
  it('є все, без чого озвучка падає', () => {
    // en_dict потрібен і українському голосу: espeak перемикається на англійські правила для
    // деяких слів («…п'ятдесят вісім.»), і без цього словника процес voice падав (0xC0000005).
    for (const file of [
      'phondata',
      'phonindex',
      'phontab',
      'intonations',
      'uk_dict',
      'en_dict',
      join('lang', 'zle', 'uk'),
    ])
      expect(existsSync(join(ESPEAK, file)), file).toBe(true);
  });
});
