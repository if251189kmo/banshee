// Виклик інструмента, записаний текстом (.claude/logic/03-brain.md, «Пастки API»): модель іноді пише
// «media {"action": "previous"}» замість справжнього виклику. Core такий текст не озвучує, а хід
// вважає збоєм: власник почув би назву інструмента, а дія не відбулася б.
import { TOOLS } from '@banshee/pc/definitions';

// Назва інструмента, за якою йдуть аргументи: «media {...}», «media with action».
const WRITTEN_CALL = new RegExp(
  `\\b(${TOOLS.map((tool) => tool.definition.name).join('|')})\\s*(\\{|\\(|with\\b)`,
);

export function writtenCall(text: string): string | undefined {
  return WRITTEN_CALL.exec(text)?.[1];
}
