import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EphemeralAuthSnapshot {
  readonly path: string;
  readonly present: boolean;
  dispose(): void;
}

const expectedHashes = new WeakMap<EphemeralAuthSnapshot, string | undefined>();

export function createEphemeralAuthSnapshot(source: string, temporaryParent = tmpdir()): EphemeralAuthSnapshot {
  const root = mkdtempSync(join(temporaryParent, "p-benchmark-auth-"));
  chmodSync(root, 0o700);
  const path = join(root, "auth.json");
  try {
    const present = existsSync(source);
    if (present) {
      copyFileSync(source, path);
      chmodSync(path, 0o600);
    }
    const snapshot = { dispose: () => rmSync(root, { recursive: true, force: true }) } as EphemeralAuthSnapshot;
    Object.defineProperties(snapshot, { path: { value: path }, present: { value: present } });
    expectedHashes.set(snapshot, present ? hashFile(path) : undefined);
    return snapshot;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function verifyEphemeralAuthSnapshot(snapshot: EphemeralAuthSnapshot): boolean {
  try {
    const expected = expectedHashes.get(snapshot);
    return snapshot.present
      ? typeof expected === "string" && hashFile(snapshot.path) === expected
      : !existsSync(snapshot.path);
  } catch {
    return false;
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
