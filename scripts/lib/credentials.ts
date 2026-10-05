// Сховище ключів переїхало в core на кроці 1.1: ключ читає core в utilityProcess. Тут — лише посилання.
export {
  CLAUDE_KEY_RECORD,
  deleteClaudeKey,
  readClaudeKey,
  saveClaudeKey,
  secretRecord,
  type SecretRecord,
} from '../../apps/core/src/credentials.ts';
