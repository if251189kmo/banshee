// Вимови назв зі словника власника для озвучки: «обсідіан» → Obsidian означає, що Obsidian
// читається «обсідіан». Вбудовані вимови (latin.ts) мають перевагу: «тєлєга» лишається назвою
// власника для Telegram, а голос Banshee каже «телеграм».
import type { Alias } from '../basic/aliases.ts';
import { PRONUNCIATIONS } from './latin.ts';

export function aliasPronunciations(aliases: readonly Alias[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const alias of aliases) {
    if (alias.kind !== 'app') continue;
    const target = alias.target.toLowerCase();
    if (!/[a-z]/u.test(target) || target in PRONUNCIATIONS || result.has(target)) continue;
    if (!/^[\p{Script=Cyrillic}\s'’-]+$/u.test(alias.phrase)) continue;
    result.set(target, alias.phrase);
  }
  return result;
}
