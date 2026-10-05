// `npm run check:api` — чи працює ключ Claude: список моделей (безкоштовно) і один короткий
// виклик Haiku (≈ $0,0001). Ключ не друкується, лише «••••1234».
import Anthropic from '@anthropic-ai/sdk';
import { classifyApiError } from './lib/api-status.ts';
import { CLAUDE_KEY_RECORD, readClaudeKey } from './lib/credentials.ts';
import { maskKey } from './lib/key-format.ts';
import { estimateCostUsd, MODELS } from './lib/models.ts';

async function main(): Promise<number> {
  const key = await readClaudeKey();
  if (!key) {
    console.error(
      `Ключа Claude немає (запис ${CLAUDE_KEY_RECORD}). Його вводить власник: npm run key`,
    );
    return 1;
  }

  console.log(`Ключ: ${maskKey(key)}`);
  const client = new Anthropic({ apiKey: key });

  try {
    const available = new Set<string>();
    for await (const model of client.models.list()) available.add(model.id);
    // Список може містити лише ID з датою (claude-haiku-4-5-20251001), а ми звертаємось за аліасом.
    const listed = (alias: string): boolean =>
      [...available].some((id) => id === alias || id.startsWith(`${alias}-`));
    for (const id of Object.values(MODELS)) {
      console.log(`Модель ${id}: ${listed(id) ? 'доступна' : 'НЕДОСТУПНА'}`);
    }

    const started = performance.now();
    const response = await client.messages.create({
      model: MODELS.default,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Відповідай одним словом: працюю.' }],
    });
    const ms = Math.round(performance.now() - started);
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join(' ')
      .trim();
    const cost = estimateCostUsd(
      MODELS.default,
      response.usage.input_tokens,
      response.usage.output_tokens,
    );
    console.log(`Haiku: «${text}» за ${String(ms)} мс, ≈ $${cost.toFixed(5)}`);
    console.log('Claude API: OK');
    return 0;
  } catch (error) {
    const failure = classifyApiError(error);
    const meta = [failure.status, failure.requestId]
      .filter((part) => part !== undefined)
      .join(', ');
    console.error(`Claude API: помилка. ${failure.message}${meta ? ` (${meta})` : ''}`);
    return 1;
  }
}

process.exit(await main());
