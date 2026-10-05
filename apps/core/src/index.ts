// @banshee/core — агентний цикл, політика дій, пам'ять, облік витрат (.claude/logic/01-architecture.md).
// Етап 1 будується без Electron: БД (крок 1.3), базовий режим без ШІ (1.6), далі інструменти й цикл.
export {
  aiStatus,
  limitWarning,
  type AiInputs,
  type AiStatus,
  type ApiProblem,
} from './ai/state.ts';
export { BUILTIN_ALIASES, findAlias, type Alias, type AliasKind } from './basic/aliases.ts';
export { BUILTIN_ROUTINES, type Routine, type RoutineStep } from './basic/builtins.ts';
export { matchRoutine, type MatchResult, type RoutineMatch } from './basic/match.ts';
export { route, type ControlCommand, type Route, type RouteContext } from './basic/router.ts';
export {
  activeRoutines,
  ownerAliases,
  routineLevel,
  saveAlias,
  syncBuiltinRoutines,
} from './basic/store.ts';
export { normalize } from './basic/text.ts';
export {
  migrate,
  openDatabase,
  schemaVersion,
  type Db,
  type OpenedDatabase,
} from './db/database.ts';
export { MIGRATIONS, SCHEMA_VERSION, type Migration } from './db/schema.ts';
export { readSettings, writeSetting, type SettingChange } from './settings/store.ts';
export { classifyApiError, type ApiFailure, type ApiFailureKind } from './brain/api-errors.ts';
export {
  runLoop,
  MAX_STEPS,
  type ToolRunner,
  type Confirm,
  type LoopResult,
} from './brain/loop.ts';
export {
  anthropicClient,
  Cancelled,
  FIRST_TOKEN_TIMEOUT_MS,
  FirstTokenTimeout,
  type ModelClient,
  type ModelReply,
} from './brain/model-client.ts';
export { buildSystem, SYSTEM_PROMPT } from './brain/prompt.ts';
export { Engine, EMPTY_PROFILE, EPISODE_GAP_MS, type Command, type EngineDeps } from './engine.ts';
export { connectPc, mcpToolRunner } from './pc-client.ts';
