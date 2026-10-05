// Чому не вдався запит до Claude API — у термінах станів ШІ з .claude/logic/03-brain.md.
// Класифікуємо за класами SDK і полем `type`; текст повідомлення — лише для 400 про ліміт Console
// і нестачу кредитів, бо інших ознак API для них не дає.
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';

export type ApiFailureKind =
  | 'auth'
  | 'permission'
  | 'billing'
  | 'console_limit'
  | 'tier_cap'
  | 'rate_limit'
  | 'model_unavailable'
  | 'no_connection'
  | 'unavailable'
  | 'unknown';

export interface ApiFailure {
  kind: ApiFailureKind;
  /** Пояснення для власника українською. */
  message: string;
  status?: number;
  requestId?: string;
}

const MESSAGES: Record<ApiFailureKind, string> = {
  auth: 'Ключ API недійсний: відкликаний, прострочений або з помилкою. Потрібен новий ключ (12-api.md, кроки 5–6).',
  permission: 'Ключ не має доступу до цієї дії або моделі.',
  billing:
    'Немає кредитів або проблема з оплатою. Поповнення: https://platform.claude.com/settings/billing',
  console_limit: 'Досягнуто ліміту витрат, заданого в Console (12-api.md, крок 4).',
  tier_cap: 'Досягнуто місячної стелі тарифу Anthropic. Доступ відновиться 1-го числа.',
  rate_limit: 'Забагато запитів; SDK уже повторив запит. Спробуй за хвилину.',
  model_unavailable: 'Модель недоступна для цього ключа.',
  no_connection: 'Немає зв’язку з API Claude: перевір інтернет.',
  unavailable: 'API Claude тимчасово недоступний або перевантажений.',
  unknown: 'Неочікувана помилка API Claude.',
};

interface ErrorBody {
  message?: string;
  details?: { error_code?: string };
}

/** Внутрішній об'єкт `error` з тіла відповіді: `{ type: 'error', error: {...} }`. */
function innerError(body: unknown): ErrorBody | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const inner: unknown = body.error;
  return typeof inner === 'object' && inner !== null ? inner : undefined;
}

function kindOf(error: APIError): ApiFailureKind {
  const inner = innerError(error.error);
  const message = inner?.message ?? '';

  if (error.status === 401 || error.type === 'authentication_error') return 'auth';
  if (error.status === 403 || error.type === 'permission_error') return 'permission';
  if (error.status === 402 || error.type === 'billing_error') return 'billing';
  if (error.status === 404 || error.type === 'not_found_error') return 'model_unavailable';
  if (error.status === 400) {
    if (message.startsWith('You have reached your specified')) return 'console_limit';
    if (/credit balance/i.test(message)) return 'billing';
    return 'unknown';
  }
  if (error.status === 429) {
    return inner?.details?.error_code === 'enforced_spend_limit_reached'
      ? 'tier_cap'
      : 'rate_limit';
  }
  if ((error.status ?? 0) >= 500 || error.type === 'overloaded_error') return 'unavailable';
  return 'unknown';
}

// `instanceof` звужує generic-клас до APIError<any, …>; guard дає типові параметри.
function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}

export function classifyApiError(error: unknown): ApiFailure {
  // APIConnectionError у TypeScript SDK — підклас APIError, тож перевіряємо його першим.
  if (error instanceof APIConnectionError) {
    return { kind: 'no_connection', message: MESSAGES.no_connection };
  }
  if (isApiError(error)) {
    const kind = kindOf(error);
    const failure: ApiFailure = { kind, message: MESSAGES[kind] };
    if (error.status !== undefined) failure.status = error.status;
    if (error.requestID) failure.requestId = error.requestID;
    return failure;
  }
  return { kind: 'unknown', message: MESSAGES.unknown };
}
