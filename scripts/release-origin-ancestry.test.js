import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { verifyReleaseReceipt } from "./release-certificate-receipt.js";
import {
  createReleaseFlowFixture,
  git,
  runFixtureRelease,
  write,
} from "./release-flow-test-fixture.js";

test("receipt rejects a release tag outside current origin main ancestry", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const result = runFixtureRelease(fixture);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const baseSha = git(fixture.repoRoot, "rev-parse", "v0.5.0^");
    git(fixture.remoteRoot, "update-ref", "refs/heads/main", baseSha);

    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /not contained in current origin main/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("receipt fetches an unseen current origin main before checking tag ancestry", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const result = runFixtureRelease(fixture);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const advancedClone = join(fixture.root, "advanced-origin-main");
    git(fixture.root, "clone", fixture.remoteRoot, advancedClone);
    git(advancedClone, "config", "user.email", "release-test@example.invalid");
    git(advancedClone, "config", "user.name", "Release Test");
    write(advancedClone, "README.md", "advance origin main after release\n");
    git(advancedClone, "add", "README.md");
    git(advancedClone, "commit", "-m", "advance origin main");
    git(advancedClone, "push", "origin", "main");
    git(fixture.repoRoot, "update-ref", "-d", "refs/remotes/origin/main");

    assert.equal(
      verifyReleaseReceipt(fixture.repoRoot, "v0.5.0").receipt.targetVersion,
      "0.5.0",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
