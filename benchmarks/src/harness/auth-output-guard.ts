import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import { replacePrivateBrotliText } from "./private-brotli.ts";

const REDACTION = "<REDACTED_AUTH>";
const OMITTED_ARTIFACT_DIRECTORIES = new Set(["node_modules"]);

type ReplaceBrotliText = typeof replacePrivateBrotliText;
type CopyTree = (source: string, destination: string) => void;

export interface BenchmarkAuthOutputGuard {
  capture(path: string): void;
  retainTree(source: string, destination: string): void;
  sanitizeTree(root: string): void;
}

interface BenchmarkAuthOutputGuardOptions {
  replaceBrotliText?: ReplaceBrotliText;
  copyTree?: CopyTree;
}

export function createBenchmarkAuthOutputGuard(
  authFiles: readonly string[] = [],
  options: BenchmarkAuthOutputGuardOptions = {},
): BenchmarkAuthOutputGuard {
  const replaceBrotliText = options.replaceBrotliText ?? replacePrivateBrotliText;
  const terms = new Set<string>();
  const byteTerms: Buffer[] = [];
  let captureFailed = false;
  const addTerm = (value: unknown, includeHash = false): void => {
    if (typeof value !== "string" || value.length === 0) return;
    if (value === REDACTION) throw new Error("Private credential collides with the redaction marker");
    terms.add(value);
    const encoded = JSON.stringify(value).slice(1, -1);
    if (encoded.length > 0) terms.add(encoded);
    if (includeHash) terms.add(hash(value));
  };
  const capture = (path: string): void => {
    if (typeof path !== "string" || path.length === 0) return;
    try {
      addTerm(path);
      addTerm(dirname(path));
      if (!existsSync(path)) return;
      const descriptor = lstatSync(path);
      if (descriptor.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!lstatSync(target).isFile()) throw new Error("Benchmark auth symlink does not resolve to a regular file");
        addTerm(target);
        addTerm(dirname(target));
      } else if (!descriptor.isFile()) {
        throw new Error("Benchmark auth input is no longer a regular file");
      }
      const bytes = readFileSync(path);
      const contents = bytes.toString("utf8");
      terms.add(createHash("sha256").update(bytes).digest("hex"));
      let containsSecret = false;
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch {
        containsSecret = contents.trim().length > 0;
      }
      if (parsed !== undefined) {
        collectStringLeaves(parsed, (value) => {
          containsSecret = true;
          addTerm(value, true);
        });
      }
      if (containsSecret) {
        byteTerms.push(Buffer.from(bytes));
        addTerm(contents, true);
        addTerm(contents.trim(), true);
      }
    } catch (error) {
      captureFailed = true;
      throw error;
    }
  };
  for (const path of authFiles) capture(path);
  const sanitize = (root: string): void => {
    if (captureFailed) {
      removeArtifactRoot(root);
      throw new Error("Private benchmark auth refresh could not be captured safely");
    }
    sanitizeTree(root, terms, byteTerms, replaceBrotliText);
  };
  return {
    capture,
    retainTree: (source, destination) => retainTree(source, destination, sanitize, options.copyTree ?? copyTree),
    sanitizeTree: sanitize,
  };
}

function collectStringLeaves(value: unknown, collect: (value: string) => void): void {
  if (typeof value === "string") {
    collect(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStringLeaves(entry, collect);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "type") collectStringLeaves(entry, collect);
  }
}

function retainTree(source: string, destination: string, sanitize: (root: string) => void, copy: CopyTree): void {
  if (!existsSync(source)) return;
  try {
    sanitize(source);
    const existingDestination = describePath(destination);
    if (existingDestination) {
      removeArtifactRoot(destination, existingDestination);
      throw new Error("Retained benchmark destination must not already exist");
    }
    try {
      mkdirSync(dirname(destination), { recursive: true });
      copy(source, destination);
      const copiedDestination = describePath(destination);
      if (!copiedDestination?.isDirectory() || copiedDestination.isSymbolicLink()) {
        throw new Error("Retained benchmark destination is not a real directory");
      }
      sanitize(destination);
    } catch (error) {
      removeArtifactRoot(destination);
      throw error;
    }
  } finally {
    removeArtifactRoot(source);
  }
}

function copyTree(source: string, destination: string): void {
  cpSync(source, destination, { recursive: true });
}

function sanitizeTree(
  root: string,
  termSet: ReadonlySet<string>,
  byteTerms: readonly Buffer[],
  replaceBrotliText: ReplaceBrotliText,
): void {
  const rootDescriptor = describePath(root);
  if (!rootDescriptor) return;
  if (!rootDescriptor.isDirectory() || rootDescriptor.isSymbolicLink()) {
    removeArtifactRoot(root, rootDescriptor);
    throw new Error("Private benchmark artifact root must be a real directory");
  }
  try {
    const terms = [...termSet].sort((left, right) => right.length - left.length);
    const failures: Error[] = [];
    for (const artifact of listArtifacts(root, terms, failures)) {
      sanitizeArtifact(artifact, terms, byteTerms, failures, replaceBrotliText);
    }
    const leaks: Error[] = [];
    for (const artifact of listArtifacts(root, terms, leaks)) {
      if (artifactContainsTerm(artifact, terms, byteTerms)) {
        rmSync(artifact, { recursive: true, force: true });
        leaks.push(new Error("Private benchmark artifact remained after redaction"));
      }
    }
    if (failures.length > 0 || leaks.length > 0) {
      throw new AggregateError([...failures, ...leaks], "Private benchmark artifact could not be retained safely");
    }
  } catch (error) {
    removeArtifactRoot(root);
    throw error;
  }
}

function listArtifacts(root: string, terms: readonly string[], failures: Error[], current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const descriptor = relative(root, path);
    if (containsTerm(descriptor, terms)) {
      removeArtifactRoot(path);
      failures.push(new Error("Private benchmark artifact path was removed"));
    } else if (entry.isDirectory()) {
      if (OMITTED_ARTIFACT_DIRECTORIES.has(entry.name)) removeArtifactRoot(path);
      else files.push(...listArtifacts(root, terms, failures, path));
    } else if (entry.isSymbolicLink()) {
      unlinkSync(path);
      failures.push(new Error("Private benchmark artifact symlink was removed"));
    } else if (entry.isFile()) {
      if (lstatSync(path).nlink > 1) {
        unlinkSync(path);
        failures.push(new Error("Private benchmark hard-linked artifact was removed"));
      } else {
        files.push(path);
      }
    } else {
      removeArtifactRoot(path);
      failures.push(new Error("Private benchmark non-regular artifact was removed"));
    }
  }
  return files;
}

function sanitizeArtifact(
  path: string,
  terms: readonly string[],
  byteTerms: readonly Buffer[],
  failures: Error[],
  replaceBrotliText: ReplaceBrotliText,
): void {
  try {
    if (path.endsWith(".br")) {
      const bytes = brotliDecompressSync(readFileSync(path));
      if (!bufferContainsTerm(bytes, terms, byteTerms)) return;
      const contents = bytes.toString("utf8");
      if (!Buffer.from(contents).equals(bytes)) throw new Error("Private data appeared in a binary Brotli artifact");
      const sanitized = redact(contents, terms);
      if (sanitized !== contents) {
        if (lstatSync(path).nlink > 1) throw new Error("Private data appeared in a hard-linked artifact");
        replaceBrotliText(path, sanitized);
      }
      return;
    }
    const bytes = readFileSync(path);
    if (!bufferContainsTerm(bytes, terms, byteTerms)) return;
    const contents = bytes.toString("utf8");
    if (!Buffer.from(contents).equals(bytes)) throw new Error("Private data appeared in a binary artifact");
    if (lstatSync(path).nlink > 1) throw new Error("Private data appeared in a hard-linked artifact");
    writeFileSync(path, redact(contents, terms));
  } catch {
    rmSync(path, { recursive: true, force: true });
    failures.push(new Error("Private benchmark artifact was removed after redaction failure"));
  }
}

function artifactContainsTerm(path: string, terms: readonly string[], byteTerms: readonly Buffer[]): boolean {
  try {
    const bytes = path.endsWith(".br") ? brotliDecompressSync(readFileSync(path)) : readFileSync(path);
    return bufferContainsTerm(bytes, terms, byteTerms);
  } catch {
    rmSync(path, { recursive: true, force: true });
    return true;
  }
}

function redact(value: string, terms: readonly string[]): string {
  let sanitized = value;
  for (const term of terms) sanitized = sanitized.replaceAll(term, REDACTION);
  return sanitized;
}

function containsTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function bufferContainsTerm(value: Buffer, terms: readonly string[], byteTerms: readonly Buffer[]): boolean {
  return terms.some((term) => value.includes(Buffer.from(term))) || byteTerms.some((term) => value.includes(term));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function describePath(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function removeArtifactRoot(path: string, descriptor = describePath(path)): void {
  if (!descriptor) return;
  if (descriptor.isSymbolicLink()) unlinkSync(path);
  else rmSync(path, { recursive: true, force: true });
}
