import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import {
  createReleaseFlowFixture,
  git,
  gitBuffer,
  write,
} from "./release-flow-test-fixture.js";
import {
  computeReleaseInputHash,
  hashReleaseInputEntries,
  releaseInputPaths,
  releaseInputPathsAtRevision,
} from "./release-inputs.js";

const PACKAGING_INPUTS = [
  "scripts/build-binaries.sh",
  "scripts/local-release.js",
  "scripts/npm-pack-result.js",
  "scripts/publish.js",
];
const TEST_INPUT = "scripts/release-packaging-inputs.test.js";

function revisionHash(repoRoot, revision) {
  const paths = releaseInputPathsAtRevision(repoRoot, revision);
  return hashReleaseInputEntries(
    paths.map((path) => ({
      path,
      content: gitBuffer(repoRoot, "show", `${revision}:${path}`),
    })),
  );
}

test("binds present packaging implementations while preserving historical and test exclusions", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const absentRevision = git(fixture.repoRoot, "rev-parse", "HEAD");
    const absentWorktreePaths = releaseInputPaths(fixture.repoRoot);
    const absentRevisionPaths = releaseInputPathsAtRevision(fixture.repoRoot, absentRevision);

    assert.deepEqual(
      PACKAGING_INPUTS.filter((path) => absentWorktreePaths.includes(path)),
      [],
    );
    assert.deepEqual(
      PACKAGING_INPUTS.filter((path) => absentRevisionPaths.includes(path)),
      [],
    );
    assert.equal(absentWorktreePaths.includes(TEST_INPUT), false);
    assert.equal(absentRevisionPaths.includes(TEST_INPUT), false);
    assert.deepEqual(absentWorktreePaths, absentRevisionPaths);
    const absentWorktreeHash = computeReleaseInputHash(fixture.repoRoot);
    const absentRevisionHash = revisionHash(fixture.repoRoot, absentRevision);
    assert.equal(absentWorktreeHash, absentRevisionHash);

    const packagingContents = new Map(
      PACKAGING_INPUTS.map((path) => [path, `release packaging implementation: ${path}\n`]),
    );
    for (const [path, content] of packagingContents) write(fixture.repoRoot, path, content);
    write(fixture.repoRoot, TEST_INPUT, "test-only release input\n");

    const presentWorktreePaths = releaseInputPaths(fixture.repoRoot);
    assert.deepEqual(
      PACKAGING_INPUTS.filter((path) => !presentWorktreePaths.includes(path)),
      [],
    );
    assert.equal(presentWorktreePaths.includes(TEST_INPUT), false);
    const presentWorktreeHash = computeReleaseInputHash(fixture.repoRoot);
    assert.notEqual(presentWorktreeHash, absentWorktreeHash);
    write(fixture.repoRoot, TEST_INPUT, "changed test-only release input\n");
    assert.equal(computeReleaseInputHash(fixture.repoRoot), presentWorktreeHash);
    write(fixture.repoRoot, TEST_INPUT, "test-only release input\n");

    for (const [path, content] of packagingContents) {
      const beforeMutation = computeReleaseInputHash(fixture.repoRoot);
      write(fixture.repoRoot, path, `${content}mutation\n`);
      assert.notEqual(computeReleaseInputHash(fixture.repoRoot), beforeMutation, path);
      write(fixture.repoRoot, path, content);
      assert.equal(computeReleaseInputHash(fixture.repoRoot), beforeMutation, path);
    }
    assert.equal(revisionHash(fixture.repoRoot, absentRevision), absentRevisionHash);

    git(fixture.repoRoot, "add", ...PACKAGING_INPUTS, TEST_INPUT);
    git(fixture.repoRoot, "commit", "-m", "add release packaging implementations");
    const packagedRevision = git(fixture.repoRoot, "rev-parse", "HEAD");
    const packagedRevisionPaths = releaseInputPathsAtRevision(fixture.repoRoot, packagedRevision);
    assert.deepEqual(
      PACKAGING_INPUTS.filter((path) => !packagedRevisionPaths.includes(path)),
      [],
    );
    assert.equal(packagedRevisionPaths.includes(TEST_INPUT), false);
    assert.notEqual(revisionHash(fixture.repoRoot, packagedRevision), absentRevisionHash);

    const beforeRevisionMutation = revisionHash(fixture.repoRoot, packagedRevision);
    write(fixture.repoRoot, "scripts/publish.js", `${packagingContents.get("scripts/publish.js")}mutation\n`);
    git(fixture.repoRoot, "add", "scripts/publish.js");
    git(fixture.repoRoot, "commit", "-m", "change release publisher");
    const mutatedRevision = git(fixture.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(revisionHash(fixture.repoRoot, mutatedRevision), beforeRevisionMutation);
    assert.equal(revisionHash(fixture.repoRoot, absentRevision), absentRevisionHash);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
