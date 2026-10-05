import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { classifyApiError } from './api-errors.ts';

function apiError(
  status: number,
  type: string,
  message: string,
  details?: Record<string, string>,
  headers: Headers = new Headers(),
): APIError {
  const body = { type: 'error', error: { type, message, ...(details ? { details } : {}) } };
  return APIError.generate(status, body, undefined, headers);
}

describe('classifyApiError', () => {
  it.each([
    [401, 'authentication_error', 'invalid x-api-key', 'auth'],
    [403, 'permission_error', 'not allowed', 'permission'],
    [402, 'billing_error', 'payment required', 'billing'],
    [404, 'not_found_error', 'model: claude-x', 'model_unavailable'],
    [500, 'api_error', 'internal', 'unavailable'],
    [529, 'overloaded_error', 'overloaded', 'unavailable'],
  ] as const)('%i %s → %s', (status, type, message, kind) => {
    expect(classifyApiError(apiError(status, type, message)).kind).toBe(kind);
  });

  it('400 про нестачу кредитів — оплата', () => {
    const error = apiError(
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API.',
    );
    expect(classifyApiError(error).kind).toBe('billing');
  });

  it('400 про ліміт, заданий у Console', () => {
    const error = apiError(
      400,
      'invalid_request_error',
      'You have reached your specified API usage limits. You will regain access on 2026-11-01.',
    );
    expect(classifyApiError(error).kind).toBe('console_limit');
  });

  it('звичайний 400 — не стан ШІ, а помилка запиту', () => {
    const error = apiError(400, 'invalid_request_error', 'messages: field required');
    expect(classifyApiError(error).kind).toBe('unknown');
  });

  it('429 зі стелею тарифу відрізняється від звичайного ліміту запитів', () => {
    const cap = apiError(429, 'rate_limit_error', 'usage limits', {
      error_code: 'enforced_spend_limit_reached',
    });
    expect(classifyApiError(cap).kind).toBe('tier_cap');
    expect(classifyApiError(apiError(429, 'rate_limit_error', 'slow down')).kind).toBe(
      'rate_limit',
    );
  });

  it('мережа — немає зв’язку', () => {
    expect(classifyApiError(new APIConnectionError({ message: 'ECONNRESET' })).kind).toBe(
      'no_connection',
    );
  });

  it('статус і request-id — для підтримки', () => {
    const headers = new Headers({ 'request-id': 'req_test_1' });
    const failure = classifyApiError(
      apiError(401, 'authentication_error', 'bad', undefined, headers),
    );
    expect(failure.status).toBe(401);
    expect(failure.requestId).toBe('req_test_1');
  });

  it('чужа помилка — невідома, з поясненням українською', () => {
    const failure = classifyApiError(new Error('boom'));
    expect(failure.kind).toBe('unknown');
    expect(failure.message).toMatch(/Claude/);
  });
});
