// Клієнт моделей Claude для core (.claude/logic/03-brain.md): Haiku — стрімом, з двома точками кешу,
// перший токен ≤ 8 с, «стоп» скасовує запит. Sonnet для ескалації — окремим субагентом з адаптивним
// мисленням, зусиллям medium і резервною моделлю на відмову (`fallbacks: "default"`).
// Ключ передається явно; змінних середовища Banshee не читає. Повтори 429/5xx робить сам SDK.
import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeTool } from '@banshee/pc/definitions';

export interface TurnRequest {
  readonly model: string;
  readonly system: Anthropic.TextBlockParam[];
  readonly tools: readonly ClaudeTool[];
  readonly messages: readonly Anthropic.MessageParam[];
  readonly maxTokens: number;
}

export interface EscalationRequest {
  readonly model: string;
  readonly system: string;
  readonly task: string;
  readonly maxTokens: number;
}

/** Відповідь моделі в спільній формі: Haiku й Sonnet (бета) повертають схожі, але різні типи. */
export interface ModelReply {
  readonly content: readonly Anthropic.ContentBlock[];
  readonly stopReason: string | null;
  readonly usage: Anthropic.Usage;
  readonly model: string;
  /** Від запиту до першої частини відповіді, мс. */
  readonly ttftMs: number;
  readonly totalMs: number;
}

export interface CallOptions {
  readonly signal: AbortSignal;
  readonly onText?: (delta: string) => void;
}

export interface ModelClient {
  turn(request: TurnRequest, options: CallOptions): Promise<ModelReply>;
  escalate(request: EscalationRequest, options: CallOptions): Promise<ModelReply>;
}

/** Перший токен не прийшов за 8 с — запит скасовується (03-brain.md, «Збої API»). */
export const FIRST_TOKEN_TIMEOUT_MS = 8000;

export class FirstTokenTimeout extends Error {
  constructor() {
    super('Модель не відповіла за 8 с');
  }
}

/** «Стоп» скасував запит. */
export class Cancelled extends Error {
  constructor() {
    super('Скасовано');
  }
}

/** Сигнал, що спрацьовує від «стоп» або від тайм-ауту першого токена. */
function guard(signal: AbortSignal, firstTokenMs: number | null) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => {
    controller.abort();
  };
  signal.addEventListener('abort', onAbort);
  const timer =
    firstTokenMs === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, firstTokenMs);
  return {
    signal: controller.signal,
    gotFirstToken(): void {
      if (timer) clearTimeout(timer);
    },
    failure(error: unknown): unknown {
      if (timedOut) return new FirstTokenTimeout();
      if (signal.aborted) return new Cancelled();
      return error;
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

export function anthropicClient(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    async turn(request, options) {
      const started = performance.now();
      let ttftMs: number | undefined;
      const call = guard(options.signal, FIRST_TOKEN_TIMEOUT_MS);
      try {
        const stream = client.messages.stream(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system,
            tools: [...request.tools],
            messages: [...request.messages],
            // Друга точка кешу — кінець розмови, TTL 5 хв; перша (1 год) — на профілі в system.
            cache_control: { type: 'ephemeral' },
          },
          { signal: call.signal },
        );
        stream.on('streamEvent', (event) => {
          if (ttftMs === undefined && event.type === 'content_block_start') {
            ttftMs = performance.now() - started;
            call.gotFirstToken();
          }
        });
        stream.on('text', (delta) => {
          options.onText?.(delta);
        });
        const message = await stream.finalMessage();
        const totalMs = performance.now() - started;
        return {
          content: message.content,
          stopReason: message.stop_reason,
          usage: message.usage,
          model: message.model,
          ttftMs: ttftMs ?? totalMs,
          totalMs,
        };
      } catch (error) {
        throw call.failure(error);
      } finally {
        call.dispose();
      }
    },

    async escalate(request, options) {
      const started = performance.now();
      const call = guard(options.signal, null);
      try {
        const message = await client.beta.messages.create(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.task }],
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: call.signal },
        );
        const totalMs = performance.now() - started;
        const text = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim();
        return {
          content: text === '' ? [] : [{ type: 'text', text, citations: null }],
          stopReason: message.stop_reason,
          usage: message.usage as unknown as Anthropic.Usage,
          model: message.model,
          ttftMs: totalMs,
          totalMs,
        };
      } catch (error) {
        throw call.failure(error);
      } finally {
        call.dispose();
      }
    },
  };
}
