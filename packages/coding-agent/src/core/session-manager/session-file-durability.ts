import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { SessionFileAppendError } from "./session-file-append-error.ts";

export { SessionFileAppendError } from "./session-file-append-error.ts";

export interface SessionFileDurabilityOperations {
  closeSync(fd: number): void;
  copyFileSync(source: string, target: string, mode?: number): void;
  existsSync(path: string): boolean;
  fsyncSync(fd: number): void;
  linkSync(source: string, target: string): void;
  mkdirSync(path: string, options: { recursive: boolean; mode?: number }): void;
  openSync(path: string, flags: string, mode?: number): number;
  readFileSync(path: string, encoding: "utf8"): string;
  renameSync(source: string, target: string): void;
  unlinkSync(path: string): void;
  writeFileSync(fd: number, data: string): void;
}

const NODE_OPERATIONS: SessionFileDurabilityOperations = {
  closeSync: (fd) => closeSync(fd),
  copyFileSync: (source, target, mode) => copyFileSync(source, target, mode),
  existsSync: (path) => existsSync(path),
  fsyncSync: (fd) => fsyncSync(fd),
  linkSync: (source, target) => linkSync(source, target),
  mkdirSync: (path, options) => {
    mkdirSync(path, options);
  },
  openSync: (path, flags, mode) => openSync(path, flags, mode),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  renameSync: (source, target) => renameSync(source, target),
  unlinkSync: (path) => unlinkSync(path),
  writeFileSync: (fd, data) => writeFileSync(fd, data),
};

function resolveOperations(
  overrides: Partial<SessionFileDurabilityOperations> | undefined,
): SessionFileDurabilityOperations {
  return { ...NODE_OPERATIONS, ...overrides };
}

function removeIfPresent(filePath: string, operations: SessionFileDurabilityOperations): void {
  try {
    operations.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function fsyncDirectory(directory: string, operations: SessionFileDurabilityOperations): void {
  if (process.platform === "win32") return;
  const fd = operations.openSync(directory, "r");
  try {
    operations.fsyncSync(fd);
  } finally {
    operations.closeSync(fd);
  }
}

function serializeJsonLine(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Session entry is not JSON-serializable");
  return `${serialized}\n`;
}

export function assertJsonLineSerializable(value: unknown): void {
  serializeJsonLine(value);
}

export class SessionFilePublicationError extends Error {
  readonly publicationState = "published_not_durable" as const;

  constructor(targetPath: string, cause: unknown) {
    super(`Session file was published but directory durability could not be confirmed: ${targetPath}`, { cause });
    this.name = "SessionFilePublicationError";
  }
}

export function ensureDirectoryDurably(
  directory: string,
  operationOverrides?: Partial<SessionFileDurabilityOperations>,
  mode?: number,
): void {
  const operations = resolveOperations(operationOverrides);
  const missing: string[] = [];
  let current = directory;
  while (!operations.existsSync(current)) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (let index = missing.length - 1; index >= 0; index--) {
    const created = missing[index];
    try {
      operations.mkdirSync(created, { recursive: false, ...(mode === undefined ? {} : { mode }) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !operations.existsSync(created)) throw error;
    }
    fsyncDirectory(dirname(created), operations);
  }
}

export function writeJsonLinesAtomically(
  targetPath: string,
  entries: readonly unknown[],
  options: { exclusive?: boolean } = {},
  operationOverrides?: Partial<SessionFileDurabilityOperations>,
): void {
  const operations = resolveOperations(operationOverrides);
  const directory = dirname(targetPath);
  ensureDirectoryDurably(directory, operations);
  const serializedEntries = entries.map(serializeJsonLine);
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  let published = false;
  try {
    fd = operations.openSync(tempPath, "wx", 0o600);
    for (const entry of serializedEntries) operations.writeFileSync(fd, entry);
    operations.fsyncSync(fd);
    operations.closeSync(fd);
    fd = undefined;

    if (options.exclusive) {
      try {
        operations.linkSync(tempPath, targetPath);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          operations.readFileSync(targetPath, "utf8") !== serializedEntries.join("")
        ) {
          throw error;
        }
      }
      published = true;
      operations.unlinkSync(tempPath);
    } else {
      operations.renameSync(tempPath, targetPath);
      published = true;
    }
    fsyncDirectory(directory, operations);
  } catch (error) {
    if (fd !== undefined) {
      try {
        operations.closeSync(fd);
      } catch {
        // Preserve the original failure.
      }
    }
    try {
      removeIfPresent(tempPath, operations);
    } catch {
      // Preserve the original failure.
    }
    if (published && !(error instanceof SessionFilePublicationError)) {
      throw new SessionFilePublicationError(targetPath, error);
    }
    throw error;
  }
}

export function appendJsonLineDurably(
  targetPath: string,
  entry: unknown,
  operationOverrides?: Partial<SessionFileDurabilityOperations>,
): void {
  const operations = resolveOperations(operationOverrides);
  const serializedEntry = serializeJsonLine(entry);
  const fd = operations.openSync(targetPath, "a", 0o600);
  let failure: unknown;
  try {
    operations.writeFileSync(fd, serializedEntry);
    operations.fsyncSync(fd);
  } catch (error) {
    failure = error;
  } finally {
    try {
      operations.closeSync(fd);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw new SessionFileAppendError(targetPath, failure);
}

export function backupCorruptedSession(
  sourcePath: string,
  operationOverrides?: Partial<SessionFileDurabilityOperations>,
): string {
  const operations = resolveOperations(operationOverrides);
  const backupPath = `${sourcePath}.corrupted.${Date.now()}-${randomUUID()}`;
  operations.copyFileSync(sourcePath, backupPath, constants.COPYFILE_EXCL);
  const fd = operations.openSync(backupPath, "r");
  try {
    operations.fsyncSync(fd);
  } finally {
    operations.closeSync(fd);
  }
  fsyncDirectory(dirname(sourcePath), operations);
  return backupPath;
}
