import { describe, expect, it } from 'vitest';
import { requirements, type AboutInfo } from './requirements.ts';

const pc: AboutInfo = {
  version: '0.1.0',
  electron: '44.5.1',
  packaged: true,
  windows: { name: 'Windows 10 Pro', build: 19045 },
  cpu: { model: 'Intel(R) Core(TM) i5-6600 CPU @ 3.30GHz', threads: 4 },
  ramGb: 31.9,
  root: 'D:\\Banshee',
  freeGb: 120.4,
};

describe('системні вимоги поруч з даними ПК', () => {
  it('ПК власника відповідає мінімальним вимогам', () => {
    const rows = requirements(pc);
    expect(rows.filter((row) => row.fit === 'weak')).toEqual([]);
    expect(rows.find((row) => row.item === 'Windows')?.here).toBe('Windows 10 Pro, збірка 19045');
    expect(rows.find((row) => row.item === 'Місце на диску')?.here).toBe('120,4 ГБ вільно');
  });

  it('слабший ПК — попередження в рядках, а не заборона', () => {
    const rows = requirements({
      ...pc,
      windows: { name: 'Windows 10', build: 19044 },
      cpu: { model: 'x', threads: 2 },
      ramGb: 3.9,
      freeGb: 1.2,
    });
    expect(rows.filter((row) => row.fit === 'weak').map((row) => row.item)).toEqual([
      'Windows',
      'Процесор',
      "Оперативна пам'ять",
      'Місце на диску',
    ]);
  });
});
