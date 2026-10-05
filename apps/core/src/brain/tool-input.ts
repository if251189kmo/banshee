// Аргументи інструментів від моделі (крок 1.8): модель іноді пише шлях Windows з одним «\» — тоді JSON
// перетворює «\t», «\n», «\r», «\b», «\f» на керівні символи: «D:\temp» стає «D:<TAB>emp». У шляхах
// і адресах таких символів не буває, тож core повертає їх назад, перш ніж дія піде в mcp/pc.

/** Поля інструментів етапу 1, що містять шлях, назву чи адресу. */
const PATH_FIELDS = new Set(['paths', 'dest', 'target', 'folder', 'app']);

const CONTROL: Readonly<Record<string, string>> = {
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\b': '\\b',
  '\f': '\\f',
};

function repair(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(/[\t\n\r\b\f]/g, (char) => CONTROL[char] ?? char);
  if (Array.isArray(value)) return value.map(repair);
  return value;
}

/** Копія аргументів з відновленими «\» у полях шляхів; решта — як є. */
export function repairToolInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      PATH_FIELDS.has(key) ? repair(value) : value,
    ]),
  );
}
