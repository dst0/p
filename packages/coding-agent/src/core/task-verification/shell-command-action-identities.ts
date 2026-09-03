import {
  commandStart,
  envSplitStringPayload,
  gitAction,
  gitArgumentStart,
  shellWrapperPayload,
  tokenizeShellCommands,
} from "./git-command-classification.ts";

const MAX_WRAPPER_DEPTH = 4;
const PACKAGE_ACTIONS = new Set(["add", "install", "publish", "remove", "run", "test", "uninstall", "update"]);
const PACKAGE_EXECUTABLES = new Set(["bun", "cargo", "npm", "pnpm", "yarn"]);
const PACKAGE_FLAGS_WITHOUT_VALUE = new Set([
  "-g",
  "--dry-run",
  "--force",
  "--global",
  "--ignore-scripts",
  "--json",
  "--offline",
  "--prefer-offline",
  "--silent",
]);
const PACKAGE_OPTIONS_WITH_SEPARATE_VALUE = new Set([
  "-C",
  "-p",
  "-w",
  "--cache",
  "--config",
  "--cwd",
  "--dir",
  "--filter",
  "--loglevel",
  "--manifest-path",
  "--otp",
  "--package",
  "--prefix",
  "--registry",
  "--scope",
  "--tag",
  "--target-dir",
  "--userconfig",
  "--workspace",
  "--workspace-dir",
]);

export interface ShellCommandActionIdentity {
  executable: string;
  action?: string;
  script?: string;
}

function packageActionIndex(words: readonly string[], startIndex: number): number {
  for (let index = startIndex + 1; index < words.length; index++) {
    const token = words[index]!;
    if (token === "--") return -1;
    if (PACKAGE_OPTIONS_WITH_SEPARATE_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (PACKAGE_FLAGS_WITHOUT_VALUE.has(token) || (token.startsWith("--") && token.includes("="))) continue;
    if (token.startsWith("-")) return -1;
    return PACKAGE_ACTIONS.has(token.toLocaleLowerCase("en-US")) ? index : -1;
  }
  return -1;
}

function commandActionIdentitiesAtDepth(command: string, depth: number): ShellCommandActionIdentity[] {
  const identities: ShellCommandActionIdentity[] = [];
  for (const words of tokenizeShellCommands(command)) {
    const shellPayload = shellWrapperPayload(words);
    if (shellPayload !== undefined && depth < MAX_WRAPPER_DEPTH) {
      identities.push(...commandActionIdentitiesAtDepth(shellPayload, depth + 1));
      continue;
    }
    const splitStringPayload = envSplitStringPayload(words);
    if (splitStringPayload !== undefined && depth < MAX_WRAPPER_DEPTH) {
      identities.push(...commandActionIdentitiesAtDepth(splitStringPayload, depth + 1));
      continue;
    }
    const startIndex = commandStart(words);
    const executable = words[startIndex]?.toLocaleLowerCase("en-US").split("/").at(-1);
    if (!executable) continue;
    const gitStart = gitArgumentStart(words);
    if (gitStart !== undefined) {
      const action = gitAction(words, gitStart);
      identities.push(action ? { executable, action } : { executable });
      continue;
    }
    if (!PACKAGE_EXECUTABLES.has(executable)) {
      identities.push({ executable });
      continue;
    }
    const actionIndex = packageActionIndex(words, startIndex);
    if (actionIndex === -1) {
      identities.push({ executable });
      continue;
    }
    const action = words[actionIndex]!.toLocaleLowerCase("en-US");
    const script = action === "run" ? words.slice(actionIndex + 1).find((word) => !word.startsWith("-")) : undefined;
    identities.push(script ? { executable, action, script } : { executable, action });
  }
  return identities;
}

export function shellCommandActionIdentities(command: string): ShellCommandActionIdentity[] {
  return commandActionIdentitiesAtDepth(command, 0);
}
