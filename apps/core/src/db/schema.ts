// Схема БД Banshee (.claude/logic/04-memory.md, «Схема БД»): міграції по порядку, версія — у
// PRAGMA user_version. Випущену міграцію не змінюють: нова зміна схеми — нова міграція.
// Дати — TEXT ISO 8601. Таблиці, що синхронізуються (episodes, routines, aliases, settings), мають
// службові поля hlc, device_id і deleted (11-sync.md); `turns`, `actions`, `llm_calls` — лише на цьому ПК.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const SYNC_FIELDS = `
  hlc TEXT,
  device_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'етап 1: розмови, ходи, дії, виклики Claude, налаштування, статистика, рутини, назви',
    sql: `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  transcript TEXT,
  tainted INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0, 1)),${SYNC_FIELDS}
) STRICT;

CREATE TABLE routines (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL CHECK (origin IN ('builtin', 'owner', 'learned')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'off', 'archived')),
  trigger_template TEXT NOT NULL,
  examples_json TEXT NOT NULL DEFAULT '[]',
  slots_json TEXT NOT NULL DEFAULT '{}',
  steps_json TEXT NOT NULL,
  needs_json TEXT NOT NULL DEFAULT '[]',
  max_tier TEXT NOT NULL CHECK (max_tier IN ('green', 'yellow', 'red')),
  uses INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fails_in_row INTEGER NOT NULL DEFAULT 0,
  last_used TEXT,${SYNC_FIELDS}
) STRICT;

CREATE TABLE turns (
  id INTEGER PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
  utterance TEXT NOT NULL,
  normalized TEXT,
  route TEXT CHECK (route IN ('routine', 'llm', 'escalation', 'code', 'none')),
  routine_id INTEGER REFERENCES routines (id) ON DELETE SET NULL,
  outcome TEXT CHECK (outcome IN ('success', 'failed', 'corrected', 'rephrased', 'cancelled', 'no_ai')),
  latency_ms INTEGER CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX turns_episode ON turns (episode_id);
CREATE INDEX turns_created ON turns (created_at);

CREATE TABLE actions (
  id INTEGER PRIMARY KEY,
  turn_id INTEGER REFERENCES turns (id) ON DELETE SET NULL,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL CHECK (tier IN ('green', 'yellow', 'red')),
  source TEXT NOT NULL CHECK (source IN ('voice', 'text', 'routine', 'code', 'ui', 'sync')),
  confirmed_by TEXT CHECK (confirmed_by IN ('auto', 'voice', 'click', 'key')),
  status TEXT NOT NULL CHECK (status IN ('done', 'failed', 'denied', 'cancelled')),
  result TEXT,
  undo_json TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX actions_turn ON actions (turn_id);
CREATE INDEX actions_created ON actions (created_at);

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY,
  turn_id INTEGER REFERENCES turns (id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('turn', 'reflection', 'review', 'eval', 'consolidation')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
  latency_ms INTEGER CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX llm_calls_created ON llm_calls (created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'device')),
  updated_at TEXT NOT NULL,${SYNC_FIELDS}
) STRICT;

CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  device_id TEXT NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  turns_no_ai INTEGER NOT NULL DEFAULT 0,
  turns_ai INTEGER NOT NULL DEFAULT 0,
  turns_escalated INTEGER NOT NULL DEFAULT 0,
  refused_no_ai INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  corrected INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  learned_runs INTEGER NOT NULL DEFAULT 0,
  voice_rejected INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  p50_ms INTEGER,
  p90_ms INTEGER,
  PRIMARY KEY (day, device_id)
) STRICT;

CREATE TABLE aliases (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  phrase TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('app', 'folder', 'contact', 'site')),
  uses INTEGER NOT NULL DEFAULT 0,${SYNC_FIELDS}
) STRICT;
CREATE UNIQUE INDEX aliases_phrase ON aliases (kind, phrase) WHERE deleted = 0;

INSERT INTO meta (key, value) VALUES ('settings_version', '1');
`,
  },
  {
    version: 2,
    name: 'крок 1.7: опис дії для журналу — те саме речення, що на картці',
    sql: `ALTER TABLE actions ADD COLUMN summary TEXT;`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
