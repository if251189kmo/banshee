import { describe, expect, it } from 'vitest';
import {
  estimateCostUsd,
  MODELS,
  totalInputTokens,
  usageCostUsd,
  type TokenUsage,
} from './cost.ts';

function usage(fields: Partial<TokenUsage>): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    ...fields,
  };
}

describe('estimateCostUsd', () => {
  it('рахує вартість Haiku 4.5 за цінами $1 / $5 за 1M токенів', () => {
    expect(estimateCostUsd(MODELS.default, 1_000, 100)).toBeCloseTo(0.0015, 10);
  });

  it('Sonnet 5.5 — $2 / $10', () => {
    expect(estimateCostUsd(MODELS.complex, 1_000_000, 100_000)).toBeCloseTo(3, 10);
  });

  it('невідома модель — 0, а не помилка', () => {
    expect(estimateCostUsd('claude-unknown', 1_000, 1_000)).toBe(0);
  });
});

describe('usageCostUsd', () => {
  it('читання кешу — 0,1 ціни входу', () => {
    const cost = usageCostUsd(
      MODELS.default,
      usage({ input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 5_000 }),
    );
    expect(cost).toBeCloseTo((1_000 + 500 + 100 * 5) / 1_000_000, 12);
  });

  it('запис кешу: 1 год — 2×, 5 хв — 1,25× ціни входу', () => {
    const cost = usageCostUsd(
      MODELS.default,
      usage({
        input_tokens: 40,
        cache_creation_input_tokens: 4_100,
        cache_creation: { ephemeral_1h_input_tokens: 4_000, ephemeral_5m_input_tokens: 100 },
      }),
    );
    expect(cost).toBeCloseTo((40 + 4_000 * 2 + 100 * 1.25) / 1_000_000, 12);
  });

  it('без розбивки за TTL запис рахується як 5 хв', () => {
    const cost = usageCostUsd(MODELS.default, usage({ cache_creation_input_tokens: 400 }));
    expect(cost).toBeCloseTo((400 * 1.25) / 1_000_000, 12);
  });

  it('усі вхідні токени — без кешу, записані й прочитані', () => {
    expect(
      totalInputTokens(
        usage({ input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 }),
      ),
    ).toBe(60);
  });
});
