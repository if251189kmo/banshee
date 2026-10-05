// Ключ Claude з налаштувань (.claude/logic/12-api.md, «Ключ»): вставити, перевірити, замінити,
// видалити. Перевірка — список моделей (`GET /v1/models`): безкоштовно, без токенів. Ключ не
// друкується й не пишеться в журнал: назовні — лише «••••1234».
import Anthropic from '@anthropic-ai/sdk';
import type { KeyCheck, KeyStatus } from '@banshee/shared';
import { classifyApiError, type ApiFailureKind } from './brain/api-errors.ts';
import { deleteClaudeKey, readClaudeKey, saveClaudeKey } from './credentials.ts';

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

/** Прибирає те, що часто потрапляє разом із вставленим ключем: пробіли, переноси, лапки. */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

export const maskKey = (key: string): string => `••••${key.slice(-4)}`;

export interface KeyStore {
  read(): Promise<string | undefined>;
  save(key: string): Promise<void>;
  remove(): Promise<boolean>;
}

/** Запис Credential Manager `claude-api-key.Banshee` — той самий, що й у `npm run key`. */
export const credentialStore: KeyStore = {
  read: readClaudeKey,
  save: saveClaudeKey,
  remove: deleteClaudeKey,
};

/** Чи діє ключ: список моделей, одна сторінка. */
export type KeyProbe = (
  key: string,
) => Promise<{ ok: true } | { ok: false; kind: ApiFailureKind; message: string }>;

export const modelsProbe: KeyProbe = async (key) => {
  try {
    await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 15_000 }).models.list({ limit: 1 });
    return { ok: true };
  } catch (error) {
    const failure = classifyApiError(error);
    return { ok: false, kind: failure.kind, message: failure.message };
  }
};

export interface KeyEvents {
  /** Ключ з'явився, змінився чи зник: core перебудовує клієнт Claude. */
  changed(key: string | null): void;
  /** Результат перевірки: рушій знімає чи ставить «ключ не діє», «немає зв'язку». */
  checked(failure: ApiFailureKind | null): void;
}

export class KeyService {
  private readonly store: KeyStore;
  private readonly probe: KeyProbe;
  private readonly events: KeyEvents;

  constructor(events: KeyEvents, store: KeyStore = credentialStore, probe: KeyProbe = modelsProbe) {
    this.events = events;
    this.store = store;
    this.probe = probe;
  }

  async status(): Promise<KeyStatus> {
    const key = await this.store.read();
    return key ? { present: true, masked: maskKey(key) } : { present: false, masked: null };
  }

  /** Новий ключ: формат, перевірка списком моделей, лише тоді — збереження. */
  async set(raw: string): Promise<KeyCheck> {
    const key = normalizeKey(raw);
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        reason: 'format',
        message: key.startsWith('sk-ant-')
          ? 'Ключ обрізаний: скопіюй його з Console повністю.'
          : 'Це не ключ Claude: він починається з «sk-ant-».',
      };
    }
    const probed = await this.probe(key);
    if (!probed.ok) {
      // Новий ключ не збережено, тож стан збереженого не змінюється — крім «немає зв'язку».
      if (probed.kind === 'no_connection') this.events.checked('no_connection');
      return { ok: false, reason: probed.kind, message: probed.message };
    }
    await this.store.save(key);
    this.events.changed(key);
    this.events.checked(null);
    return { ok: true, masked: maskKey(key) };
  }

  /** «Перевірити з'єднання» для збереженого ключа. */
  async check(): Promise<KeyCheck> {
    const key = await this.store.read();
    if (!key) return { ok: false, reason: 'no_key', message: 'Ключа ще немає.' };
    const probed = await this.probe(key);
    this.events.checked(probed.ok ? null : probed.kind);
    return probed.ok
      ? { ok: true, masked: maskKey(key) }
      : { ok: false, reason: probed.kind, message: probed.message };
  }

  async remove(): Promise<void> {
    await this.store.remove();
    this.events.changed(null);
  }
}
