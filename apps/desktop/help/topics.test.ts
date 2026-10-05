// Тест довідки (.claude/logic/09-ui.md, «Довідка»): кожне посилання веде на наявний розділ чи
// налаштування; теми покривають функції етапу 1.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inlines,
  parseTopic,
  resolveLink,
  SECTION_TOPIC,
  topicId,
} from '../src/renderer/help/help-model.ts';

const dir = import.meta.dirname;
const topics = readdirSync(dir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => parseTopic(topicId(file), readFileSync(join(dir, file), 'utf8')));
const ids = topics.map((topic) => topic.id);

describe('довідка в програмі', () => {
  it('12 тем з таблиці 09-ui.md, кожна з заголовком', () => {
    expect(ids).toEqual([
      'start',
      'calling',
      'abilities',
      'safety',
      'voice',
      'memory',
      'ai-costs',
      'sync',
      'privacy',
      'hotkeys',
      'troubleshooting',
      'requirements',
    ]);
    for (const topic of topics) expect(topic.title).not.toBe(topic.id);
  });

  it('кожна тема закінчується посиланнями, і кожне веде на наявний розділ', () => {
    for (const topic of topics) {
      const links = topic.blocks.filter((block) => block.kind === 'link');
      expect(links.length, topic.id).toBeGreaterThan(0);
      for (const link of links) {
        expect(resolveLink(link.target, ids), `${topic.id}: ${link.target}`).not.toBeNull();
        expect(link.text.startsWith('Відкрити: '), link.text).toBe(true);
      }
    }
  });

  it('теми — 5–10 рядків простою мовою', () => {
    for (const topic of topics) {
      const text = topic.blocks.filter((block) => block.kind !== 'link');
      expect(text.length, topic.id).toBeGreaterThan(0);
      expect(text.length, topic.id).toBeLessThanOrEqual(10);
    }
  });

  it('F1 кожного розділу веде на наявну тему', () => {
    for (const topic of Object.values(SECTION_TOPIC)) expect(ids).toContain(topic);
  });

  it('хибні адреси не відкриваються', () => {
    expect(resolveLink('settings/no.such', ids)).toBeNull();
    expect(resolveLink('journal/x', ids)).toBeNull();
    expect(resolveLink('help/no-topic', ids)).toBeNull();
    expect(resolveLink('https://example.com', ids)).toBeNull();
    expect(resolveLink('settings/ai.limits', ids)).toEqual({
      section: 'settings',
      anchor: 'ai.limits',
    });
  });

  it('розмітка: жирне, код, таблиця', () => {
    expect(inlines('**Так** — `Enter`')).toEqual([
      { kind: 'bold', text: 'Так' },
      { kind: 'text', text: ' — ' },
      { kind: 'code', text: 'Enter' },
    ]);
    const hotkeys = topics.find((topic) => topic.id === 'hotkeys');
    const table = hotkeys?.blocks.find((block) => block.kind === 'table');
    expect(table?.kind === 'table' ? table.rows.length : 0).toBe(7);
  });
});
