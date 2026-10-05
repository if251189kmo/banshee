// Хост протоколу core ↔ desktop (.claude/logic/01-architecture.md, «Протокол core ↔ desktop»):
// повідомлення клієнтів — головного процесу й вікон — перевіряє схема, далі їх виконує рушій;
// повідомлення рушія отримують усі клієнти. Від Electron не залежить: порт — будь-що з postMessage,
// тож хост перевіряється тестами без Electron.
import {
  changeVerdict,
  isSettingKey,
  parseDesktopMessage,
  parseSetting,
  PROTOCOL_VERSION,
  type ConfirmMethod,
  type CoreMessage,
  type DesktopMessage,
} from '@banshee/shared';
import type { Log } from '@banshee/shared/log';
import type { AiStatus } from './ai/state.ts';
import type { Db } from './db/database.ts';
import type { Command } from './engine.ts';
import { readSettings, writeSetting } from './settings/store.ts';

export interface HostPort {
  postMessage(message: CoreMessage): void;
  close(): void;
}

/** Те, що хост бере від рушія, — щоб у тестах його можна було підмінити. */
export interface HostEngine {
  status(): AiStatus;
  refreshState(): AiStatus;
  command(command: Command): Promise<void>;
  stop(): void;
  confirmReply(requestId: string, approved: boolean, method: ConfirmMethod): void;
  allowExtraToday(): void;
  newEpisode(): void;
  undo(actionId?: number): Promise<string>;
}

export interface HostDeps {
  readonly db: Db;
  readonly deviceId: string;
  readonly log?: Log;
  readonly now?: () => Date;
}

type Answer = { ok: true; result?: unknown } | { ok: false; error: string };
type SettingsSet = Extract<DesktopMessage, { type: 'settings.set' }>;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class CoreHost {
  private readonly deps: HostDeps;
  private readonly clients = new Map<HostPort, string>();
  private engine: HostEngine | null = null;

  constructor(deps: HostDeps) {
    this.deps = deps;
  }

  /** Повідомлення рушія — усім клієнтам. */
  readonly emit = (message: CoreMessage): void => {
    for (const port of this.clients.keys()) port.postMessage(message);
  };

  start(engine: HostEngine): void {
    this.engine = engine;
  }

  /** Новий клієнт; повертає обробник його повідомлень. */
  attach(port: HostPort, name: string): (data: unknown) => void {
    this.clients.set(port, name);
    this.deps.log?.info('host.attach', { client: name, clients: this.clients.size });
    return (data) => {
      void this.receive(port, data);
    };
  }

  detach(port: HostPort): void {
    this.clients.delete(port);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const port of this.clients.keys()) port.close();
    this.clients.clear();
  }

  async receive(port: HostPort, data: unknown): Promise<void> {
    const parsed = parseDesktopMessage(data);
    if (!parsed.ok) {
      this.deps.log?.warn('host.invalid', {
        client: this.clients.get(port) ?? '?',
        error: parsed.error,
      });
      return;
    }
    const engine = this.engine;
    if (!engine) return;
    const message = parsed.message;
    try {
      await this.handle(port, message, engine);
    } catch (error) {
      this.deps.log?.error('host.failed', { type: message.type, error: errorText(error) });
      if ('id' in message && message.type !== 'command') {
        this.answer(port, message.id, { ok: false, error: 'Внутрішня помилка core' });
      }
    }
  }

  private answer(port: HostPort, id: string, answer: Answer): void {
    port.postMessage({ type: 'reply', id, ...answer });
  }

  private async handle(port: HostPort, message: DesktopMessage, engine: HostEngine): Promise<void> {
    switch (message.type) {
      case 'hello':
        if (message.version !== PROTOCOL_VERSION) {
          this.deps.log?.error('host.version', { client: message.version, core: PROTOCOL_VERSION });
          port.postMessage({
            type: 'notice',
            level: 'error',
            text: 'Інтерфейс і core різних версій — перевстанови Banshee.',
          });
        }
        port.postMessage({
          type: 'ready',
          version: PROTOCOL_VERSION,
          aiState: engine.status().state,
        });
        return;
      case 'command':
        await engine.command({
          id: message.id,
          text: message.text,
          source: message.source,
          ...(message.voice ? { voice: message.voice } : {}),
        });
        return;
      case 'stop':
        engine.stop();
        return;
      case 'confirm.reply':
        engine.confirmReply(message.requestId, message.approved, message.method);
        return;
      case 'settings.get':
        this.answer(port, message.id, { ok: true, result: readSettings(this.deps.db).settings });
        return;
      case 'settings.set':
        this.setSetting(port, message, engine);
        return;
      case 'ai.extraDay':
        engine.allowExtraToday();
        this.answer(port, message.id, { ok: true });
        return;
      case 'episode.new':
        engine.newEpisode();
        return;
      case 'undo': {
        const actionId = message.actionId === undefined ? undefined : Number(message.actionId);
        if (actionId !== undefined && !Number.isSafeInteger(actionId)) {
          this.answer(port, message.id, { ok: false, error: 'Невідома дія' });
          return;
        }
        this.answer(port, message.id, { ok: true, result: await engine.undo(actionId) });
        return;
      }
    }
  }

  /**
   * Зміна з центру керування — клік власника (10-settings.md, «Правила»). Голосом налаштування
   * змінює команда Banshee з підтвердженням у ході, не це повідомлення.
   */
  private setSetting(port: HostPort, message: SettingsSet, engine: HostEngine): void {
    const { id, key, value, source } = message;
    if (source !== 'ui') {
      this.answer(port, id, { ok: false, error: 'Голосом налаштування змінює команда Banshee.' });
      return;
    }
    if (!isSettingKey(key)) {
      this.answer(port, id, { ok: false, error: `Невідоме налаштування: ${key}` });
      return;
    }
    const parsed = parseSetting(key, value);
    if (!parsed.ok) {
      this.answer(port, id, { ok: false, error: parsed.error });
      return;
    }
    const verdict = changeVerdict(key, parsed.value, 'ui');
    if (!verdict.allowed) {
      this.answer(port, id, { ok: false, error: verdict.reason });
      return;
    }
    const saved = writeSetting(
      this.deps.db,
      { key, value: parsed.value, source: 'ui', confirmedBy: 'click' },
      this.deps.deviceId,
      this.deps.now?.() ?? new Date(),
    );
    this.answer(port, id, { ok: true, result: saved });
    this.emit({ type: 'settings.changed', key, value: saved });
    engine.refreshState();
  }
}
