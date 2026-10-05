// `npm run key` — власник вводить ключ Claude API. Ключ іде у Windows Credential Manager,
// у той самий запис, що читатиме застосунок. Claude Code цю команду не запускає (хук guard-secrets).
//   npm run key                 — вставити ключ у термінал (замість символів — «•»);
//   npm run key -- --clipboard  — взяти скопійований ключ із буфера обміну й потім очистити буфер;
//   npm run key -- --delete     — видалити ключ.
import Anthropic from '@anthropic-ai/sdk';
import { classifyApiError } from './lib/api-status.ts';
import { clearClipboard, readClipboard } from './lib/clipboard.ts';
import {
  CLAUDE_KEY_RECORD,
  deleteClaudeKey,
  readClaudeKey,
  saveClaudeKey,
} from './lib/credentials.ts';
import { readHidden } from './lib/hidden-input.ts';
import {
  isClaudeKeyFormat,
  looksLikeOtherSecret,
  maskKey,
  normalizeKeyInput,
} from './lib/key-format.ts';

const CLIPBOARD_HINT = 'Скопіюй ключ і запусти: npm run key -- --clipboard';

async function removeKey(): Promise<number> {
  const removed = await deleteClaudeKey();
  console.log(removed ? `Ключ видалено із запису ${CLAUDE_KEY_RECORD}.` : 'Ключа не було.');
  return 0;
}

async function typedKey(): Promise<string | undefined> {
  if (!process.stdin.isTTY) {
    console.error(`Тут немає інтерактивного термінала. ${CLIPBOARD_HINT}`);
    return undefined;
  }
  console.log(
    'Встав ключ: Ctrl+V або права кнопка миші — замість символів з’являться «•». Enter — зберегти, Ctrl+C — скасувати.',
  );
  console.log(`Якщо вставка не спрацьовує: ${CLIPBOARD_HINT}`);
  const raw = await readHidden('Ключ Claude API: ', readClipboard);
  if (raw === undefined) console.log('Скасовано, нічого не змінено.');
  return raw;
}

async function verifyAndSave(key: string): Promise<boolean> {
  // Список моделей безкоштовний: перевіряє ключ, не витрачаючи токенів.
  try {
    await new Anthropic({ apiKey: key }).models.list();
  } catch (error) {
    const failure = classifyApiError(error);
    if (failure.kind === 'no_connection' || failure.kind === 'unavailable') {
      await saveClaudeKey(key);
      console.warn(
        `${failure.message} Ключ ${maskKey(key)} збережено без перевірки — перевір пізніше: npm run check:api`,
      );
      return true;
    }
    console.error(`${failure.message} Ключ не збережено.`);
    return false;
  }

  await saveClaudeKey(key);
  console.log(
    `Ключ ${maskKey(key)} перевірено й збережено. Повна перевірка з викликом Haiku: npm run check:api`,
  );
  return true;
}

async function enterKey(fromClipboard: boolean): Promise<number> {
  console.log(
    `Ключ Claude API зберігається в Windows Credential Manager, запис ${CLAUDE_KEY_RECORD}.`,
  );
  const existing = await readClaudeKey();
  if (existing) console.log(`Уже збережено ключ ${maskKey(existing)}; новий замінить його.`);

  const raw = fromClipboard ? readClipboard() : await typedKey();
  if (raw === undefined) return 1;

  const key = normalizeKeyInput(raw);
  if (!isClaudeKeyFormat(key)) {
    const where = fromClipboard ? 'У буфері обміну' : 'Введене';
    const what = looksLikeOtherSecret(key) ? 'щось інше' : 'неповний ключ';
    console.error(
      `${where} — ${what}, а не ключ Claude API (він починається з sk-ant-). Нічого не збережено.`,
    );
    return 1;
  }

  const saved = await verifyAndSave(key);
  if (saved && fromClipboard) {
    clearClipboard();
    console.log(
      'Буфер обміну очищено. Якщо ввімкнено журнал буфера (Win+V), видали ключ і звідти.',
    );
  }
  return saved ? 0 : 1;
}

async function main(args: readonly string[]): Promise<number> {
  const unknown = args.filter((arg) => arg !== '--delete' && arg !== '--clipboard');
  if (unknown.length > 0) {
    // Аргумент команди лишається в історії PowerShell, тож ключ звідти не беремо.
    console.error(
      'Ключ не передається аргументом: він лишився б в історії PowerShell. Нічого не збережено.\n' +
        `Запусти npm run key і встав ключ, або: ${CLIPBOARD_HINT}`,
    );
    return 1;
  }
  return args.includes('--delete') ? removeKey() : enterKey(args.includes('--clipboard'));
}

process.exit(await main(process.argv.slice(2)));
