import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { weekday } from '../turn.ts';
import { parseDataset, withTexts, type CaseKind } from './dataset.ts';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../evals/commands.json', import.meta.url), 'utf8'),
);

function withCases(cases: unknown[]): unknown {
  return { now: '2026-10-05T10:30', cases };
}

describe('evals/commands.json', () => {
  const dataset = parseDataset(raw);

  it('50 команд, склад з 07-quality.md: 60 % / 25 % / 10 % / 5 %', () => {
    const count = (kind: CaseKind): number =>
      dataset.cases.filter((item) => item.kind === kind).length;
    expect(dataset.cases).toHaveLength(50);
    expect([count('single'), count('multi'), count('clarify'), count('refuse')]).toEqual([
      30, 12, 5, 3,
    ]);
  });

  it('команди не повторюються', () => {
    const texts = dataset.cases.map((item) => item.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('команди з порядком мають щонайменше два кроки', () => {
    for (const item of dataset.cases.filter((entry) => entry.ordered)) {
      expect(item.calls.length, item.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('дата набору — понеділок, від неї рахуються «вчора» й «за три дні»', () => {
    expect(dataset.now).toEqual({ date: '2026-10-05', time: '10:30' });
    expect(weekday(dataset.now.date)).toBe('Monday');
  });
});

describe('parseDataset', () => {
  it('приймає мінімальну команду з типовими полями', () => {
    const dataset = parseDataset(
      withCases([{ id: 'lock', kind: 'single', text: 'заблокуй', calls: [{ tool: 'lock_pc' }] }]),
    );
    expect(dataset.cases[0]).toEqual({
      id: 'lock',
      kind: 'single',
      text: 'заблокуй',
      source: 'voice',
      calls: [{ tool: 'lock_pc', args: {} }],
      alt: [],
      ordered: false,
      stubs: {},
    });
  });

  it('перелічує всі помилки одразу', () => {
    const run = (): unknown =>
      parseDataset(
        withCases([
          { id: 'a', kind: 'single', text: 'x', calls: [{ tool: 'format_disk' }] },
          { id: 'b', kind: 'single', text: 'y', calls: [{ tool: 'volume', args: { loud: 1 } }] },
          { id: 'c', kind: 'single', text: 'z' },
          { id: 'd', kind: 'clarify', text: 'w', calls: [{ tool: 'lock_pc' }] },
          { id: 'e', kind: 'single', text: 'v', calls: [{ tool: 'volume', args: { level: {} } }] },
          { id: 'a', kind: 'refuse', text: 'u' },
        ]),
      );
    expect(run).toThrow(/невідомий інструмент format_disk/);
    expect(run).toThrow(/volume не має аргументу loud/);
    expect(run).toThrow(/c: для single потрібні calls/);
    expect(run).toThrow(/d: для clarify викликів не має бути/);
    expect(run).toThrow(/e\.calls\[0\]: незрозуміле очікування для level/);
    expect(run).toThrow(/a: id повторюється/);
  });

  it('відкидає файл без now або cases', () => {
    expect(() => parseDataset({ cases: [] })).toThrow(/now/);
    expect(() => parseDataset({ now: '2026-10-05', cases: [] })).toThrow(/2026-10-05T10:30/);
  });
});

describe('withTexts', () => {
  const { cases } = parseDataset(raw);

  it('підміняє тексти розпізнаними, джерело — голос; без тексту команда випадає', () => {
    const voiced = withTexts(cases, { 'app-chrome': 'Відкрий Chrome.' });
    expect(voiced).toHaveLength(1);
    expect(voiced[0]).toMatchObject({ id: 'app-chrome', text: 'Відкрий Chrome.', source: 'voice' });
    expect(voiced[0]?.calls).toEqual(cases.find((item) => item.id === 'app-chrome')?.calls);
  });

  it('відкидає невідомі id і не рядки', () => {
    expect(() => withTexts(cases, { nope: 'x' })).toThrow(/nope/);
    expect(() => withTexts(cases, { 'app-chrome': 1 })).toThrow(/очікується/);
  });
});
