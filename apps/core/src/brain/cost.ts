// Моделі й ціни Claude: типові значення й вартість виклику. У застосунку моделі й ціни беруться з
// налаштування ai.models — виведену з обігу модель замінюють без нового випуску (.claude/logic/03-brain.md).
import type Anthropic from '@anthropic-ai/sdk';

export const MODELS = {
  /** Мозок за замовчуванням. */
  default: 'claude-haiku-4-5',
  /** Ескалація складних задач. */
  complex: 'claude-sonnet-5-5',
} as const;

/** $ за 1 млн токенів, перевірено 2026-10-03. */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  [MODELS.default]: { input: 1, output: 5 },
  [MODELS.complex]: { input: 2, output: 10 },
};

/** Множники ціни входу для кешу: читання, запис з TTL 5 хв і 1 год. */
export const CACHE_PRICE_FACTORS = { read: 0.1, write5m: 1.25, write1h: 2 } as const;

export type TokenUsage = Pick<
  Anthropic.Usage,
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_creation_input_tokens'
  | 'cache_read_input_tokens'
  | 'cache_creation'
>;

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Вартість виклику з поля `usage` відповіді, разом із записом і читанням кешу. */
export function usageCostUsd(
  model: string,
  usage: TokenUsage,
  prices: Readonly<Record<string, { input: number; output: number }>> = PRICES_PER_MTOK,
): number {
  const price = prices[model];
  if (!price) return 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const written1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const written5m = usage.cache_creation ? usage.cache_creation.ephemeral_5m_input_tokens : written;
  const read = usage.cache_read_input_tokens ?? 0;
  const inputEquivalent =
    usage.input_tokens +
    read * CACHE_PRICE_FACTORS.read +
    written5m * CACHE_PRICE_FACTORS.write5m +
    written1h * CACHE_PRICE_FACTORS.write1h;
  return (inputEquivalent * price.input + usage.output_tokens * price.output) / 1_000_000;
}

/** Усі вхідні токени виклику: без кешу, записані й прочитані з кешу. */
export function totalInputTokens(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}
