// Дзвінки (.claude/logic/02-voice.md, «Правила»): коли мікрофон тримає програма зв'язку — Teams,
// Discord, Zoom, месенджер чи браузер (Meet), — Banshee відповідає лише текстом в оверлеї, слово
// «Banshee» працює далі. Хто тримає мікрофон, Windows пише в реєстр: у записі програми, що зараз
// його використовує, LastUsedTimeStop = 0. Лише читання, раз на кілька секунд.
import { execFile } from 'node:child_process';

const CONSENT_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

/** Програми зв'язку: частини назви exe чи пакета, малими літерами. */
const CALL_APPS = [
  'teams',
  'discord',
  'zoom',
  'skype',
  'telegram',
  'viber',
  'whatsapp',
  'slack',
  'signal',
  'webex',
  'chrome',
  'msedge',
  'firefox',
  'opera',
  'brave',
] as const;

/** Сам Banshee — у розробці electron.exe, у програмі Banshee.exe. */
const SELF = ['banshee.exe', 'electron.exe'] as const;

/** Хто тримає мікрофон зараз: назва exe (NonPackaged) чи пакета Microsoft Store. */
export function micUsers(regOutput: string): string[] {
  const users: string[] = [];
  for (const block of regOutput.split(/\r?\n(?=HKEY_)/u)) {
    const key = /^HKEY_\S[^\r\n]*/u.exec(block)?.[0] ?? '';
    const start = /LastUsedTimeStart\s+REG_QWORD\s+0x([0-9a-f]+)/iu.exec(block)?.[1];
    const stop = /LastUsedTimeStop\s+REG_QWORD\s+0x([0-9a-f]+)/iu.exec(block)?.[1];
    if (start === undefined || stop === undefined) continue;
    if (BigInt(`0x${start}`) === 0n || BigInt(`0x${stop}`) !== 0n) continue;
    const name = key.split(/[\\#]/u).at(-1)?.toLowerCase() ?? '';
    if (name) users.push(name);
  }
  return users;
}

/** Чи йде дзвінок: мікрофон тримає програма зв'язку, а не сам Banshee. */
export function inCall(users: readonly string[]): boolean {
  return users.some(
    (user) => !SELF.some((self) => user === self) && CALL_APPS.some((app) => user.includes(app)),
  );
}

/** Прочитати реєстр (reg.exe є в кожній Windows); помилка — «дзвінка немає». */
export function readMicUsers(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', CONSENT_KEY, '/s'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? [] : micUsers(stdout));
      },
    );
  });
}
