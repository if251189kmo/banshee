// Хід Banshee на заглушках — тим самим циклом, що й у продукті (apps/core/src/brain/loop.ts, крок 1.8):
// проста дія `final` завершує хід без другого запиту, інакше результати заглушок ідуть назад у модель.
// Інструменти — заглушки, підтвердження — «так», ескалація — заглушка без запиту до Sonnet.
// Кілька ходів (сценарії ін'єкцій) ідуть один за одним в одній розмові, як у рушії core.
import type Anthropic from '@anthropic-ai/sdk';
import { runLoop, type LoopStop } from '@banshee/core/brain/loop';
import type { ModelClient, ModelReply } from '@banshee/core/brain/model-client';
import { MODELS } from '@banshee/core/brain/cost';
import { buildSystem } from '@banshee/core/brain/prompt';
import { repairToolInput } from '@banshee/core/brain/tool-input';
import { findTool, type ClaudeTool } from '../tools.ts';
import type { StopKind, ToolCall } from './grade.ts';
import { stubResult } from './stubs.ts';

export { MAX_STEPS } from '@banshee/core/brain/loop';
export type { ModelReply } from '@banshee/core/brain/model-client';

export interface CaseRun {
  readonly calls: ToolCall[];
  readonly finalText: string;
  readonly stop: StopKind;
  readonly replies: ModelReply[];
  /** Чи сказала модель фразу перед першою дією; `undefined`, якщо дій не було. */
  readonly prefaceBeforeAction: boolean | undefined;
}

export interface RunOptions {
  readonly profile: string;
  readonly maxSteps?: number;
  /** Визначення інструментів; типово — як у продукті. */
  readonly definitions?: readonly ClaudeTool[];
}

/** Ескалація в еталонному наборі не йде в Sonnet: відповідь — заглушка `escalate`. */
function withStubEscalation(
  client: ModelClient,
  stubs: Readonly<Record<string, unknown>>,
): ModelClient {
  return {
    turn: (request, options) => client.turn(request, options),
    escalate: async () => {
      const result = stubResult('escalate', {}, stubs);
      return Promise.resolve({
        content: [{ type: 'text', text: result.content, citations: null }],
        stopReason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage,
        model: 'stub',
        ttftMs: 0,
        totalMs: 0,
      });
    },
  };
}

function hasPreface(content: readonly Anthropic.ContentBlock[]): boolean {
  const firstTool = content.findIndex((block) => block.type === 'tool_use');
  return content
    .slice(0, firstTool)
    .some((block) => block.type === 'text' && block.text.trim() !== '');
}

const STOPS: Readonly<Record<LoopStop, StopKind>> = {
  end_turn: 'end_turn',
  final_tools: 'final_tools',
  max_steps: 'max_steps',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
  // Виклик, написаний текстом, оцінка бачить у finalText і рахує окремою причиною.
  written_call: 'end_turn',
  budget: 'max_steps',
  cancelled: 'max_steps',
  timeout: 'max_steps',
};

export async function runCase(
  client: ModelClient,
  turns: string | readonly string[],
  stubs: Readonly<Record<string, unknown>>,
  options: RunOptions,
): Promise<CaseRun> {
  const calls: ToolCall[] = [];
  const replies: ModelReply[] = [];
  let prefaceBeforeAction: boolean | undefined;
  let history: Anthropic.MessageParam[] = [];
  let pending: Anthropic.ToolResultBlockParam[] = [];
  let finalText = '';
  let stop: StopKind = 'end_turn';
  const model = withStubEscalation(client, stubs);

  for (const turnText of typeof turns === 'string' ? [turns] : turns) {
    const result = await runLoop({
      client: model,
      models: { default: MODELS.default, complex: MODELS.complex },
      escalation: true,
      system: buildSystem(options.profile),
      history,
      pending,
      turnText,
      tools: {
        assess: async (name) => {
          const tool = findTool(name);
          if (!tool) throw new Error(`Unknown tool ${name}`);
          return Promise.resolve({ level: tool.meta.level, summary: name });
        },
        run: async (name, args) => {
          const result = stubResult(name, args, stubs);
          return Promise.resolve({ ok: !result.isError, content: result.content });
        },
        undo: async () => Promise.resolve({ ok: true, content: '{"ok":true}' }),
      },
      confirm: async () => Promise.resolve({ approved: true, method: 'click' }),
      voiceAllowed: true,
      voiceSec: 8,
      tainted: false,
      signal: new AbortController().signal,
      hooks: {
        say: () => undefined,
        llmCall: () => undefined,
        actionStarted: () => undefined,
        action: () => 0,
        budgetLeft: () => true,
      },
      onReply: (reply) => {
        replies.push(reply);
        const uses = reply.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );
        if (uses.length > 0) prefaceBeforeAction ??= hasPreface(reply.content);
        // Оцінюється те, що отримали б інструменти, — після відновлення «» у шляхах.
        for (const use of uses) calls.push({ name: use.name, input: repairToolInput(use.input) });
      },
      ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
      ...(options.definitions ? { definitions: options.definitions } : {}),
    });
    finalText = result.finalText;
    stop = STOPS[result.stop];
    if (result.stop !== 'end_turn' && result.stop !== 'final_tools') break;
    history = result.history;
    pending = result.pending;
  }
  return { calls, finalText, stop, replies, prefaceBeforeAction };
}
