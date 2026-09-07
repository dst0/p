import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeWorkspaceEffectPath } from "./workspace-effect-state.ts";

export interface ExactFileBytesAssertionClaim {
  kind: "file_exact_bytes";
  path: string;
  expectedSha256: string;
  selectors: string[];
}

export interface ExactFileBytesAssertionInput {
  cwd: string;
  taskOwnedPaths: readonly string[];
  descriptor: string;
  isError: boolean;
}

const MAX_DESCRIPTOR_CHARS = 12_000;
const MAX_EXPECTED_BYTES = 8_192;
const EXACT_ARTIFACT_EXTENSIONS = new Set([
  ".cfg",
  ".conf",
  ".csv",
  ".ini",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".toml",
  ".tsv",
  ".txt",
  ".yaml",
  ".yml",
]);
const ASSERTION_PATTERN =
  /^\s*(?:diff|cmp\s+-s)\s+<\(printf\s+'((?:\\.|[^'\\\r\n])*)'\)\s+('(?:[^'\r\n]*)'|[A-Za-z0-9._@%+=:,/-]+)(?:\s+&&\s+echo(?:\s+(?:'[^'\r\n]*'|[A-Za-z0-9._@%+=:,/ -]+))?)?\s*$/u;

export function classifyExactFileBytesAssertion(
  input: ExactFileBytesAssertionInput,
): ExactFileBytesAssertionClaim | undefined {
  if (input.isError || input.descriptor.length === 0 || input.descriptor.length > MAX_DESCRIPTOR_CHARS) {
    return undefined;
  }
  const match = ASSERTION_PATTERN.exec(input.descriptor);
  if (!match) return undefined;
  const decoded = decodePrintfLiteral(match[1]!);
  if (decoded === undefined) return undefined;
  const expected = Buffer.from(decoded, "utf8");
  if (expected.byteLength > MAX_EXPECTED_BYTES) return undefined;

  const path = normalizedTargetPath(match[2]!);
  if (!path || !isExactArtifactPath(path) || !input.taskOwnedPaths.includes(path)) return undefined;
  const actual = readOwnedRegularFile(input.cwd, path, expected.byteLength);
  if (!actual || !actual.equals(expected)) return undefined;

  return {
    kind: "file_exact_bytes",
    path,
    expectedSha256: createHash("sha256").update(expected).digest("hex"),
    selectors: assertionSelectors(path, expected),
  };
}

function decodePrintfLiteral(value: string): string | undefined {
  let decoded = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character === "\\") {
      const escaped = value[++index];
      const replacements: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\" };
      if (escaped === undefined || replacements[escaped] === undefined) return undefined;
      decoded += replacements[escaped];
      continue;
    }
    if (character === "%") {
      if (value[index + 1] !== "%") return undefined;
      decoded += "%";
      index += 1;
      continue;
    }
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 || codePoint === 0x7f) return undefined;
    decoded += character;
  }
  return decoded;
}

function normalizedTargetPath(token: string): string | undefined {
  const unquoted = token.startsWith("'") ? token.slice(1, -1) : token;
  if (unquoted.split("/").includes("..")) return undefined;
  return normalizeWorkspaceEffectPath(unquoted);
}

function readOwnedRegularFile(cwd: string, path: string, expectedByteLength: number): Buffer | undefined {
  try {
    const root = realpathSync(cwd);
    let cursor = resolve(cwd);
    for (const segment of path.split("/")) {
      cursor = resolve(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) return undefined;
    }
    const metadata = lstatSync(cursor);
    if (!metadata.isFile() || metadata.size !== expectedByteLength || metadata.size > MAX_EXPECTED_BYTES)
      return undefined;
    const canonical = realpathSync(cursor);
    const fromRoot = relative(root, canonical);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined;
    const content = readFileSync(canonical);
    return content.subarray(0, 2).toString("utf8") === "#!" ? undefined : content;
  } catch {
    return undefined;
  }
}

function isExactArtifactPath(path: string): boolean {
  return EXACT_ARTIFACT_EXTENSIONS.has(extname(path).toLocaleLowerCase("en-US"));
}

function assertionSelectors(path: string, expected: Buffer): string[] {
  const terminalNewline = expected.at(-1) === 0x0a;
  const lineCount = expected.length === 0 ? 0 : countByte(expected, 0x0a) + (terminalNewline ? 0 : 1);
  return [
    path,
    `exact file bytes validation for ${path}`,
    `${terminalNewline ? "newline-terminated" : "not newline-terminated"}; ${lineCount} line${lineCount === 1 ? "" : "s"}`,
  ];
}

function countByte(value: Buffer, byte: number): number {
  let count = 0;
  for (const candidate of value) if (candidate === byte) count += 1;
  return count;
}
