// Запуск core (.claude/logic/01-architecture.md, «Процеси»): БД, журнал роботи, ключ Claude,
// інструменти ПК через mcp/pc, рушій ходів і хост протоколу. Від Electron не залежить: процес
// utilityProcess з apps/desktop лише передає шляхи й порти, а тести запускають core у Node.
import { createLog, type Log } from '@banshee/shared/log';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { anthropicClient, type ModelClient } from './brain/model-client.ts';
import { readClaudeKey } from './credentials.ts';
import { openDatabase, type Db } from './db/database.ts';
import { Engine } from './engine.ts';
import { CoreHost } from './host.ts';
import { connectPc, pcToolRunner, type PcLaunch, type PcSettingsSource } from './pc-client.ts';
import { readSettings } from './settings/store.ts';

export interface StartOptions {
  /** `data\banshee.db` у теці Banshee; у розробці — `.data/banshee.db`. */
  readonly dbFile: string;
  /** `logs\` у теці Banshee; у розробці — `.data/logs`. */
  readonly logsDir: string;
  /** Як запустити mcp/pc. */
  readonly pc: PcLaunch;
  /** Ключ Claude з Credential Manager; у тестах — підміна. */
  readonly readKey?: () => Promise<string | undefined>;
  readonly modelClient?: (key: string) => ModelClient;
  readonly connect?: (launch: PcLaunch) => Promise<Client>;
  readonly log?: Log;
  readonly now?: () => Date;
}

export interface StartedCore {
  readonly host: CoreHost;
  readonly engine: Engine;
  readonly db: Db;
  readonly log: Log;
  /** Чи запустився mcp/pc; ні — дії ПК відмовляють, решта працює. */
  readonly pcTools: boolean;
  /** Процес mcp/pc на старті: перевірка програми дивиться, що він не лишається сиротою. */
  readonly pcPid: number | null;
  close(): Promise<void>;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function pcSettings(db: Db): () => PcSettingsSource {
  return () => {
    const settings = readSettings(db).settings;
    return {
      powershellAllowlist: settings['security.powershellAllowlist'],
      massOperationFiles: settings['security.massOperationFiles'],
    };
  };
}

export async function startCore(options: StartOptions): Promise<StartedCore> {
  const log = options.log ?? createLog({ dir: options.logsDir, source: 'core' });
  const opened = await openDatabase(options.dbFile);
  const { db, deviceId } = opened;
  if (opened.from !== opened.to) {
    log.info('db.migrated', { from: opened.from, to: opened.to, backup: opened.backup });
  }
  const problems = readSettings(db).problems;
  if (problems.length > 0) log.warn('settings.problems', { count: problems.length });

  let client: ModelClient | null = null;
  try {
    const key = await (options.readKey ?? readClaudeKey)();
    client = key ? (options.modelClient ?? anthropicClient)(key) : null;
  } catch (error) {
    log.warn('key.read', { error: errorText(error) });
  }

  const connect = options.connect ?? connectPc;
  const tools = pcToolRunner(
    () => connect({ ...options.pc, logs: options.logsDir }),
    pcSettings(db),
    () => {
      log.warn('pc.closed');
    },
  );
  const pcTools = await tools.connected();
  if (!pcTools) log.error('pc.connect');

  const host = new CoreHost({ db, deviceId, log, ...(options.now ? { now: options.now } : {}) });
  const engine = new Engine({
    db,
    deviceId,
    client: () => client,
    tools,
    emit: host.emit,
    ...(options.now ? { now: options.now } : {}),
  });
  host.start(engine);
  return {
    host,
    engine,
    db,
    log,
    pcTools,
    pcPid: tools.pid(),
    async close() {
      engine.stop();
      host.close();
      await tools.close();
      db.close();
    },
  };
}
