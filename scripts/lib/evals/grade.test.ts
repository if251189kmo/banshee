import { describe, expect, it } from 'vitest';
import type { EvalCase, ExpectedCall } from './dataset.ts';
import {
  gradeCase,
  matchArg,
  writtenCall,
  type Outcome,
  type StopKind,
  type ToolCall,
} from './grade.ts';

function evalCase(fields: Partial<EvalCase>): EvalCase {
  return {
    id: 'case',
    kind: 'single',
    text: 'команда',
    source: 'voice',
    calls: [],
    alt: [],
    ordered: false,
    stubs: {},
    ...fields,
  };
}

const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ name, input });
const expected = (tool: string, args: ExpectedCall['args'] = {}): ExpectedCall => ({ tool, args });

function outcome(calls: ToolCall[], finalText = '', stop: StopKind = 'end_turn'): Outcome {
  return { calls, finalText, stop };
}

describe('matchArg', () => {
  it('рядок — без регістру, пробілів по краях і різниці між / та \\', () => {
    expect(matchArg('D:\\Temp\\notes.txt', ' d:/temp/NOTES.txt ')).toBe(true);
    expect(matchArg('telegram', 'Telegram Desktop')).toBe(false);
  });

  it('число й логічне значення — точно; null — аргументу немає', () => {
    expect(matchArg(30, 30)).toBe(true);
    expect(matchArg(30, '30')).toBe(false);
    expect(matchArg(true, true)).toBe(true);
    expect(matchArg(null, undefined)).toBe(true);
    expect(matchArg(null, 0)).toBe(false);
  });

  it('масив — фактичний містить кожен очікуваний шлях', () => {
    expect(matchArg(['C:\\a.png', 'C:\\b.png'], ['c:\\b.png', 'C:\\A.png', 'C:\\c.png'])).toBe(
      true,
    );
    expect(matchArg(['C:\\a.png'], 'C:\\a.png')).toBe(false);
  });

  it('oneOf, contains, pattern, min/max', () => {
    expect(matchArg({ oneOf: ['Calculator', 'Калькулятор'] }, 'calculator')).toBe(true);
    expect(matchArg({ contains: ['desktop', 'звіти'] }, 'C:\\Users\\o\\Desktop\\Звіти')).toBe(true);
    expect(matchArg({ contains: 'chrome' }, 'Firefox')).toBe(false);
    expect(matchArg({ pattern: 'Get-Process' }, 'get-process | sort WS')).toBe(true);
    expect(matchArg({ min: -30, max: -5 }, -10)).toBe(true);
    expect(matchArg({ min: -30, max: -5 }, 10)).toBe(false);
  });
});

describe('gradeCase: дії', () => {
  const single = evalCase({ calls: [expected('open_app', { app: { contains: 'chrome' } })] });

  it('правильний виклик — успіх', () => {
    expect(gradeCase(single, outcome([call('open_app', { app: 'Google Chrome' })]))).toEqual({
      pass: true,
      reason: '',
    });
  });

  it('зайвий виклик лише на читання не є помилкою, зайва дія — є', () => {
    const withSearch = [call('find_files', { query: '*' }), call('open_app', { app: 'Chrome' })];
    expect(gradeCase(single, outcome(withSearch)).pass).toBe(true);
    const withClose = [call('close_app', { app: 'Edge' }), call('open_app', { app: 'Chrome' })];
    expect(gradeCase(single, outcome(withClose)).reason).toMatch(/зайві дії: close_app/);
  });

  it('інший інструмент — помилка з поясненням', () => {
    const grade = gradeCase(single, outcome([call('open_target', { target: 'chrome' })]));
    expect(grade.pass).toBe(false);
    expect(grade.reason).toMatch(/очікувалось open_app.*було open_target/);
  });

  it('альтернативний набір викликів теж приймається', () => {
    const item = evalCase({
      calls: [expected('system_info', { kind: 'network' })],
      alt: [[expected('run_powershell')]],
    });
    expect(gradeCase(item, outcome([call('run_powershell', { script: 'ipconfig' })])).pass).toBe(
      true,
    );
  });

  it('порядок важить лише для ordered', () => {
    const steps = [expected('find_files'), expected('file_op', { op: 'move' })];
    const reversed = [call('file_op', { op: 'move' }), call('find_files')];
    expect(gradeCase(evalCase({ kind: 'multi', calls: steps }), outcome(reversed)).pass).toBe(true);
    expect(
      gradeCase(evalCase({ kind: 'multi', calls: steps, ordered: true }), outcome(reversed)).pass,
    ).toBe(false);
  });

  it('хід, обірваний після простої дії, позначається в причині', () => {
    const item = evalCase({
      kind: 'multi',
      calls: [expected('open_app'), expected('media', { action: 'next' })],
    });
    const grade = gradeCase(
      item,
      outcome([call('open_app', { app: 'Spotify' })], '', 'final_tools'),
    );
    expect(grade.reason).toMatch(/хід завершено після простої дії/);
  });

  it('обрізана відповідь чи безкінечний цикл — помилка', () => {
    const calls = [call('open_app', { app: 'Chrome' })];
    expect(gradeCase(single, outcome(calls, '', 'max_tokens')).reason).toMatch(/max_tokens/);
    expect(gradeCase(single, outcome(calls, '', 'max_steps')).reason).toMatch(/забагато кроків/);
  });
});

describe('виклик, записаний текстом', () => {
  it('назва інструмента з аргументами в тексті — помилка, навіть без викликів', () => {
    expect(writtenCall('"Попередня пісня." and media {"action": "previous"}')).toBe('media');
    expect(writtenCall('call: open_app with app "Notepad"')).toBe('open_app');
    expect(writtenCall('Відкриваю Telegram.')).toBeUndefined();
    const item = evalCase({ calls: [expected('media', { action: 'previous' })] });
    expect(gradeCase(item, outcome([], 'media {"action": "previous"}')).reason).toBe(
      'виклик media записано текстом, а не зроблено',
    );
  });
});

describe('gradeCase: уточнення й відмова', () => {
  it('уточнення — питання без викликів', () => {
    const item = evalCase({ kind: 'clarify' });
    expect(gradeCase(item, outcome([], 'Що саме закрити?')).pass).toBe(true);
    expect(gradeCase(item, outcome([], 'Закриваю.')).reason).toBe('у відповіді немає питання');
    expect(gradeCase(item, outcome([call('close_app', { app: 'Chrome' })], '?')).pass).toBe(false);
  });

  it('відмова — пояснення без викликів', () => {
    const item = evalCase({ kind: 'refuse' });
    expect(gradeCase(item, outcome([], 'Дзвонити я поки не вмію.')).pass).toBe(true);
    expect(gradeCase(item, outcome([], '')).reason).toBe('порожня відповідь');
    expect(gradeCase(item, outcome([call('open_app', { app: 'Telegram' })], 'Ок')).pass).toBe(
      false,
    );
  });
});
