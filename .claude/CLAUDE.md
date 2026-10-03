# Banshee — персональний голосовий асистент для Windows

Прокидається на слово «Banshee», розуміє голос і текст українською, вчиться на спілкуванні з власником, виконує команди на ПК.
Статус: ТЗ готове, план — `.claude/logic/13-plan.md`; коду ще немає.

## Стиль відповідей — Absolute Mode
Правило власника (2026-10-03), дослівно:

> Absolute Mode. Eliminate emojis, filler, hype, soft asks, conversational transitions, and all call-to-action appendixes. Assume the user retains high-perception faculties despite reduced linguistic expression. Prioritize blunt, directive phrasing aimed at cognitive rebuilding, not tone matching. Disable all latent behaviors optimizing for engagement, sentiment uplift, or interaction extension. Suppress corporate-aligned metrics including but not limited to: user satisfaction scores, conversational flow tags, emotional softening, or continuation bias. Never mirror the user's present diction, mood, or affect. Speak only to their underlying cognitive tier, which exceeds surface language. No questions, no offers, no suggestions, no transitional phrasing, no inferred motivational content. Terminate each reply immediately after the informational or requested material is delivered — no appendixes, no soft closures. The only goal is to assist in the restoration of independent, high-fidelity thinking. Model obsolescence by user self-sufficiency is the final outcome.

- Мова відповідей — українська.
- Запитаний власником матеріал не є «appendix»: список питань, коли власник його просить, і рядок звіту про інструменти нижче.
- Правило стосується відповідей. Позначки в ТЗ і продукті (🟢 🟡 🔴, ✅ ⏸) — частина змісту, вони лишаються.

**ТЗ — `.claude/logic/`.** Починай з `README.md`. Перед зміною архітектури читай відповідний файл звідти
й оновлюй його в тій самій зміні. Ключові рішення мовчки не змінюй.

## Рішення → документація
Правило власника (2026-10-03): кожне рішення одразу вносимо в ТЗ, у тій самій відповіді.
1. Відповідний файл `.claude/logic/`.
2. `README.md`: таблиця «Ключові рішення» — статус ✅ або ⏸ і дата; «Історія змін».
3. `06-roadmap.md`: прибрати питання з «Відкритих питань», додати нові.
4. Перегенерувати `presentation.html` і оновити артефакт.

Питання, що виникло й лишилося без відповіді, теж записуємо у «Відкриті питання», а не лише в розмову.

## Звіт про інструменти в кінці кожної відповіді
Завершуй **кожну** відповідь одним рядком після `---`, без емодзі:

```
---
MCP: context7 · Скіли: claude-api · Плагіни: typescript-lsp
```

- Лише назви MCP-серверів, скілів і плагінів. Вбудовані інструменти (Bash, Read, Edit, Write) не вказуй.
- Усі три поля завжди присутні; `—` означає «не використовувалось». Нічого не вигадуй.

## Стек
- TypeScript, Node.js LTS. Монорепо на npm workspaces: `apps/core`, `apps/desktop` (Electron + React), `mcp/pc`, `packages/shared`.
- Claude — лише через `@anthropic-ai/sdk`: `claude-haiku-4-5` за замовчуванням, `claude-sonnet-5-5` для складного.
  Точні ID без дат. Перед кодом, що викликає Claude API, викликай скіл `claude-api`; якщо його немає в списку скілів —
  звіряйся з документацією platform.claude.com (context7 або WebFetch).
- Інструменти ПК — MCP-сервери (`@modelcontextprotocol/sdk`). Пам'ять — SQLite (`better-sqlite3`, FTS5).
- Не MongoDB і не Python у ядрі — причини в `.claude/logic/README.md`.

## Бюджет
- Платні лише підписка Claude (уже є) і API Claude з оплатою за використання: ≈ $11 на місяць, ліміти $1 на день і $20 на місяць
  (`.claude/logic/03-brain.md`, підключення — `12-api.md`).
- Нових підписок і платних сервісів не додавати. Голос — лише локальні моделі (Whisper, Piper): без облікових записів і даних картки (рішення власника 2026-10-03).

## Правила
- Ідентифікатори — англійською; коментарі, UI-рядки й голосові відповіді — українською.
- Кожен інструмент ПК декларує рівень дії 🟢/🟡/🔴 (`.claude/logic/05-safety.md`). Довільний PowerShell — 🟡 лише для команд
  зі списку дозволених, інакше 🔴. 🔴 підтверджується лише кліком або клавішею, не голосом.
- У пам'ять і системний промпт потрапляє лише сказане власником або підтверджене ним; чужий вміст (сайти, листи, файли) — ні.
- core ↔ desktop — лише IPC, без мережевих портів.
- Самонавчання змінює лише пам'ять (профіль, правила, рутини, словник). Рівні дій, дозволи й безпекові налаштування — лише вручну.
- Без API Banshee не падає: без ключа, ліміту, зв'язку чи кредитів працює базовий режим (`.claude/logic/03-brain.md`).
- Розпізнавання голосу власника — фільтр, а не автентифікація; профіль голосу не синхронізується й не експортується.
- Підтримувані Windows: 10 22H2 (збірка 19045) і новіші, включно з Windows 11. Можливості Windows 11 — лише з перевіркою наявності.
- Видалення — лише в Кошик. Кожна дія — в журнал. Секрети не потрапляють у пам'ять, журнал і промпти.
- **Ключі API** вводяться лише в налаштуваннях Banshee (рішення власника 2026-10-03). Сховище — Windows Credential Manager (`@napi-rs/keyring`), змінних середовища для ключів немає.
  - Поки вікна налаштувань немає (до кроку 1.7), ключі вводить власник командою `npm run key` у своєму терміналі. Claude її не запускає.
  - Ключі не друкувати й не читати; наявність і дійсність перевіряє `npm run check:api`.
  - `ANTHROPIC_API_KEY` не задавати: Claude Code тоді переходить з підписки на оплату за API, а в режимі `-p` — без питання.
  - Banshee запускає Claude Code з оточенням без `ANTHROPIC_API_KEY` і `ANTHROPIC_AUTH_TOKEN`.
- Кешований префікс промпта (інструменти + системний промпт) між запитами не змінюється: дата, час і нові факти — після нього.

## Definition of Done
Рішення власника (2026-10-03). Зміна готова, лише коли пройшли `npm run typecheck`, `npm run lint` і `npm test`.
Зміна промпта, інструментів або моделі — ще й `npm run evals`, еталонний набір (`.claude/logic/07-quality.md`).
Скрипти з'являться на етапі 1; поки коду немає — звіряй зміни з `.claude/logic/`.
Якщо перевірка не пройшла — кажи прямо, не звітуй про успіх.

## Налаштування Claude Code
- **`.claude/settings.json`** — дозволи під Banshee:
  - без питань — npm-скрипти Definition of Done, git на читання, context7, chrome-devtools на читання;
  - `npm install` і `npm run evals` — з підтвердженням: вони ставлять пакети й витрачають кредити API;
  - заборонено — push, publish, `rm -rf`, деструктивні команди git.
- **Хук `guard-secrets`** блокує команди, що чіпають секрети:
  - `.mcp.json` і `.env.*`;
  - змінні з ключами й вивід усіх змінних;
  - сховище облікових даних Windows: `cmdkey`, `vaultcmd`, `CredRead`, разовий код із keyring;
  - ключ `sk-ant-…` у тексті команди;
  - `npm run key` — його запускає лише власник.
- **Хук `lint-fix`** запускає `eslint --fix` після кожного запису `.ts/.tsx`. Поки eslint не встановлено, він мовчить.
- **`.mcp.json`** — MCP-сервери проєкту: лише context7 і chrome-devtools, без секретів (рішення власника 2026-10-03). Файл у `.gitignore`. Редагує власник; Claude файл не читає й не змінює.
