export function npxPackageSelectionsAreNpm(words: readonly string[], subcommandIndex: number): boolean {
  for (let index = 1; index < subcommandIndex; index++) {
    const word = words[index]!;
    if (word === "-p" || word === "--package") {
      if (words[index + 1] !== "npm") return false;
      index += 1;
      continue;
    }
    if (/^(?:-p|--package)=/u.test(word) && word.slice(word.indexOf("=") + 1) !== "npm") return false;
  }
  return true;
}
