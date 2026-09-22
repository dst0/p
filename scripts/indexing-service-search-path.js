import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// POSIX and macOS per-user temporary roots. /tmp and /var are symlinks into /private on macOS.
const SYSTEM_TEMPORARY_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
// Session scratch directories nested elsewhere, e.g. ~/.codex/tmp/arg0/<session>.
const TEMPORARY_SEGMENT = /^(?:tmp|temp)$/i;

/**
 * Returns the installing shell's PATH reduced to entries a long-lived service can rely on: absolute,
 * existing directories that are not temporary, in their original order and without duplicates.
 */
export function sanitizeServiceSearchPath(searchPath, { isTemporary = isTemporaryDirectory } = {}) {
  const directories = [];
  for (const entry of searchPath.split(path.delimiter)) {
    if (!path.isAbsolute(entry)) continue;
    const directory = path.resolve(entry);
    if (directories.includes(directory) || !isExistingDirectory(directory) || isTemporary(directory)) continue;
    directories.push(directory);
  }
  return directories;
}

export function isTemporaryDirectory(directory, temporaryRoots = [os.tmpdir(), ...SYSTEM_TEMPORARY_ROOTS]) {
  return (
    path.resolve(directory).split(path.sep).some((segment) => TEMPORARY_SEGMENT.test(segment))
    || isUnderTemporaryRoot(directory, temporaryRoots)
  );
}

/** Compares both lexical and resolved forms so symlinked roots and entries cannot hide a temporary location. */
export function isUnderTemporaryRoot(directory, temporaryRoots) {
  const roots = temporaryRoots.flatMap(withRealPath).filter((root) => root !== path.parse(root).root);
  return withRealPath(directory).some((location) =>
    roots.some((root) => location === root || location.startsWith(`${root}${path.sep}`)),
  );
}

function withRealPath(location) {
  const resolved = path.resolve(location);
  try {
    const realPath = fs.realpathSync(resolved);
    return realPath === resolved ? [resolved] : [resolved, realPath];
  } catch {
    return [resolved];
  }
}

function isExistingDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}
