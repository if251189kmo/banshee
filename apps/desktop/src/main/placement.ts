// Розміщення оверлею й гарячі клавіші (.claude/logic/09-ui.md, «Оверлей», «Гарячі клавіші»).
// Чисті функції: головний процес лише передає розміри екрана й налаштування.

export const OVERLAY_WIDTH = 640;
export const OVERLAY_MIN_HEIGHT = 64;
export const OVERLAY_MAX_HEIGHT = 560;
/** Відступ оверлею від верху робочої області екрана. */
const OVERLAY_TOP = 72;

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Оверлей — по центру вгорі робочої області монітора; висота — за вмістом, у межах екрана. */
export function overlayBounds(workArea: Area, contentHeight: number): Area {
  const width = Math.min(OVERLAY_WIDTH, workArea.width - 32);
  const maxHeight = Math.min(OVERLAY_MAX_HEIGHT, workArea.height - OVERLAY_TOP - 16);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + OVERLAY_TOP,
    width,
    height: Math.max(OVERLAY_MIN_HEIGHT, Math.min(Math.round(contentHeight), maxHeight)),
  };
}

/** «Ctrl+Shift+B» з налаштувань → прискорювач Electron; клавіша Windows у Electron — Super. */
export function toAccelerator(hotkey: string): string {
  return hotkey
    .split('+')
    .map((part) => (part === 'Win' ? 'Super' : part))
    .join('+');
}

/** Збірка Windows: Mica для оверлею — з Windows 11 22H2 (збірка 22621). */
export function supportsMica(release: string): boolean {
  const [major, , build] = release.split('.').map(Number);
  return major === 10 && (build ?? 0) >= 22621;
}
