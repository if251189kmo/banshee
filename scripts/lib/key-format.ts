// Формат ключа Claude API і його безпечний показ. Сам ключ ніколи не друкуємо.

const KEY_PREFIX = 'sk-ant-';
const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

/** Прибирає те, що часто потрапляє разом із вставленим ключем: пробіли, переноси, лапки. */
export function normalizeKeyInput(raw: string): string {
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

export function isClaudeKeyFormat(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function looksLikeOtherSecret(key: string): boolean {
  return key.length > 0 && !key.startsWith(KEY_PREFIX);
}

/** «••••1234» — так ключ показують налаштування й термінал. */
export function maskKey(key: string): string {
  return `••••${key.slice(-4)}`;
}
