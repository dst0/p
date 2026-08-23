import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const BROTLI_PARAMETERS = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};
const FAULT_POINTS = new Set([undefined, "before-publish", "after-publish"]);

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertSafeTarget(path) {
  try {
    const descriptor = lstatSync(path);
    if (!descriptor.isFile() || descriptor.isSymbolicLink() || descriptor.nlink > 1) {
      throw new Error("Private Brotli target must be a non-linked regular file");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function injectedFault(point) {
  throw new Error(`Injected ${point} failure`);
}

export function replacePrivateBrotliText(finalPath, text, options = {}) {
  if (typeof finalPath !== "string" || !finalPath.endsWith(".br")) {
    throw new Error("Private Brotli target must end with .br");
  }
  if (typeof text !== "string") throw new Error("Private Brotli text must be a string");
  if (!FAULT_POINTS.has(options.faultAt)) throw new Error("Unknown private Brotli fault point");
  const targetPath = resolve(finalPath);
  assertSafeTarget(targetPath);
  const outputDirectory = dirname(targetPath);
  const temporaryPath = join(outputDirectory, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  const compressed = brotliCompressSync(Buffer.from(text, "utf8"), { params: BROTLI_PARAMETERS });
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, compressed);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(outputDirectory);
    if (options.faultAt === "before-publish") injectedFault("before-publish");
    renameSync(temporaryPath, targetPath);
    if (options.faultAt === "after-publish") injectedFault("after-publish");
    fsyncDirectory(outputDirectory);
    return targetPath;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    fsyncDirectory(outputDirectory);
    throw error;
  }
}
