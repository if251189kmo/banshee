import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AI_STATES, isBasicMode } from '@banshee/shared';
import { describe, expect, it } from 'vitest';
import { parseDataset } from '../../../../scripts/lib/evals/dataset.ts';
import { matchCall } from '../../../../scripts/lib/evals/grade.ts';
import { BUILTIN_ROUTINES } from './builtins.ts';
import { matchRoutine } from './match.ts';
import { route } from './router.ts';

const dataset = parseDataset(
  JSON.parse(readFileSync(resolve('evals/commands.json'), 'utf8')) as unknown,
);

describe('рутини без LLM', () => {
  it('впізнає вбудовані команди з числами й назвами', () => {
    const volume = matchRoutine('зроби гучність на тридцять');
    expect(volume.kind === 'match' && volume.match.steps).toEqual([
      { tool: 'volume', args: { level: 30 } },
    ]);
    const app = matchRoutine('Banshee, запусти тєлєгу');
    expect(app.kind === 'match' && app.match.steps).toEqual([
      { tool: 'open_app', args: { app: 'Telegram' } },
    ]);
    const window = matchRoutine('розгорни хром на весь екран');
    expect(window.kind === 'match' && window.match.steps).toEqual([
      { tool: 'window', args: { action: 'maximize', app: 'Google Chrome' } },
    ]);
  });

  it('гучність поза 0–100 і невідома назва — не рутина', () => {
    expect(matchRoutine('гучність сто двадцять').kind).toBe('none');
    expect(matchRoutine('закрий його').kind).toBe('none');
    expect(matchRoutine('відкрий проект банші').kind).toBe('none');
  });

  it('дві однаково схожі рутини — сумнів', () => {
    const twin = { id: 'owner.twin', templates: ['постав на паузу'], steps: [] };
    expect(matchRoutine('постав на паузу', { routines: [...BUILTIN_ROUTINES, twin] }).kind).toBe(
      'ambiguous',
    );
  });
});

describe('маршрутизація', () => {
  it('керування діє завжди, навіть зі словом активації', () => {
    expect(route('Banshee, стоп', { ai: 'off' })).toEqual({ kind: 'control', command: 'stop' });
    expect(route('скасуй', { ai: 'active' })).toEqual({ kind: 'control', command: 'undo' });
    expect(route('нова розмова', { ai: 'billing' })).toEqual({
      kind: 'control',
      command: 'new_episode',
    });
  });

  it('без рутини: ШІ активний — Haiku; базовий режим — відповідь з причиною', () => {
    expect(route('знайди моє резюме', { ai: 'active' })).toEqual({
      kind: 'llm',
      reason: 'no_routine',
    });
    expect(route('знайди моє резюме', { ai: 'day_limit' })).toEqual({
      kind: 'none',
      state: 'day_limit',
      reply: 'Ліміт на сьогодні вичерпано. Дозволити ще $1?',
    });
  });

  it('у базовому режимі — 0 запитів до API на всіх 50 командах еталонного набору', () => {
    for (const state of AI_STATES.filter(isBasicMode)) {
      for (const item of dataset.cases) {
        expect(route(item.text, { ai: state }).kind, item.id).not.toBe('llm');
      }
    }
  });

  it('вбудовані рутини на еталонному наборі: лише правильні дії, уточнення й відмови — не рутини', () => {
    const handled: string[] = [];
    for (const item of dataset.cases) {
      const result = route(item.text, { ai: 'off' });
      if (result.kind !== 'routine') continue;
      handled.push(item.id);
      expect(item.kind, item.id).toBe('single');
      const expected = item.calls;
      expect(result.match.steps, item.id).toHaveLength(expected.length);
      result.match.steps.forEach((step, index) => {
        const call = expected[index];
        expect(call && matchCall(call, { name: step.tool, input: step.args }), item.id).toBe(true);
      });
    }
    // 21 однокрокова команда з 30 «single» виконується без ШІ; решта — пошук файлів, PowerShell,
    // налаштування Windows, назви з профілю власника.
    expect(handled).toHaveLength(21);
  });
});
