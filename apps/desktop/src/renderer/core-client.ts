// Клієнт core для сторінки (.claude/logic/01-architecture.md, «Протокол core ↔ desktop»): привітання
// після кожного нового порту, запити з відповіддю `reply`, підписка на решту повідомлень. Усе, що
// прийшло від core, перевіряє схема.
import {
  parseCoreMessage,
  PROTOCOL_VERSION,
  ulid,
  type AiDetails,
  type CoreMessage,
  type DesktopMessage,
  type JournalPage,
  type KeyCheck,
  type KeyStatus,
  type SettingKey,
  type Settings,
  type StatsPeriod,
  type StatsResult,
} from '@banshee/shared';
import { useSyncExternalStore } from 'react';
import { INITIAL_STATE, reduceCore, type CoreEvent, type CoreState } from './core-state.ts';

type Listener = (message: CoreMessage) => void;

const listeners = new Set<Listener>();
const connectListeners = new Set<() => void>();
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (e: Error) => void }
>();

/** Скільки чекати відповіді core; перевірка ключа — мережевий запит, до 15 с. */
const REQUEST_TIMEOUT_MS = 30_000;

// Стан сторінки живе тут, а не в компоненті: повідомлення, що прийшли до монтування React,
// не губляться.
let state: CoreState = INITIAL_STATE;
const stateListeners = new Set<() => void>();

function dispatch(event: CoreEvent): void {
  state = reduceCore(state, event);
  for (const listener of stateListeners) listener();
}

function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function useCoreState(): CoreState {
  return useSyncExternalStore(subscribeState, () => state);
}

/** Хід, який почала голосова команда: текст показує оверлей, як і для набраної. */
export function noteCommand(id: string, text: string): void {
  dispatch({ type: 'sent', id, text });
}

/** Команда з цієї сторінки: хід з текстом команди. */
export function sendCommand(text: string, source: 'text' = 'text'): string {
  const id = ulid();
  dispatch({ type: 'sent', id, text });
  window.banshee.send({ type: 'command', id, text, source });
  return id;
}

window.banshee.onMessage((data) => {
  const parsed = parseCoreMessage(data);
  if (!parsed.ok) return;
  const message = parsed.message;
  if (message.type === 'reply') {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) waiter?.resolve(message.result);
    else waiter?.reject(new Error(message.error ?? 'Помилка core'));
  }
  dispatch({ type: 'message', message });
  for (const listener of listeners) listener(message);
});

window.banshee.onConnect(() => {
  // Новий порт — core перезапустився: старі запити відповіді вже не отримають.
  for (const waiter of pending.values()) waiter.reject(new Error('Core перезапустився'));
  pending.clear();
  dispatch({ type: 'connect' });
  window.banshee.send({ type: 'hello', version: PROTOCOL_VERSION, appVersion: __APP_VERSION__ });
  for (const listener of connectListeners) listener();
});

export function onCoreMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function onCoreConnect(listener: () => void): () => void {
  connectListeners.add(listener);
  return () => {
    connectListeners.delete(listener);
  };
}

export function send(message: DesktopMessage): void {
  window.banshee.send(message);
}

type RequestMessage = Extract<
  DesktopMessage,
  {
    type:
      | 'settings.get'
      | 'settings.set'
      | 'ai.extraDay'
      | 'undo'
      | 'key.status'
      | 'key.set'
      | 'key.check'
      | 'key.delete'
      | 'ai.details'
      | 'stats.get'
      | 'journal.list';
  }
>;
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function request<T>(message: WithoutId<RequestMessage>): Promise<T> {
  const id = ulid();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Core не відповів'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    window.banshee.send({ ...message, id });
  });
}

export const core = {
  settings: () => request<Settings>({ type: 'settings.get' }),
  setSetting: (key: SettingKey, value: unknown) =>
    request<unknown>({ type: 'settings.set', key, value, source: 'ui' }),
  extraDay: () => request<undefined>({ type: 'ai.extraDay' }),
  undo: (actionId?: number) =>
    request<string>(
      actionId === undefined ? { type: 'undo' } : { type: 'undo', actionId: String(actionId) },
    ),
  keyStatus: () => request<KeyStatus>({ type: 'key.status' }),
  setKey: (key: string) => request<KeyCheck>({ type: 'key.set', key }),
  checkKey: () => request<KeyCheck>({ type: 'key.check' }),
  deleteKey: () => request<undefined>({ type: 'key.delete' }),
  aiDetails: () => request<AiDetails>({ type: 'ai.details' }),
  stats: (days: StatsPeriod) => request<StatsResult>({ type: 'stats.get', days }),
  journal: (query: {
    limit: number;
    before?: number;
    level?: 'green' | 'yellow' | 'red';
    status?: 'done' | 'failed' | 'denied' | 'cancelled';
  }) => request<JournalPage>({ type: 'journal.list', ...query }),
};
