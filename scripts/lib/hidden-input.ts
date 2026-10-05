// Приховане введення рядка в терміналі: замість символів — «•», в історію команд нічого не потрапляє.

const ENTER = /[\r\n]/;
const CTRL_C = '\u0003';
const CTRL_V = '\u0016';
const BACKSPACE = new Set(['\b', '\u007f']);
// Escape-послідовності терміналу: стрілки, bracketed paste (ESC[200~ … ESC[201~).
// eslint-disable-next-line no-control-regex -- тут саме керівні символи терміналу
const ESCAPE_SEQUENCE = /\u001b\[[0-9;]*[~A-Za-z]/g;
// eslint-disable-next-line no-control-regex -- з вставленого тексту прибираємо переноси й табуляції
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export interface KeystrokeState {
  value: string;
  done: boolean;
  cancelled: boolean;
}

/**
 * Застосовує шматок введення до стану. Чиста функція — щоб тестувати без терміналу.
 * Ctrl+V, який термінал не перехопив сам, бере текст із `paste` — буфера обміну.
 */
export function applyKeystrokes(
  state: KeystrokeState,
  chunk: string,
  paste: () => string = () => '',
): KeystrokeState {
  let { value } = state;
  for (const char of chunk.replace(ESCAPE_SEQUENCE, '')) {
    if (char === CTRL_C) return { value: '', done: true, cancelled: true };
    if (ENTER.test(char)) return { value, done: true, cancelled: false };
    if (char === CTRL_V) {
      value += paste().replace(CONTROL_CHARS, '');
    } else if (BACKSPACE.has(char)) {
      value = value.slice(0, -1);
    } else if (char >= ' ') {
      value += char;
    }
  }
  return { value, done: false, cancelled: false };
}

/** Читає рядок, показуючи «•» замість символів. `undefined` — власник натиснув Ctrl+C. */
export function readHidden(prompt: string, paste?: () => string): Promise<string | undefined> {
  const { stdin, stdout } = process;
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve) => {
    let state: KeystrokeState = { value: '', done: false, cancelled: false };
    const onData = (chunk: string): void => {
      const before = state.value.length;
      state = applyKeystrokes(state, chunk, paste);
      const delta = state.value.length - before;
      if (!state.done && delta > 0) stdout.write('•'.repeat(delta));
      if (!state.done && delta < 0) stdout.write('\b \b'.repeat(-delta));
      if (!state.done) return;
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      resolve(state.cancelled ? undefined : state.value);
    };
    stdin.on('data', onData);
  });
}
