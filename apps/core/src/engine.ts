// Рушій ходів core (.claude/logic/03-brain.md): команда → маршрут → рутина без ШІ, Haiku або відповідь
// базового режиму. Один хід за раз, «стоп» і «скасуй», облік витрат і ліміти, збої API → базовий режим.
// Кожен хід — рядок `turns`, кожна дія — `actions`, кожен виклик Claude — `llm_calls` (04-memory.md).
import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_STATE_TEXT,
  changeVerdict,
  confirmationFor,
  isSettingKey,
  SETTINGS_TOOL,
  ulid,
  type AiState,
  type ConfirmMethod,
  type CoreMessage,
  type SettingKey,
  type SettingValue,
  type TurnOutcome,
  type TurnRoute,
  type TurnSource,
} from '@banshee/shared';
import { aiStatus, limitWarning, type AiStatus, type ApiProblem } from './ai/state.ts';
import type { Routine, RoutineStep } from './basic/builtins.ts';
import { route as routeCommand } from './basic/router.ts';
import { activeRoutines, ownerAliases, syncBuiltinRoutines } from './basic/store.ts';
import { normalize } from './basic/text.ts';
import { classifyApiError, type ApiFailureKind } from './brain/api-errors.ts';
import { usageCostUsd } from './brain/cost.ts';
import { runLoop, type ActionRecord, type LoopStop, type ToolRunner } from './brain/loop.ts';
import type { ModelClient } from './brain/model-client.ts';
import { buildSystem } from './brain/prompt.ts';
import { formatOwnerTurn, localDateTime } from './brain/turn-line.ts';
import type { Db } from './db/database.ts';
import { confirmQuestion, FAILURE_PHRASES, routinePhrase, systemInfoPhrase } from './phrases.ts';
import { readSettings, writeSetting } from './settings/store.ts';
import { aliasPronunciations } from './speech/pronunciations.ts';
import { speechText } from './speech/speech.ts';

/** Розмова триває, поки паузи коротші за 10 хв (03-brain.md, «Контекст розмови»). */
export const EPISODE_GAP_MS = 10 * 60 * 1000;
/** Нова команда під час дії чекає її завершення до 30 с. */
export const BUSY_WAIT_MS = 30_000;
/** Після збою зв'язку ШІ пробуємо знову через хвилину. */
export const OFFLINE_RETRY_MS = 60_000;
/** Історія розмови в запиті — останні ходи; старші стискатиме рефлексія етапу 3. */
const HISTORY_MESSAGES = 40;
/** Профіль власника до етапу 3: блок потрібен для точки кешу, порожнім він бути не може. */
export const EMPTY_PROFILE = '# Owner profile\n\nNo confirmed facts yet.';

export interface EngineDeps {
  readonly db: Db;
  readonly deviceId: string;
  /** Клієнт Claude з ключем; null — ключа немає. */
  readonly client: () => ModelClient | null;
  readonly tools: ToolRunner;
  readonly emit: (message: CoreMessage) => void;
  readonly now?: () => Date;
  readonly profile?: () => string;
}

export interface Command {
  readonly id: string;
  readonly text: string;
  readonly source: TurnSource;
  /** Перевірка голосу; owner false — фраза чужим голосом. */
  readonly voice?: { readonly score: number; readonly owner: boolean };
}

interface Episode {
  readonly id: number;
  lastAt: number;
  history: Anthropic.MessageParam[];
  pending: Anthropic.ToolResultBlockParam[];
  tainted: boolean;
}

interface Running {
  readonly controller: AbortController;
  acting: boolean;
  readonly done: Promise<void>;
}

const PROBLEM_OF: Partial<Record<ApiFailureKind, ApiProblem>> = {
  auth: 'key_invalid',
  permission: 'key_invalid',
  billing: 'billing',
  console_limit: 'console_limit',
  tier_cap: 'console_limit',
  rate_limit: 'offline',
  no_connection: 'offline',
  unavailable: 'offline',
};

const pad = (value: number): string => String(value).padStart(2, '0');
const localDay = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class Engine {
  private readonly deps: EngineDeps;
  private episode: Episode | null = null;
  private running: Running | null = null;
  /** Звідки команда ходу: відповідь на голосову — голосом (say). */
  private readonly sources = new Map<string, TurnSource>();
  private apiProblem: { problem: ApiProblem; at: number; until?: string } | null = null;
  private extra = { day: '', usd: 0 };
  private lastState: AiState | null = null;
  /** Попередження про 80 % ліміту — раз на день і раз на місяць. */
  private warned = { day: '', month: '' };
  private readonly confirmations = new Map<
    string,
    (answer: { approved: boolean; method: ConfirmMethod | null }) => void
  >();

  constructor(deps: EngineDeps) {
    this.deps = deps;
    syncBuiltinRoutines(deps.db);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private settings() {
    return readSettings(this.deps.db).settings;
  }

  private spentSince(from: Date): number {
    const row = this.deps.db
      .prepare<[string], { usd: number }>(
        'SELECT coalesce(sum(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ?',
      )
      .get(from.toISOString());
    return row?.usd ?? 0;
  }

  /** Стан ШІ зараз: перемикач, ключ, витрати проти лімітів, остання помилка API. */
  status(): AiStatus {
    const now = this.now();
    const settings = this.settings();
    const problem =
      this.apiProblem?.problem === 'offline' &&
      now.getTime() - this.apiProblem.at > OFFLINE_RETRY_MS
        ? null
        : this.apiProblem;
    const today = localDay(now);
    return aiStatus(
      {
        enabled: settings['ai.enabled'],
        hasKey: this.deps.client() !== null,
        spentTodayUsd: this.spentSince(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
        spentMonthUsd: this.spentSince(new Date(now.getFullYear(), now.getMonth(), 1)),
        limits: settings['ai.limits'],
        extraTodayUsd: this.extra.day === today ? this.extra.usd : 0,
        ...(problem
          ? {
              apiProblem: problem.until
                ? { problem: problem.problem, until: problem.until }
                : { problem: problem.problem },
            }
          : {}),
      },
      now,
    );
  }

  /** Повідомляє desktop, якщо стан ШІ змінився: після зміни налаштувань чи ключа. */
  refreshState(): AiStatus {
    return this.publishState();
  }

  /**
   * Перевірка ключа з налаштувань (`GET /v1/models`): успіх знімає «ключ не діє» й «немає зв'язку»;
   * оплату й ліміт Console список моделей не перевіряє, тож вони лишаються до першого вдалого ходу.
   */
  keyChecked(failure: ApiFailureKind | null): void {
    if (failure === null) {
      if (this.apiProblem?.problem === 'key_invalid' || this.apiProblem?.problem === 'offline') {
        this.apiProblem = null;
      }
    } else {
      const problem = PROBLEM_OF[failure];
      if (problem) this.apiProblem = { problem, at: this.now().getTime() };
    }
    this.publishState();
  }

  /** 80 % ліміту — сповіщення в треї (03-brain.md, «Ліміти витрат»), раз на день чи місяць. */
  private warnLimits(): void {
    const now = this.now();
    const spending = this.spending();
    const limits = this.settings()['ai.limits'];
    const kind = limitWarning({
      enabled: true,
      hasKey: true,
      spentTodayUsd: spending.todayUsd,
      spentMonthUsd: spending.monthUsd,
      limits,
      extraTodayUsd: spending.extraTodayUsd,
    });
    if (!kind) return;
    const day = localDay(now);
    const period = kind === 'day' ? day : day.slice(0, 7);
    if (this.warned[kind] === period) return;
    this.warned = { ...this.warned, [kind]: period };
    const usd = (value: number): string => `$${value.toFixed(2).replace('.', ',')}`;
    this.deps.emit({
      type: 'notice',
      level: 'warn',
      text:
        kind === 'day'
          ? `Витрачено ${usd(spending.todayUsd)} з денного ліміту ${usd(limits.dayUsd + spending.extraTodayUsd)}.`
          : `Витрачено ${usd(spending.monthUsd)} з місячного ліміту ${usd(limits.monthUsd)}.`,
    });
  }

  /** Витрати для картки «Стан ШІ»: сьогодні, за місяць і дозволене кліком «ще $1». */
  spending(): { todayUsd: number; monthUsd: number; extraTodayUsd: number } {
    const now = this.now();
    return {
      todayUsd: this.spentSince(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
      monthUsd: this.spentSince(new Date(now.getFullYear(), now.getMonth(), 1)),
      extraTodayUsd: this.extra.day === localDay(now) ? this.extra.usd : 0,
    };
  }

  /** Повідомляє desktop, якщо стан ШІ змінився. */
  private publishState(): AiStatus {
    const status = this.status();
    if (status.state !== this.lastState) {
      this.lastState = status.state;
      this.deps.emit({
        type: 'ai.state',
        state: status.state,
        ...(status.until ? { until: status.until } : {}),
      });
    }
    return status;
  }

  /** «Ще $1 на сьогодні» — лише кліком. */
  allowExtraToday(): void {
    const today = localDay(this.now());
    this.extra = { day: today, usd: (this.extra.day === today ? this.extra.usd : 0) + 1 };
    this.publishState();
  }

  /** «Стоп»: скасувати запит до API, поточну дію й очікування підтверджень. */
  stop(): void {
    this.running?.controller.abort();
    for (const resolve of this.confirmations.values()) resolve({ approved: false, method: null });
    this.confirmations.clear();
  }

  confirmReply(requestId: string, approved: boolean, method: ConfirmMethod): void {
    this.confirmations.get(requestId)?.({ approved, method });
    this.confirmations.delete(requestId);
  }

  newEpisode(): void {
    if (this.episode) {
      this.deps.db
        .prepare('UPDATE episodes SET ended_at = ? WHERE id = ?')
        .run(this.now().toISOString(), this.episode.id);
    }
    this.episode = null;
  }

  private currentEpisode(): Episode {
    const now = this.now();
    if (this.episode && now.getTime() - this.episode.lastAt <= EPISODE_GAP_MS) {
      this.episode.lastAt = now.getTime();
      return this.episode;
    }
    this.newEpisode();
    const id = Number(
      this.deps.db
        .prepare('INSERT INTO episodes (uid, started_at, device_id) VALUES (?, ?, ?)')
        .run(ulid(now.getTime()), now.toISOString(), this.deps.deviceId).lastInsertRowid,
    );
    this.episode = { id, lastAt: now.getTime(), history: [], pending: [], tainted: false };
    return this.episode;
  }

  /**
   * Відповідь в оверлей; на голосову команду — ще й голосом, якщо «Озвучувати відповіді» ввімкнено,
   * з текстом для озвучки (02-voice.md, «Текст для озвучки»). На набрану в оверлеї — лише текст.
   */
  private say(turnId: string, text: string, speakable = true): void {
    const speak =
      speakable && this.sources.get(turnId) === 'voice' && this.settings()['voice.speakAnswers'];
    if (!speak) {
      this.deps.emit({ type: 'say', turnId, text, speak, done: true });
      return;
    }
    const pronunciations = aliasPronunciations(ownerAliases(this.deps.db));
    const speech = speechText(text, { pronunciations });
    this.deps.emit({ type: 'say', turnId, text, speak, speech, done: true });
  }

  private confirm(turnId: string) {
    return (request: Parameters<import('./brain/loop.ts').Confirm>[0]) => {
      const requestId = ulid(this.now().getTime());
      this.deps.emit({
        type: 'confirm.request',
        requestId,
        turnId,
        level: request.level,
        tainted: request.tainted,
        summary: request.summary,
        ...(request.command ? { command: request.command } : {}),
        ...(request.consequence ? { consequence: request.consequence } : {}),
        methods: [...request.methods],
        timeoutSec: request.timeoutSec,
        armDelaySec: request.armDelaySec,
      });
      // Голосова команда: питання ще й голосом, бо картку власник може не бачити.
      if (this.sources.get(turnId) === 'voice')
        this.say(turnId, confirmQuestion(request.summary, request.methods.includes('voice')));
      return new Promise<{ approved: boolean; method: ConfirmMethod | null }>((resolve) => {
        const timer = setTimeout(() => {
          this.confirmations.delete(requestId);
          this.deps.emit({ type: 'confirm.closed', requestId, outcome: 'timeout' });
          resolve({ approved: false, method: null });
        }, request.timeoutSec * 1000);
        this.confirmations.set(requestId, (answer) => {
          clearTimeout(timer);
          if (answer.method !== null && !request.methods.includes(answer.method)) {
            // Голосом не можна підтвердити 🔴: така відповідь — не підтвердження.
            this.deps.emit({ type: 'confirm.closed', requestId, outcome: 'denied' });
            resolve({ approved: false, method: answer.method });
            return;
          }
          this.deps.emit({
            type: 'confirm.closed',
            requestId,
            outcome: answer.approved ? 'approved' : answer.method === null ? 'cancelled' : 'denied',
          });
          resolve(answer);
        });
      });
    };
  }

  private journal(
    turnRow: number | null,
    source: string,
    record: ActionRecord,
    summary: string | null = null,
  ): number {
    return Number(
      this.deps.db
        .prepare(
          `INSERT INTO actions (turn_id, tool, args_json, tier, source, confirmed_by, status, result, undo_json, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          turnRow,
          record.tool,
          JSON.stringify(record.args ?? {}),
          record.level,
          source,
          record.confirmedBy,
          record.status,
          record.result,
          record.undo === undefined ? null : JSON.stringify(record.undo),
          summary,
          this.now().toISOString(),
        ).lastInsertRowid,
    );
  }

  /**
   * Кінець команди без рядка в `turns` — керування й чужий голос: оверлей знає, що хід завершено,
   * а статистика його не рахує.
   */
  private uiDone(turnId: string, started: number, outcome: 'success' | 'cancelled'): void {
    this.deps.emit({
      type: 'turn.done',
      turnId,
      route: 'none',
      outcome,
      latencyMs: Math.round(performance.now() - started),
      costUsd: 0,
    });
  }

  /** Команда власника — від початку до `turn.done`. */
  async command(command: Command): Promise<void> {
    this.sources.set(command.id, command.source);
    const previous = this.running;
    if (previous) {
      if (previous.acting) {
        this.say(command.id, FAILURE_PHRASES.busy);
        await Promise.race([previous.done, sleep(BUSY_WAIT_MS)]);
      } else {
        previous.controller.abort();
        await previous.done;
      }
    }
    const controller = new AbortController();
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const running: Running = { controller, acting: false, done };
    this.running = running;
    try {
      await this.handle(command, running);
    } finally {
      if (this.running === running) this.running = null;
      this.sources.delete(command.id);
      finish();
    }
  }

  private async handle(command: Command, running: Running): Promise<void> {
    const started = performance.now();
    const turnId = command.id;
    if (command.voice?.owner === false) {
      // Чужий голос: нічого не виконується, у журнал ходів фраза не потрапляє (02-voice.md).
      this.say(turnId, FAILURE_PHRASES.voiceRejected, false);
      this.bumpUsage('voice_rejected');
      this.uiDone(turnId, started, 'cancelled');
      return;
    }
    const status = this.publishState();
    const settings = this.settings();
    const routed = routeCommand(command.text, {
      ai: status.state,
      routines: activeRoutines(this.deps.db),
      aliases: ownerAliases(this.deps.db),
    });

    if (routed.kind === 'control') {
      if (routed.command === 'stop') this.stop();
      else if (routed.command === 'help') {
        this.deps.emit({ type: 'open', section: 'help' });
        this.say(turnId, FAILURE_PHRASES.help);
      } else if (routed.command === 'new_episode') {
        this.newEpisode();
        this.say(turnId, FAILURE_PHRASES.done);
      } else this.say(turnId, await this.undo());
      this.uiDone(turnId, started, 'success');
      return;
    }

    const episode = this.currentEpisode();
    const turnRow = Number(
      this.deps.db
        .prepare(
          'INSERT INTO turns (episode_id, utterance, normalized, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(episode.id, command.text, normalize(command.text), this.now().toISOString())
        .lastInsertRowid,
    );
    this.deps.emit({ type: 'turn.state', turnId, state: 'thinking' });
    let route: TurnRoute = 'none';
    let outcome: TurnOutcome = 'no_ai';
    let routineId: number | null = null;
    const costBefore = this.spentSince(new Date(0));

    if (routed.kind === 'routine') {
      route = 'routine';
      routineId =
        this.deps.db
          .prepare<[string], { id: number }>('SELECT id FROM routines WHERE uid = ?')
          .get(routed.match.routine.id)?.id ?? null;
      outcome = await this.runRoutine(
        routed.match.routine,
        routed.match.steps,
        command,
        turnRow,
        running,
      );
    } else if (routed.kind === 'llm') {
      const result = await this.runLlm(command, episode, turnRow, running, settings);
      route = result.route;
      outcome = result.outcome;
    } else {
      this.say(turnId, routed.reply);
    }

    const latencyMs = Math.round(performance.now() - started);
    this.deps.db
      .prepare(
        'UPDATE turns SET route = ?, routine_id = ?, outcome = ?, latency_ms = ? WHERE id = ?',
      )
      .run(route, routineId, outcome, latencyMs, turnRow);
    if (routineId !== null) {
      this.deps.db
        .prepare(
          `UPDATE routines SET uses = uses + 1, last_used = ?,
             success_count = success_count + ?, fails_in_row = CASE WHEN ? THEN 0 ELSE fails_in_row + 1 END
           WHERE id = ?`,
        )
        .run(
          this.now().toISOString(),
          outcome === 'success' ? 1 : 0,
          outcome === 'success' ? 1 : 0,
          routineId,
        );
    }
    this.publishState();
    this.deps.emit({
      type: 'turn.done',
      turnId,
      route,
      outcome,
      latencyMs,
      costUsd: Math.max(0, this.spentSince(new Date(0)) - costBefore),
    });
  }

  private async runRoutine(
    routine: Routine,
    steps: readonly RoutineStep[],
    command: Command,
    turnRow: number,
    running: Running,
  ): Promise<TurnOutcome> {
    const builtin = routine.id.startsWith('builtin.');
    const settings = this.settings();
    for (const step of steps) {
      if (running.controller.signal.aborted) return 'cancelled';
      if (step.tool === SETTINGS_TOOL) {
        const ok = await this.routineSetting(step, command, turnRow);
        if (ok !== 'success') return ok;
        this.say(command.id, routinePhrase(step, '{}', this.now()));
        continue;
      }
      let assessment;
      try {
        assessment = await this.deps.tools.assess(step.tool, step.args);
      } catch {
        this.say(command.id, FAILURE_PHRASES.failed);
        return 'failed';
      }
      // 🟡 крок вбудованої рутини питає щоразу: власник її не створював. Рутина власника чи вивчена
      // з 🟡 кроком підтверджена, коли її створювали; 🔴 — щоразу (04-memory.md, «Рутини»).
      const level = !builtin && assessment.level === 'yellow' ? 'green' : assessment.level;
      const confirmation = confirmationFor(level, {
        tainted: false,
        voiceAllowed: command.source === 'voice' && settings['security.voiceConfirm'].enabled,
        voiceSec: settings['security.voiceConfirm'].seconds,
      });
      let confirmedBy: ConfirmMethod | null = 'auto';
      if (confirmation.required) {
        const answer = await this.confirm(command.id)({
          tool: step.tool,
          level: assessment.level,
          summary: assessment.summary,
          ...(assessment.command ? { command: assessment.command } : {}),
          ...(assessment.consequence ? { consequence: assessment.consequence } : {}),
          tainted: false,
          methods: confirmation.methods,
          timeoutSec: confirmation.timeoutSec,
          armDelaySec: confirmation.armDelaySec,
        });
        if (!answer.approved) {
          this.journal(
            turnRow,
            'routine',
            {
              tool: step.tool,
              args: step.args,
              level: assessment.level,
              confirmedBy: answer.method,
              status: 'denied',
              result: '',
            },
            assessment.summary,
          );
          this.say(command.id, FAILURE_PHRASES.denied);
          return 'cancelled';
        }
        confirmedBy = answer.method;
      }
      running.acting = true;
      this.deps.emit({ type: 'turn.state', turnId: command.id, state: 'acting' });
      const outcome = await this.deps.tools.run(step.tool, step.args);
      running.acting = false;
      const actionId = this.journal(
        turnRow,
        'routine',
        {
          tool: step.tool,
          args: step.args,
          level: assessment.level,
          confirmedBy,
          status: outcome.ok ? 'done' : 'failed',
          result: outcome.content.slice(0, 4000),
          ...(outcome.undo === undefined ? {} : { undo: outcome.undo }),
        },
        assessment.summary,
      );
      this.deps.emit({
        type: 'action',
        turnId: command.id,
        actionId: String(actionId),
        tool: step.tool,
        level: assessment.level,
        summary: assessment.summary,
        status: outcome.ok ? 'done' : 'failed',
        undoable: outcome.undo !== undefined,
      });
      if (!outcome.ok) {
        this.say(command.id, FAILURE_PHRASES.failed);
        return 'failed';
      }
      this.say(command.id, routinePhrase(step, outcome.content, this.now()));
    }
    return 'success';
  }

  /** Крок рутини «налаштування»: перемикач ШІ голосом (10-settings.md, «Хто змінює»). */
  private async routineSetting(
    step: RoutineStep,
    command: Command,
    turnRow: number,
  ): Promise<TurnOutcome> {
    const key = String(step.args.key);
    if (!isSettingKey(key)) return 'failed';
    const value = step.args.value as SettingValue<SettingKey>;
    const verdict = changeVerdict(key, value, command.source === 'voice' ? 'voice' : 'ui');
    if (!verdict.allowed) {
      this.say(command.id, verdict.reason);
      return 'failed';
    }
    let confirmedBy: ConfirmMethod = 'auto';
    if (verdict.confirm !== 'none') {
      const settings = this.settings();
      const confirmation = confirmationFor('yellow', {
        tainted: false,
        voiceAllowed:
          verdict.confirm === 'voice' &&
          command.source === 'voice' &&
          settings['security.voiceConfirm'].enabled,
        voiceSec: settings['security.voiceConfirm'].seconds,
      });
      const answer = await this.confirm(command.id)({
        tool: SETTINGS_TOOL,
        level: 'yellow',
        summary:
          key === 'ai.enabled' && value === true
            ? 'Увімкнути ШІ: запити до Claude коштують грошей'
            : `Змінити налаштування ${key}`,
        tainted: false,
        methods: confirmation.methods,
        timeoutSec: confirmation.timeoutSec,
        armDelaySec: 0,
      });
      if (!answer.approved || answer.method === null) {
        this.say(command.id, FAILURE_PHRASES.denied);
        return 'cancelled';
      }
      confirmedBy = answer.method;
    }
    writeSetting(
      this.deps.db,
      { key, value, source: command.source, confirmedBy, turnId: turnRow },
      this.deps.deviceId,
      this.now(),
    );
    this.deps.emit({ type: 'settings.changed', key, value });
    return 'success';
  }

  private async runLlm(
    command: Command,
    episode: Episode,
    turnRow: number,
    running: Running,
    settings: ReturnType<Engine['settings']>,
  ): Promise<{ route: TurnRoute; outcome: TurnOutcome }> {
    const client = this.deps.client();
    if (client === null) {
      this.say(command.id, AI_STATE_TEXT.no_key.reply);
      return { route: 'none', outcome: 'no_ai' };
    }
    const prices = settings['ai.models'].prices;
    const history = episode.history.slice(-HISTORY_MESSAGES);
    try {
      const result = await runLoop({
        client,
        models: { default: settings['ai.models'].default, complex: settings['ai.models'].complex },
        escalation: settings['ai.escalation'],
        system: buildSystem(this.deps.profile?.() ?? EMPTY_PROFILE),
        history,
        pending: episode.pending,
        turnText: formatOwnerTurn(command.text, localDateTime(this.now()), command.source),
        tools: this.deps.tools,
        confirm: this.confirm(command.id),
        voiceAllowed: command.source === 'voice' && settings['security.voiceConfirm'].enabled,
        voiceSec: settings['security.voiceConfirm'].seconds,
        tainted: episode.tainted,
        signal: running.controller.signal,
        hooks: {
          say: (text) => {
            this.say(command.id, text);
          },
          llmCall: (call) => {
            this.deps.db
              .prepare(
                `INSERT INTO llm_calls (turn_id, purpose, model, input_tokens, cache_read_tokens, cache_write_tokens,
                   output_tokens, cost_usd, latency_ms, created_at) VALUES (?, 'turn', ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                turnRow,
                call.model,
                call.usage.input_tokens,
                call.usage.cache_read_input_tokens ?? 0,
                call.usage.cache_creation_input_tokens ?? 0,
                call.usage.output_tokens,
                usageCostUsd(call.model, call.usage, prices),
                call.latencyMs,
                this.now().toISOString(),
              );
            this.warnLimits();
          },
          actionStarted: () => {
            running.acting = true;
            this.deps.emit({ type: 'turn.state', turnId: command.id, state: 'acting' });
          },
          action: (record, summary) => {
            running.acting = false;
            const actionId = this.journal(turnRow, command.source, record, summary);
            this.deps.emit({
              type: 'action',
              turnId: command.id,
              actionId: String(actionId),
              tool: record.tool,
              level: record.level,
              summary,
              status: record.status,
              undoable: record.undo !== undefined,
            });
            return actionId;
          },
          budgetLeft: () => this.status().state === 'active',
        },
      });
      const stop: LoopStop = result.stop;
      const success = stop === 'end_turn' || stop === 'final_tools';
      if (success) {
        episode.history = result.history;
        episode.pending = result.pending;
        if (stop === 'final_tools')
          this.say(command.id, this.finalPhrase(result.history, result.pending));
      } else {
        // Хід не вдався: розмова лишається такою, як до нього, — інакше наступний запит був би неправильним.
        const phrase =
          stop === 'timeout'
            ? FAILURE_PHRASES.timeout
            : stop === 'refusal'
              ? FAILURE_PHRASES.refusal
              : stop === 'budget'
                ? AI_STATE_TEXT[this.status().state].reply || FAILURE_PHRASES.failed
                : stop === 'cancelled'
                  ? ''
                  : FAILURE_PHRASES.failed;
        if (phrase !== '') this.say(command.id, phrase);
      }
      this.apiProblem = null;
      return {
        route: result.escalated ? 'escalation' : 'llm',
        outcome: success ? 'success' : stop === 'cancelled' ? 'cancelled' : 'failed',
      };
    } catch (error) {
      const failure = classifyApiError(error);
      const problem = PROBLEM_OF[failure.kind];
      if (problem) this.apiProblem = { problem, at: this.now().getTime() };
      const state = this.publishState().state;
      this.say(
        command.id,
        state === 'active' ? FAILURE_PHRASES.failed : AI_STATE_TEXT[state].reply,
      );
      return { route: 'llm', outcome: 'failed' };
    }
  }

  /**
   * Що сказати після простої дії без другого виклику моделі: дані `system_info` — словами
   * (інакше власник не почує відповіді), решта — «Готово».
   */
  private finalPhrase(
    history: readonly Anthropic.MessageParam[],
    results: readonly Anthropic.ToolResultBlockParam[],
  ): string {
    const last = history.at(-1);
    const uses = Array.isArray(last?.content)
      ? last.content.filter(
          (block): block is Anthropic.ToolUseBlockParam => block.type === 'tool_use',
        )
      : [];
    const phrases = uses.flatMap((use) => {
      if (use.name !== 'system_info') return [];
      const result = results.find((item) => item.tool_use_id === use.id);
      const content = typeof result?.content === 'string' ? result.content : '{}';
      const kind = (use.input as { kind?: unknown }).kind;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Порожні дані — фраза скаже, що прочитати не вдалося.
      }
      return [systemInfoPhrase(typeof kind === 'string' ? kind : '', data, this.now())];
    });
    return phrases.length > 0 ? phrases.join(' ') : FAILURE_PHRASES.done;
  }

  /**
   * «Скасуй»: остання дія з даними для скасування, яку ще не скасовано; actionId — кнопка
   * «Скасувати» на картці конкретної дії.
   */
  async undo(actionId?: number): Promise<string> {
    const row = this.deps.db
      .prepare<[number | null, number | null], { id: number; tool: string; undo_json: string }>(
        `SELECT id, tool, undo_json FROM actions
         WHERE undo_json IS NOT NULL AND status = 'done' AND (? IS NULL OR id = ?)
           AND id NOT IN (SELECT CAST(json_extract(args_json, '$.actionId') AS INTEGER) FROM actions WHERE tool = 'undo')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(actionId ?? null, actionId ?? null);
    if (!row) return FAILURE_PHRASES.nothingToUndo;
    const record: unknown = JSON.parse(row.undo_json);
    let ok: boolean;
    if (row.tool === SETTINGS_TOOL) {
      const previous = record as { key: string; value: unknown };
      ok = isSettingKey(previous.key);
      if (ok) {
        writeSetting(
          this.deps.db,
          {
            key: previous.key as SettingKey,
            value: previous.value,
            source: 'ui',
            confirmedBy: 'auto',
          },
          this.deps.deviceId,
          this.now(),
        );
      }
    } else {
      ok = (await this.deps.tools.undo(record)).ok;
    }
    this.journal(null, 'ui', {
      tool: 'undo',
      args: { actionId: row.id },
      level: 'yellow',
      confirmedBy: 'auto',
      status: ok ? 'done' : 'failed',
      result: '',
    });
    return ok ? FAILURE_PHRASES.undone : FAILURE_PHRASES.failed;
  }

  private bumpUsage(column: 'voice_rejected'): void {
    this.deps.db
      .prepare(
        `INSERT INTO usage_daily (day, device_id, ${column}) VALUES (?, ?, 1)
         ON CONFLICT (day, device_id) DO UPDATE SET ${column} = ${column} + 1`,
      )
      .run(localDay(this.now()), this.deps.deviceId);
  }
}
