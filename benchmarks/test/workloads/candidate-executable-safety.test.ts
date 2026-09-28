import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertCandidateExecutableSafety } from "../../src/workloads/candidate-executable-safety.ts";

test("candidate executable safety rejects symlinks, hard links, and writable code", () => {
  const root = mkdtempSync(join(tmpdir(), "candidate-executable-safety-"));
  try {
    const executable = join(root, "candidate");
    writeFileSync(executable, "#!/bin/sh\necho 1.0.0\n");
    chmodSync(executable, 0o755);
    assert.doesNotThrow(() => assertCandidateExecutableSafety(executable));

    const symlink = join(root, "candidate-link");
    symlinkSync(executable, symlink);
    assert.throws(() => assertCandidateExecutableSafety(symlink), /non-symlink/u);

    const hardLink = join(root, "candidate-hard-link");
    linkSync(executable, hardLink);
    assert.throws(() => assertCandidateExecutableSafety(executable), /multiple hard links/u);
    rmSync(hardLink);

    chmodSync(executable, 0o775);
    assert.throws(() => assertCandidateExecutableSafety(executable), /group- or world-writable/u);

    const unsafeParent = join(root, "unsafe-parent");
    mkdirSync(unsafeParent);
    const nested = join(unsafeParent, "candidate");
    writeFileSync(nested, "#!/bin/sh\necho 1.0.0\n");
    chmodSync(nested, 0o755);
    chmodSync(unsafeParent, 0o777);
    assert.throws(() => assertCandidateExecutableSafety(nested), /world-writable without sticky bit/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
