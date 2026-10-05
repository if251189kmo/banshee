// Інструменти етапу 1 для Claude (.claude/logic/01-architecture.md, «Інструменти етапу 1») і
// інструмент core `escalate`. Описи англійською: так менше токенів (03-brain.md).
// Виконує їх mcp/pc (крок 1.4), `escalate` — core; еталонний набір — заглушками.
//
// Порядок і текст визначень незмінні між запитами: вони стоять на початку кешованого префікса.
// Без `strict`: на кроці 0.1 він додавав ≈ 0,35 с до першого токена кожного запиту й ≈ 22 с до
// першого запиту після зміни схем, а точність без нього не гірша (03-brain.md). Схеми лишаються
// сумісними зі strict (без minimum, maximum, minLength; ≤ 24 необов'язкових параметрів) — для
// порівняння `npm run evals -- --strict`. Межі значень перевіряє код.
import type { ToolMeta } from '@banshee/shared';

export type { ActionLevel, ToolMeta } from '@banshee/shared';

/** Визначення інструмента для поля `tools` запиту Claude — сумісне з `Anthropic.Tool`. */
export interface ClaudeTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: {
    readonly type: 'object';
    readonly properties: Record<string, Record<string, unknown>>;
    readonly required: string[];
    readonly additionalProperties: false;
  };
  /** Лише для порівняння `npm run evals -- --strict`; у продукті без strict (03-brain.md). */
  readonly strict?: boolean;
}

export interface BansheeTool {
  readonly definition: ClaudeTool;
  readonly meta: ToolMeta;
}

type JsonSchema = Record<string, unknown>;

const KNOWN_FOLDERS = 'Desktop, Downloads, Documents, Pictures, Music, Videos';

const DEFAULT_META: ToolMeta = {
  level: 'green',
  final: false,
  replayable: false,
  allowWhenLocked: false,
  undoable: false,
  readOnly: false,
};

function tool(
  name: string,
  description: string,
  properties: Record<string, JsonSchema>,
  required: readonly string[],
  meta: Partial<ToolMeta>,
): BansheeTool {
  return {
    definition: {
      name,
      description,
      input_schema: {
        type: 'object',
        properties,
        required: [...required],
        additionalProperties: false,
      },
    },
    meta: { ...DEFAULT_META, ...meta },
  };
}

const appName = (example: string): JsonSchema => ({
  type: 'string',
  description: `Application name as shown in the Start menu, in English, e.g. ${example}.`,
});

export const TOOLS: readonly BansheeTool[] = [
  tool(
    'open_app',
    'Launch a desktop application, or bring it to the front if it is already running. ' +
      'Call this when the owner asks to open, launch or start a program ("відкрий", "запусти", ' +
      '"включи" + program name). Translate Ukrainian, Russian and slang names to the English ' +
      "Start menu name and apply the owner's aliases from the profile. Not for websites, folders " +
      'or files: use open_target.',
    { app: appName('"Telegram", "Google Chrome", "Visual Studio Code", "Calculator"') },
    ['app'],
    { final: true, replayable: true },
  ),
  tool(
    'close_app',
    'Close a running application with all its windows. Call this when the owner asks to close, ' +
      'quit or kill a program ("закрий", "вимкни", "вирубай" + program name). Unsaved work may be ' +
      'lost, so the app asks the owner to confirm.',
    { app: appName('"Google Chrome", "Spotify"') },
    ['app'],
    { level: 'yellow', replayable: true },
  ),
  tool(
    'volume',
    'Change the master volume of the default speakers. Call this for any request about ' +
      'loudness: louder, quieter, a specific level, mute or unmute. Provide exactly one of level, ' +
      'delta or mute.',
    {
      level: { type: 'integer', description: 'Absolute volume in percent, 0 to 100.' },
      delta: {
        type: 'integer',
        description: 'Relative change in percentage points, -100 to 100; negative is quieter.',
      },
      mute: { type: 'boolean', description: 'true mutes the sound, false unmutes it.' },
    },
    [],
    { final: true, replayable: true, allowWhenLocked: true },
  ),
  tool(
    'media',
    'Send a media key to whatever is playing now (Spotify, YouTube in the browser, a video ' +
      'player). Call this when the owner asks to pause, resume, skip to the next track or go back ' +
      'to the previous one. It does not open apps or choose music: to start a specific app, use ' +
      'open_app.',
    {
      action: {
        type: 'string',
        enum: ['play', 'pause', 'next', 'previous'],
        description: 'play resumes, pause pauses, next and previous switch tracks.',
      },
    },
    ['action'],
    { final: true, replayable: true, allowWhenLocked: true },
  ),
  tool(
    'window',
    'Show, minimize or maximize a window, or minimize all windows to show the desktop. Call this ' +
      'for "згорни", "розгорни", "на весь екран", "покажи вікно", "покажи робочий стіл". To start ' +
      'an app that is not running, use open_app.',
    {
      action: {
        type: 'string',
        enum: ['show', 'minimize', 'maximize', 'minimize_all'],
        description: 'minimize_all minimizes every window and shows the desktop.',
      },
      app: {
        type: 'string',
        description:
          'Application whose main window to act on, English Start menu name. Omit for the ' +
          'active window and for minimize_all.',
      },
    },
    ['action'],
    { final: true, replayable: true },
  ),
  tool(
    'open_target',
    'Open a folder, a file, a website, a web search or a Windows Settings page with its default ' +
      'program. Call this when the owner asks to open a site ("ютуб", "гітхаб"), search the web ' +
      '("загугли", "пошукай в інтернеті"), open a folder or a file with a known path, or open ' +
      'Windows settings.',
    {
      target: {
        type: 'string',
        description:
          `Absolute path ("D:\\work-project"), known folder name (${KNOWN_FOLDERS}), full ` +
          'https URL ("https://www.youtube.com"), Google search URL ' +
          '("https://www.google.com/search?q=..."), or ms-settings: URI ("ms-settings:display").',
      },
    },
    ['target'],
    { final: true, replayable: true },
  ),
  tool(
    'find_files',
    'Search files by name and modification date. Returns up to 20 matches, newest first, with ' +
      'full paths, sizes and dates. Call this when the owner asks where a file is or which files ' +
      "there are, and before acting on files whose exact paths you don't know yet (moving, " +
      'renaming, deleting, opening). Never guess paths: find them first.',
    {
      query: {
        type: 'string',
        description:
          'Part of the file name or a wildcard pattern ("резюме", "*.pdf", "*.png"); "*" for any file.',
      },
      folder: {
        type: 'string',
        description:
          `Folder to search: known folder name (${KNOWN_FOLDERS}), a subfolder of one ` +
          '("Pictures\\Screenshots"), or an absolute path. Omit to search the whole user profile.',
      },
      modified_after: {
        type: 'string',
        format: 'date',
        description: 'Only files modified on or after this date, YYYY-MM-DD.',
      },
      modified_before: {
        type: 'string',
        format: 'date',
        description: 'Only files modified before this date, YYYY-MM-DD.',
      },
    },
    ['query'],
    { readOnly: true },
  ),
  tool(
    'file_op',
    'Move, copy or rename files and folders, or delete them to the Recycle Bin. Call this once ' +
      'you know the exact paths, from the owner or from find_files. Deleting always goes to the ' +
      'Recycle Bin, so it can be undone. The app asks the owner to confirm; more than 20 files at ' +
      'once needs a physical click.',
    {
      op: {
        type: 'string',
        enum: ['move', 'copy', 'rename', 'recycle'],
        description: 'recycle deletes to the Recycle Bin.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths of the files or folders.',
      },
      dest: {
        type: 'string',
        description:
          `move and copy: destination folder, known folder name (${KNOWN_FOLDERS}) or absolute ` +
          'path, created if missing. rename: the new name only, without a folder. Omit for recycle.',
      },
    },
    ['op', 'paths'],
    { level: 'yellow', undoable: true },
  ),
  tool(
    'run_powershell',
    "Run a short PowerShell script in the owner's session and return its output. Call this only " +
      'when no other tool can do the task: processes and services, IP configuration, uptime, ' +
      'installed programs, Windows features. Allowlisted commands need the owner to confirm, ' +
      'anything else needs a physical click; Invoke-Expression, -EncodedCommand, downloads from ' +
      'the internet and Start-Process -Verb RunAs always need a click. Prefer read-only Get-* ' +
      'commands. Never delete files with it: use file_op.',
    {
      script: {
        type: 'string',
        description:
          'The script. Keep it short, one pipeline if possible, and limit the output, e.g. ' +
          '"| Select-Object -First 10".',
      },
    },
    ['script'],
    { level: 'yellow' },
  ),
  tool(
    'system_info',
    'Read PC status: free space per disk, network connection (adapter, connected or not, local ' +
      'IP address), battery charge, time or date. Call this when the owner asks about disk space, ' +
      'the internet or network, or the battery. The current time and date are in the context line ' +
      'of every owner turn: answer those without this tool.',
    {
      kind: {
        type: 'string',
        enum: ['disk', 'network', 'battery', 'time', 'date'],
        description: 'What to read.',
      },
    },
    ['kind'],
    { final: true, allowWhenLocked: true, readOnly: true },
  ),
  tool(
    'lock_pc',
    'Lock the PC, same as Win+L. Call this when the owner asks to lock the computer or says they ' +
      'are leaving it.',
    {},
    [],
    { final: true, replayable: true },
  ),
  tool(
    'escalate',
    'Hand a hard task to a stronger model and get its answer back. Call this when the task needs ' +
      'a plan of more than about five steps or a comparison of options, the analysis of a long ' +
      'text or document, when the same task has already failed twice, or when the owner asks you ' +
      'to think harder ("подумай краще"). The specialist does not see this conversation, so put ' +
      'every needed detail into task. Retell its answer briefly in Ukrainian.',
    {
      task: {
        type: 'string',
        description:
          'Self-contained description of the task with all known details, paths and constraints.',
      },
      reason: {
        type: 'string',
        enum: ['complex_plan', 'long_document', 'repeated_failure', 'owner_request'],
        description: 'Why the task is escalated.',
      },
    },
    ['task', 'reason'],
    {},
  ),
];

const BY_NAME = new Map(TOOLS.map((item) => [item.definition.name, item]));

export function findTool(name: string): BansheeTool | undefined {
  return BY_NAME.get(name);
}

/** Визначення для поля `tools` запиту — завжди в тому самому порядку. */
export function toolDefinitions(): ClaudeTool[] {
  return TOOLS.map((item) => item.definition);
}
