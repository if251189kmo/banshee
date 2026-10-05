// Ключ Claude у Windows Credential Manager (рішення власника 2026-10-03).
// Той самий запис читатиме застосунок і змінюватиме вікно налаштувань (крок 1.7).
//
// Лише `new AsyncEntry(служба, обліковий запис)`. У @napi-rs/keyring 2.1.0 запис, створений через
// `withTarget`, новий об'єкт читає як порожній рядок (перевірено 2026-10-04), тож збережений ключ
// для наступного запуску «зникав». Регресію ловить credentials.test.ts.
import { AsyncEntry } from '@napi-rs/keyring';

const SERVICE = 'Banshee';
const ACCOUNT = 'claude-api-key';

/** Назва в «Диспетчері облікових даних» → «Облікові дані Windows» → «Загальні облікові дані». */
export const CLAUDE_KEY_RECORD = `${ACCOUNT}.${SERVICE}`;

/** Запис версії до 2026-10-04, створений через `withTarget`; прочитати його не можна. */
const LEGACY_TARGET = `${SERVICE}/${ACCOUNT}`;

export interface SecretRecord {
  /** Секрет або `undefined`, якщо його немає. */
  read(): Promise<string | undefined>;
  save(secret: string): Promise<void>;
  /** `true`, якщо запис був і його видалено. */
  remove(): Promise<boolean>;
}

export function secretRecord(service: string, account: string): SecretRecord {
  const entry = (): AsyncEntry => new AsyncEntry(service, account);
  return {
    async read() {
      const secret = await entry().getPassword();
      return secret ? secret : undefined;
    },
    save: (secret) => entry().setPassword(secret),
    remove: () => entry().deleteCredential(),
  };
}

const claudeKey = secretRecord(SERVICE, ACCOUNT);

async function removeLegacyRecord(): Promise<void> {
  await AsyncEntry.withTarget(LEGACY_TARGET, SERVICE, ACCOUNT).deleteCredential();
}

export function readClaudeKey(): Promise<string | undefined> {
  return claudeKey.read();
}

export async function saveClaudeKey(key: string): Promise<void> {
  await claudeKey.save(key);
  await removeLegacyRecord();
}

/** `true`, якщо ключ був і його видалено. */
export async function deleteClaudeKey(): Promise<boolean> {
  await removeLegacyRecord();
  return claudeKey.remove();
}
