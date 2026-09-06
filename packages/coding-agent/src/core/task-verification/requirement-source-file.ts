import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const SECRET_PATTERN =
  /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----|\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?(?!example\b|redacted\b|placeholder\b|<)[A-Za-z0-9+/_=-]{24,}|\b(?:Bearer\s+[A-Za-z0-9._~+/-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/iu;

export interface InspectedRequirementSourceFile {
  bytes: Buffer;
  text: string;
  sha256: string;
  executable: boolean;
}

export interface RequirementSourcePathIdentity {
  absolutePath: string;
  physicalPath: string;
  stat: Stats;
}

export function inspectRequirementSourcePathIdentity(
  cwd: string,
  documentPath: string,
): RequirementSourcePathIdentity | string {
  const workspaceRoot = resolve(cwd);
  const absolutePath = resolve(workspaceRoot, documentPath);
  const rel = relative(workspaceRoot, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return unsafePath(documentPath);
  try {
    if (hasSymlinkComponent(workspaceRoot, rel)) return `Requirement source uses a symlink: ${documentPath}`;
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.nlink !== 1) return isolatedFileError(documentPath);
    const physicalRoot = realpathSync(workspaceRoot);
    const physicalPath = realpathSync(absolutePath);
    const physicalRel = relative(physicalRoot, physicalPath);
    if (!physicalRel || physicalRel === ".." || physicalRel.startsWith(`..${sep}`) || isAbsolute(physicalRel)) {
      return unsafePath(documentPath);
    }
    return { absolutePath, physicalPath, stat };
  } catch {
    return `Cannot inspect requirement source: ${documentPath}`;
  }
}

export function inspectRequirementSourceFile(
  cwd: string,
  documentPath: string,
  maxBytes: number,
): InspectedRequirementSourceFile | string {
  const identity = inspectRequirementSourcePathIdentity(cwd, documentPath);
  if (typeof identity === "string") return identity;
  const { absolutePath, stat: beforeOpen } = identity;
  let descriptor: number | undefined;
  try {
    if (beforeOpen.size > maxBytes) {
      return `${documentPath} exceeds the ${maxBytes}-byte requirement-source limit.`;
    }
    if (!isGitTracked(cwd, documentPath)) return `Requirement source must be a Git-tracked file: ${documentPath}`;
    descriptor = openSync(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== beforeOpen.dev || opened.ino !== beforeOpen.ino) {
      return isolatedFileError(documentPath);
    }
    if (opened.size > maxBytes) return `${documentPath} exceeds the ${maxBytes}-byte requirement-source limit.`;
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) return `Requirement source changed while it was being read: ${documentPath}`;
      offset += count;
    }
    const overflow = Buffer.alloc(1);
    if (readSync(descriptor, overflow, 0, 1, offset) !== 0) {
      return `Requirement source changed while it was being read: ${documentPath}`;
    }
    const afterRead = lstatSync(absolutePath);
    if (afterRead.dev !== opened.dev || afterRead.ino !== opened.ino || afterRead.size !== opened.size) {
      return `Requirement source changed while it was being read: ${documentPath}`;
    }
    const text = decodeRequirementSourceText(bytes);
    if (typeof text !== "string") return text.error;
    return { bytes, text, sha256: hashRequirementSourceBytes(bytes), executable: (opened.mode & 0o111) !== 0 };
  } catch {
    return `Cannot inspect requirement source: ${documentPath}`;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function requirementSourceTextSafetyError(text: string): string | undefined {
  if (text.includes("\0")) return "requirement source contains NUL bytes";
  if (SECRET_PATTERN.test(text)) return "requirement source appears to contain a secret";
  return undefined;
}

export function hashRequirementSourceText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function decodeRequirementSourceText(bytes: Uint8Array): string | { error: string } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { error: "Requirement source is not valid UTF-8 text." };
  }
  const safetyError = requirementSourceTextSafetyError(text);
  return safetyError ? { error: `${safetyError[0]!.toUpperCase()}${safetyError.slice(1)}.` } : text;
}

function isGitTracked(cwd: string, documentPath: string): boolean {
  const tracked = spawnSync("git", ["-C", cwd, "ls-files", "--error-unmatch", "--", documentPath], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return tracked.status === 0;
}

function hasSymlinkComponent(cwd: string, relPath: string): boolean {
  let current = cwd;
  for (const component of relPath.split(sep)) {
    current = resolve(current, component);
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function hashRequirementSourceBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isolatedFileError(path: string): string {
  return `Requirement source is not an isolated regular file: ${path}`;
}

function unsafePath(path: string): string {
  return `Requirement source escapes the workspace: ${path}`;
}
