// @banshee/pc — MCP-сервер інструментів ПК (.claude/logic/01-architecture.md). Core запускає
// `src/main.ts` дочірнім процесом; визначення для Claude — `@banshee/pc/definitions`.
export { ASSESS_TOOL, createPcServer, UNDO_META, UNDO_TOOL } from './server.ts';
export type { FileUndo } from './files.ts';
export type { Assessment, PcSettings } from './tools.ts';
