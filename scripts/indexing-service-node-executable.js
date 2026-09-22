import fs from "node:fs";
import path from "node:path";

// Path segments that bind a Node binary to one installed release or one shell session: dotted versions
// (Homebrew Cellar/node/26.8.1, nvm/fnm/asdf/Volta v26.8.1), the Cellar itself (including HEAD-<sha> builds),
// and fnm per-shell links.
const UNSTABLE_SEGMENT = /\d+\.\d+|^Cellar$|^fnm_multishells$/;
// Snap mounts each revision at /snap/<name>/<revision>/ and removes old revisions after refreshes.
const SNAP_REVISION = /^\d+$/;

/**
 * Chooses the Node executable a service should launch. A `node` on the sanitized search path is preferred
 * when it resolves to the running binary but is not itself version- or session-scoped, e.g. Homebrew's
 * `/opt/homebrew/bin/node` link instead of `/opt/homebrew/Cellar/node/<version>/bin/node`, which
 * `brew upgrade` deletes. Otherwise the running executable is kept.
 */
export function resolveStableNodeExecutable(execPath, searchDirectories) {
  const runningBinary = realPathOrUndefined(execPath);
  if (runningBinary === undefined) return execPath;
  for (const directory of searchDirectories) {
    const candidate = path.join(directory, "node");
    if (!isVersionScopedPath(candidate) && realPathOrUndefined(candidate) === runningBinary) return candidate;
  }
  return execPath;
}

export function isVersionScopedPath(filePath) {
  const segments = path.resolve(filePath).split(path.sep);
  return (
    segments.some((segment) => UNSTABLE_SEGMENT.test(segment))
    || (segments[1] === "snap" && SNAP_REVISION.test(segments[3] ?? ""))
  );
}

function realPathOrUndefined(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return undefined;
  }
}
