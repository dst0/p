export function escapeCharacterClass(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
}

export function buildTriggerPattern(triggerCharacters: string[]): RegExp {
  return new RegExp(`(?:^|[\\s])[${triggerCharacters.map(escapeCharacterClass).join("")}][^\\s]*$`);
}

export function buildDebouncePattern(triggerCharacters: string[]): RegExp {
  const escapedWithoutAt = triggerCharacters.filter((character) => character !== "@").map(escapeCharacterClass);
  return new RegExp(`(?:^|[ \\t])(?:@(?:"[^"]*|[^\\s]*)|[${escapedWithoutAt.join("")}][^\\s]*)$`);
}
