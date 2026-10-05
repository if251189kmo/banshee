import { describe, expect, it } from 'vitest';
import { findTool, TOOLS, toolDefinitions } from './definitions.ts';

// Ключові слова, яких strict-схеми не приймають (400 від API).
const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
];

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...keysDeep(item)]);
}

function schemaOf(name: string): {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  const schema = findTool(name)?.definition.input_schema;
  return {
    properties: schema?.properties ?? {},
    required: schema?.required ?? [],
  };
}

const namesWith = (flag: 'final' | 'allowWhenLocked' | 'readOnly'): string[] =>
  TOOLS.filter((item) => item.meta[flag]).map((item) => item.definition.name);

describe('інструменти етапу 1', () => {
  it('11 інструментів ПК з 01-architecture.md і escalate — у сталому порядку', () => {
    expect(TOOLS.map((item) => item.definition.name)).toEqual([
      'open_app',
      'close_app',
      'volume',
      'media',
      'window',
      'open_target',
      'find_files',
      'file_op',
      'run_powershell',
      'system_info',
      'lock_pc',
      'escalate',
    ]);
  });

  it('позначки final, locked і рівні — як у таблиці 01-architecture.md', () => {
    expect(namesWith('final')).toEqual([
      'open_app',
      'volume',
      'media',
      'window',
      'open_target',
      'system_info',
      'lock_pc',
    ]);
    expect(namesWith('allowWhenLocked')).toEqual(['volume', 'media', 'system_info']);
    expect(namesWith('readOnly')).toEqual(['find_files', 'system_info']);
    const yellow = TOOLS.filter((item) => item.meta.level === 'yellow');
    expect(yellow.map((item) => item.definition.name)).toEqual([
      'close_app',
      'file_op',
      'run_powershell',
    ]);
  });

  it('кожна схема сумісна зі strict: additionalProperties false, required з наявних полів', () => {
    for (const { definition } of TOOLS) {
      expect('strict' in definition).toBe(false);
      expect(definition.input_schema.additionalProperties).toBe(false);
      const { properties, required } = schemaOf(definition.name);
      for (const name of required) expect(Object.keys(properties)).toContain(name);
      for (const property of Object.values(properties)) {
        expect(typeof property.description).toBe('string');
      }
      expect(keysDeep(definition.input_schema).filter((key) => UNSUPPORTED.includes(key))).toEqual(
        [],
      );
    }
  });

  it('необов’язкових параметрів не більше 24 на всі strict-інструменти', () => {
    const optional = TOOLS.reduce((sum, { definition }) => {
      const { properties, required } = schemaOf(definition.name);
      return sum + Object.keys(properties).filter((name) => !required.includes(name)).length;
    }, 0);
    expect(optional).toBeLessThanOrEqual(24);
  });

  it('описи кажуть, коли викликати інструмент', () => {
    for (const { definition } of TOOLS) expect(definition.description).toMatch(/Call this/);
  });

  it('визначення однакові між викликами — інакше кеш префікса не спрацює', () => {
    expect(JSON.stringify(toolDefinitions())).toBe(JSON.stringify(toolDefinitions()));
    expect(findTool('format_disk')).toBeUndefined();
  });
});
