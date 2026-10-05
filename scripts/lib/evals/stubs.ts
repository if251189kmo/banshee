// Заглушки інструментів для еталонного набору: на ПК нічого не виконується (07-quality.md).
// Відповідь команди з `stubs` у наборі має перевагу над типовою.

export interface StubResult {
  /** JSON для `tool_result`. */
  readonly content: string;
  readonly isError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_SYSTEM_INFO: Readonly<Record<string, unknown>> = {
  disk: {
    disks: [
      { drive: 'C:', free_gb: 5.4, total_gb: 118 },
      { drive: 'D:', free_gb: 214, total_gb: 465 },
    ],
  },
  network: { connected: true, adapter: 'Ethernet', ipv4: '192.168.1.23' },
  battery: { present: false, note: 'desktop PC without a battery' },
};

function defaultResult(name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case 'open_app':
    case 'close_app':
    case 'volume':
    case 'media':
    case 'window':
    case 'open_target':
    case 'lock_pc':
      return { ok: true };
    case 'find_files':
      return { files: [] };
    case 'file_op':
      return { ok: true, count: Array.isArray(input.paths) ? input.paths.length : 0 };
    case 'run_powershell':
      return { output: '' };
    case 'system_info':
      return typeof input.kind === 'string'
        ? (DEFAULT_SYSTEM_INFO[input.kind] ?? { error: 'see the context line' })
        : { error: 'kind is required' };
    case 'escalate':
      return { answer: 'No answer.' };
    default:
      return undefined;
  }
}

export function stubResult(
  name: string,
  input: unknown,
  overrides: Readonly<Record<string, unknown>>,
): StubResult {
  const result = overrides[name] ?? defaultResult(name, isRecord(input) ? input : {});
  if (result === undefined) {
    return { content: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true };
  }
  return { content: JSON.stringify(result), isError: false };
}
