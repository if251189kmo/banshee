// Голоси, що читають літери (Coqui, MMS), мовчки пропускають усе, чого немає в їхньому tokens.txt:
// латиницю, цифри. Перевірка показує, що саме пропаде, — core перед озвученням перепише це словами.

/** Літери тексту, яких немає в словнику моделі (рядки tokens.txt: «символ id»). */
export function unknownLetters(text: string, tokens: string): string[] {
  const known = new Set(
    tokens
      .split(/\r?\n/)
      .map((line) => line.slice(0, line.lastIndexOf(' ')))
      .filter(Boolean),
  );
  const letters = text.match(/\p{L}/gu) ?? [];
  return [...new Set(letters.filter((char) => !known.has(char)))];
}
