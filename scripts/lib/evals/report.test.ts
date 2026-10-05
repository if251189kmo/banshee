import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { MODELS } from '../models.ts';
import type { EvalCase } from './dataset.ts';
import { formatSummary, percentile, summarize, type CaseResult } from './report.ts';
import type { ModelReply } from './run-case.ts';

function reply(read: number, written: number, ttftMs: number): ModelReply {
  const usage = {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: written,
    cache_read_input_tokens: read,
    cache_creation: null,
  };
  return {
    content: [],
    stopReason: 'end_turn',
    usage: usage as unknown as Anthropic.Usage,
    model: MODELS.default,
    ttftMs,
    totalMs: ttftMs * 2,
  };
}

function result(kind: EvalCase['kind'], pass: boolean, replies: ModelReply[]): CaseResult {
  return {
    item: {
      id: kind,
      kind,
      text: kind,
      source: 'voice',
      calls: [],
      alt: [],
      ordered: false,
      stubs: {},
    },
    run: {
      calls: [],
      finalText: '',
      stop: 'end_turn',
      replies,
      prefaceBeforeAction: kind === 'single' ? pass : undefined,
    },
    grade: { pass, reason: pass ? '' : 'помилка' },
  };
}

describe('percentile', () => {
  it('найближчий ранг; порожній список — 0', () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('summarize', () => {
  const results = [
    result('single', true, [reply(0, 4_000, 800)]),
    result('single', false, [reply(4_000, 0, 400)]),
    result('clarify', true, [reply(4_000, 0, 500)]),
  ];
  const summary = summarize(results, MODELS.default);

  it('точність загалом і за видами команд', () => {
    expect(summary.passed).toBe(2);
    expect(summary.accuracy).toBeCloseTo(2 / 3, 10);
    expect(summary.byKind.single).toEqual({ total: 2, passed: 1 });
    expect(summary.byKind.clarify).toEqual({ total: 1, passed: 1 });
    expect(summary.byKind.multi).toEqual({ total: 0, passed: 0 });
  });

  it('частка кешу — прочитане з кешу до всіх вхідних токенів', () => {
    expect(summary.inputTokens).toBe(12_300);
    expect(summary.cacheReadShare).toBeCloseTo(8_000 / 12_300, 10);
    expect(summary.modelCalls).toBe(3);
    expect(summary.costUsd).toBeGreaterThan(0);
  });

  it('фраза перед дією рахується лише для команд з діями', () => {
    expect(summary.preface).toEqual({ said: 1, of: 2 });
  });

  it('підсумок прямо каже, що ціль не досягнута', () => {
    const lines = formatSummary(summary).join('\n');
    expect(lines).toMatch(/Точність: 2\/3 = 67 % \(ціль ≥ 90 %\) — НИЖЧЕ ЦІЛІ/);
    expect(lines).toMatch(/Кеш: 65 %/);
    expect(lines).toMatch(/Перший токен: p50 0\.50 с, p90 0\.80 с/);
  });
});
