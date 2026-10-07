// Пристрої звуку вікна звуку (.claude/logic/02-voice.md, «Вибір мікрофона й динаміків»): налаштування
// зберігає назву пристрою, а не його id — id Chromium різний для сторінки розробки й зібраної програми
// й скидається разом із профілем Chromium. «default» — як у Windows.

export interface DeviceInfo {
  readonly deviceId: string;
  readonly kind: string;
  readonly label: string;
  readonly groupId: string;
}

export type DeviceKind = 'audioinput' | 'audiooutput';

/** Записи Chromium «типовий» і «для зв'язку» Windows — не окремі пристрої. */
const PSEUDO = new Set(['default', 'communications']);
const MAX_NAME = 300;
const MAX_DEVICES = 64;

function real(devices: readonly DeviceInfo[], kind: DeviceKind): DeviceInfo[] {
  return devices.filter(
    (device) => device.kind === kind && !PSEUDO.has(device.deviceId) && device.label !== '',
  );
}

/**
 * Назва справжнього пристрою за назвою, яку дав Chromium: запис «типовий» має префікс мовою
 * Chromium («Default - …»), тож шукаємо пристрій, яким назва закінчується.
 */
export function plainName(label: string, devices: readonly DeviceInfo[], kind: DeviceKind): string {
  const names = real(devices, kind).map((device) => device.label);
  if (names.includes(label)) return label;
  return names.find((name) => label.endsWith(name)) ?? label;
}

/** Назви пристроїв одного виду й який із них зараз типовий у Windows. */
export function deviceNames(
  devices: readonly DeviceInfo[],
  kind: DeviceKind,
): { readonly names: string[]; readonly defaultName: string | null } {
  const list = real(devices, kind);
  const names = [...new Set(list.map((device) => device.label.slice(0, MAX_NAME)))].slice(
    0,
    MAX_DEVICES,
  );
  const pseudo = devices.find((device) => device.kind === kind && device.deviceId === 'default');
  if (!pseudo) return { names, defaultName: null };
  const byGroup = list.find((device) => pseudo.groupId !== '' && device.groupId === pseudo.groupId);
  const name = byGroup?.label ?? plainName(pseudo.label, devices, kind);
  return { names, defaultName: name === '' ? null : name.slice(0, MAX_NAME) };
}

/**
 * Який пристрій відкрити: «default» — типовий Windows (без id); назва — пристрій з такою назвою; id
 * — лише для значень, збережених до вибору за назвою. Обраного немає — типовий, fallback.
 */
export function resolveDevice(
  configured: string,
  devices: readonly DeviceInfo[],
  kind: DeviceKind,
): { readonly deviceId: string | null; readonly fallback: boolean } {
  if (configured === 'default') return { deviceId: null, fallback: false };
  const list = devices.filter((device) => device.kind === kind && !PSEUDO.has(device.deviceId));
  const match =
    list.find((device) => device.label === configured) ??
    list.find((device) => device.deviceId === configured);
  return match ? { deviceId: match.deviceId, fallback: false } : { deviceId: null, fallback: true };
}
