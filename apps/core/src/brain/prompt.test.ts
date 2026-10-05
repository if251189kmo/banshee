import { describe, expect, it } from 'vitest';
import { buildSystem, SYSTEM_PROMPT } from './prompt.ts';

describe('системний промпт', () => {
  it('одна точка кешу з TTL 1 год — на профілі, останньому блоці', () => {
    const system = buildSystem('# Owner profile');
    expect(system.map((block) => block.cache_control)).toEqual([
      undefined,
      { type: 'ephemeral', ttl: '1h' },
    ]);
    expect(system[0]?.text).toBe(SYSTEM_PROMPT);
  });

  it('шляхи в прикладах зберігають бекслеші', () => {
    expect(SYSTEM_PROMPT).toContain('folder "D:\\logs"');
    expect(SYSTEM_PROMPT).toContain('Pictures\\Screenshots');
  });

  it('без сьогоднішньої дати: дата й час стоять у тексті ходу', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(SYSTEM_PROMPT).not.toContain(today);
  });
});
