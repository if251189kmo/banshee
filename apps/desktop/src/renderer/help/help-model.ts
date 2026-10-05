// Довідка в програмі (.claude/logic/09-ui.md, «Довідка»): теми — markdown в apps/desktop/help/, разом
// із кодом. Розбір — лише те, що є в темах: заголовок, абзаци, списки, таблиці, **жирне**, `код` і
// посилання «Відкрити: …» на розділи й налаштування. Без HTML: сторінка будує елементи сама.
import { SETTING_KEYS } from '@banshee/shared';
import { SECTIONS, type Section } from '../../shared/ui.ts';
import { SETTING_SECTIONS } from '../center/settings-model.ts';

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string };

export type Block =
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly kind: 'table';
      readonly header: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly kind: 'link'; readonly text: string; readonly target: string };

export interface HelpTopic {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly Block[];
}

export function inlines(text: string): Inline[] {
  const result: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) result.push({ kind: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) result.push({ kind: 'bold', text: match[1] });
    else if (match[2] !== undefined) result.push({ kind: 'code', text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push({ kind: 'text', text: text.slice(last) });
  return result;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

/** `01-start.md` → `start`. */
export const topicId = (file: string): string =>
  file
    .replace(/^.*[\\/]/, '')
    .replace(/^\d+-/, '')
    .replace(/\.md$/, '');

export function parseTopic(id: string, markdown: string): HelpTopic {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = id;
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] = [];
  let table: string[][] = [];
  const flush = () => {
    if (paragraph.length > 0)
      blocks.push({ kind: 'paragraph', inlines: inlines(paragraph.join(' ')) });
    if (list.length > 0) blocks.push({ kind: 'list', items: list });
    if (table.length > 0) {
      const [header = [], , ...rows] = table;
      blocks.push({
        kind: 'table',
        header: header.map((cell) => inlines(cell)),
        rows: rows.map((row) => row.map((cell) => inlines(cell))),
      });
    }
    paragraph = [];
    list = [];
    table = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(trimmed);
    if (trimmed.startsWith('# ')) {
      flush();
      title = trimmed.slice(2).trim();
    } else if (link) {
      flush();
      blocks.push({ kind: 'link', text: link[1] ?? '', target: link[2] ?? '' });
    } else if (trimmed.startsWith('|')) {
      if (paragraph.length > 0 || list.length > 0) flush();
      table.push(cells(trimmed));
    } else if (trimmed.startsWith('- ')) {
      if (paragraph.length > 0 || table.length > 0) flush();
      list.push(inlines(trimmed.slice(2)));
    } else if (trimmed === '') {
      flush();
    } else if (list.length > 0 && line.startsWith('  ')) {
      const lastItem = list.at(-1);
      if (lastItem) list[list.length - 1] = [...lastItem, ...inlines(` ${trimmed}`)];
    } else {
      if (list.length > 0 || table.length > 0) flush();
      paragraph.push(trimmed);
    }
  }
  flush();
  return { id, title, blocks };
}

/** Куди веде посилання: розділ центру керування, налаштування чи інша тема. */
export function resolveLink(
  target: string,
  topics: readonly string[],
): { section: Section | 'help'; anchor?: string } | null {
  const [section, anchor] = target.split('/');
  if (section === 'help') {
    return anchor === undefined || topics.includes(anchor)
      ? { section: 'help', ...(anchor ? { anchor } : {}) }
      : null;
  }
  const known = SECTIONS.find((item) => item === section);
  if (!known) return null;
  if (anchor === undefined) return { section: known };
  if (known !== 'settings') return null;
  const settingsAnchors = new Set<string>([
    ...SETTING_KEYS,
    ...SETTING_SECTIONS.map((item) => item.id),
    ...SETTING_SECTIONS.flatMap((item) => ('anchor' in item ? [item.anchor] : [])),
  ]);
  return settingsAnchors.has(anchor) ? { section: known, anchor } : null;
}

/** Тема для F1 у кожному розділі центру керування й розділі налаштувань. */
export const SECTION_TOPIC: Readonly<Record<string, string>> = {
  overview: 'start',
  activity: 'ai-costs',
  journal: 'safety',
  settings: 'start',
  about: 'requirements',
  wizard: 'start',
  'settings/general': 'hotkeys',
  'settings/voice': 'voice',
  'settings/ai': 'ai-costs',
  'settings/learning': 'memory',
  'settings/security': 'safety',
  'settings/sync': 'sync',
  'settings/storage': 'troubleshooting',
};
