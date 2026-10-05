import { describe, expect, it } from 'vitest';
import { repairToolInput } from './brain/tool-input.ts';
import { routinePhrase, systemInfoPhrase } from './phrases.ts';

const NOW = new Date(2026, 9, 5, 9, 7);

describe('фрази після дії', () => {
  it('стан ПК — словами, бо після простої дії модель уже не говорить', () => {
    expect(
      systemInfoPhrase(
        'disk',
        {
          disk: [
            { drive: 'C:', freeGb: 8.1, sizeGb: 111.2 },
            { drive: 'D:', freeGb: 69.8, sizeGb: 557.2 },
          ],
        },
        NOW,
      ),
    ).toBe('Вільно: C — 8,1 гігабайт, D — 69,8 гігабайт.');
    expect(
      systemInfoPhrase(
        'network',
        { network: [{ adapter: 'Wi-Fi', ipv4: '192.168.0.215', connected: true }] },
        NOW,
      ),
    ).toBe('Інтернет є: Wi-Fi, адреса 192.168.0.215.');
    expect(systemInfoPhrase('network', { network: [] }, NOW)).toBe('Інтернету немає.');
    expect(systemInfoPhrase('battery', { battery: null }, NOW)).toBe(
      'Батареї немає: це стаціонарний ПК.',
    );
    expect(systemInfoPhrase('date', {}, NOW)).toBe('Сьогодні понеділок, 5 жовтня.');
  });

  it('рутина: гучність, програма, ШІ', () => {
    expect(
      routinePhrase({ tool: 'volume', args: { level: 30 } }, '{"ok":true,"level":30}', NOW),
    ).toBe('Гучність 30 відсотків.');
    expect(
      routinePhrase(
        { tool: 'open_app', args: { app: 'Calculator' } },
        '{"opened":"Калькулятор"}',
        NOW,
      ),
    ).toBe('Відкриваю Калькулятор.');
    expect(
      routinePhrase({ tool: 'settings.set', args: { key: 'ai.enabled', value: false } }, '{}', NOW),
    ).toBe('Базовий режим: ШІ вимкнено.');
  });
});

describe('аргументи від моделі', () => {
  it('шлях з одним «\\»: керівні символи стають назад «\\t», «\\n»', () => {
    expect(repairToolInput({ op: 'move', paths: ['D:\temp\notes.txt'], dest: 'Desktop' })).toEqual({
      op: 'move',
      paths: ['D:\\temp\\notes.txt'],
      dest: 'Desktop',
    });
    expect(repairToolInput({ script: 'Get-Date\nGet-Process' })).toEqual({
      script: 'Get-Date\nGet-Process',
    });
    expect(repairToolInput(null)).toBeNull();
  });
});
