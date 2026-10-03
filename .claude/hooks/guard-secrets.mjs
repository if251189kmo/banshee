#!/usr/bin/env node
// PreToolUse-хук на Bash: не пускає команди, які читають секрети.
// Правила дозволів тут не рятують: deny зіставляється з початком команди,
// а `cat` з будь-яким аргументом дозволений, тож `cat .mcp.json`
// проходить повз `Read(./.mcp.json)`.

const CHECK_HINT = 'Наявність і дійсність ключів перевіряй через `npm run check:api`, він ключі не друкує.';

const RULES = [
  {
    // Файли: .mcp.json (токени MCP-серверів), .env.*.
    // `.environment` навмисно не ловиться: після `.env` має бути крапка або межа слова.
    re: /\.mcp\.json|\.env(\.[\w-]+)?(?![\w-])/i,
    reason: 'Команда чіпає файл із секретами: .mcp.json або .env.*. Секрети не мають потрапляти в транскрипт; якщо потрібна структура файлу, спитай власника.',
  },
  {
    // Ключі в змінних середовища. Banshee їх не використовує (ключі — у Credential Manager),
    // але змінні могли лишитися зі старої інструкції, а ANTHROPIC_* читає Claude Code.
    re: /\b(BANSHEE_[A-Z0-9_]*KEY\w*|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)\b/,
    reason: 'Команда чіпає змінні середовища з ключами. ' + CHECK_HINT,
  },
  {
    // Команди, що виводять усі змінні середовища.
    re: /(^|[;&|]\s*)(printenv|env|set)\s*($|[;&|])|\b(Get-ChildItem|gci|dir|ls)\s+env:/i,
    reason: 'Команда виводить усі змінні середовища, серед них можуть бути ключі. ' + CHECK_HINT,
  },
  {
    // Сховище облікових даних Windows: системні утиліти, Win32 API і разовий код з keyring.
    // Скрипти проєкту, що беруть ключ зі сховища, не ловляться: вони ключ не друкують.
    re: /\b(cmdkey|vaultcmd|CredRead\w*|CredEnumerate\w*|Get-StoredCredential|PasswordVault)\b|(^|\s)(-e|--eval|-p|--print)(\s|=)[\s\S]*keyring/i,
    reason: 'Команда читає сховище облікових даних Windows, де лежать ключі Banshee. ' + CHECK_HINT,
  },
  {
    // Ключ Anthropic прямо в тексті команди.
    re: /sk-ant-[\w-]{8,}/,
    reason: 'У команді — ключ Anthropic. Ключі не мають потрапляти в транскрипт; їх вводить власник командою `npm run key`.',
  },
  {
    // Введення ключів — лише власник, у своєму терміналі.
    re: /\bnpm(\.cmd)?\s+run(-script)?\s+key($|[\s;&|"'])/,
    reason: '`npm run key` запускає лише власник у своєму терміналі: команда чекає прихованого введення ключа.',
  },
];

function readStdin() {
  return new Promise(resolve => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (raw += chunk));
    process.stdin.on('end', () => resolve(raw));
  });
}

const raw = await readStdin();

let command;
try {
  command = JSON.parse(raw)?.tool_input?.command;
} catch {
  process.exit(0);
}

if (typeof command !== 'string') process.exit(0);

const rule = RULES.find(r => r.re.test(command));
if (!rule) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: rule.reason,
    },
  })
);
