export function tokenizeShellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const finishWord = (): void => {
    if (!wordStarted) return;
    words.push(word);
    word = "";
    wordStarted = false;
  };
  const finishCommand = (): void => {
    finishWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (const character of command) {
    if (escaped) {
      if (character !== "\n") {
        if (quote === '"' && !["$", "`", '"', "\\"].includes(character)) word += "\\";
        word += character;
        wordStarted = true;
      }
      escaped = false;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"') escaped = true;
      else word += character;
      wordStarted = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      wordStarted = true;
    } else if (character === "\\") {
      escaped = true;
      wordStarted = true;
    } else if (/\s/u.test(character)) {
      finishWord();
      if (character === "\n" || character === "\r") finishCommand();
    } else if (character === ";" || character === "&" || character === "|") {
      finishCommand();
    } else {
      word += character;
      wordStarted = true;
    }
  }
  if (escaped) word += "\\";
  finishCommand();
  return commands;
}
