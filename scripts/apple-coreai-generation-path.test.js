import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_COREAI_ARTIFACT_VERSION,
  validateArtifactRoot,
  validateGenerationPath,
} from "./apple-coreai-generation-path.js";
import {
  APPLE_CORE_AI_MANIFEST,
  buildAppleCoreAiCandidate,
  promoteCurrentPointerAtomic,
} from "./install-apple-coreai.js";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const VALID_GENERATION = `${CANONICAL_COREAI_ARTIFACT_VERSION}-${VALID_UUID}`;

function createFakeBuilder(tempDir, options = {}) {
  const markerPath = path.join(tempDir, `builder_marker_${Math.random().toString(36).slice(2)}.log`);
  const builderScript = path.join(tempDir, `fake_builder_${Math.random().toString(36).slice(2)}.sh`);
  const exitCode = options.exitCode ?? 0;
  fs.writeFileSync(
    builderScript,
    `#!/bin/sh\necho "executed" >> "${markerPath}"\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
  return {
    builderScript,
    wasExecuted: () => fs.existsSync(markerPath),
  };
}

test("accepts valid canonical temp root and missing or existing directory root", () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");

  try {
    assert.equal(validateArtifactRoot(artifactRoot), artifactRoot);
    assert.equal(
      validateGenerationPath(artifactRoot, VALID_GENERATION),
      path.join(artifactRoot, VALID_GENERATION),
    );

    fs.mkdirSync(artifactRoot, { recursive: true });
    assert.equal(validateArtifactRoot(artifactRoot), artifactRoot);
    assert.equal(
      validateGenerationPath(artifactRoot, VALID_GENERATION),
      path.join(artifactRoot, VALID_GENERATION),
    );
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("rejects relative root before builder spawn and pointer promotion", async () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const relativeRoot = "relative/path/indexing-service/apple-coreai";
  const { builderScript, wasExecuted } = createFakeBuilder(tempDir);

  try {
    assert.throws(
      () => validateArtifactRoot(relativeRoot),
      /artifactRoot must be an absolute path/,
    );
    assert.throws(
      () => validateGenerationPath(relativeRoot, VALID_GENERATION),
      /artifactRoot must be an absolute path/,
    );
    assert.throws(
      () => promoteCurrentPointerAtomic(relativeRoot, VALID_GENERATION),
      /artifactRoot must be an absolute path/,
    );

    await assert.rejects(
      () => buildAppleCoreAiCandidate(builderScript, tempDir, relativeRoot, VALID_GENERATION),
      /artifactRoot must be an absolute path/,
    );
    assert.equal(wasExecuted(), false, "Builder must not be spawned for relative root");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("rejects root/broad or wrong-shape roots before builder spawn", async () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const { builderScript, wasExecuted } = createFakeBuilder(tempDir);

  const invalidRoots = [
    "/",
    "/tmp",
    canonicalTemp,
    "/indexing-service/apple-coreai",
    path.join(tempDir, "indexing-service"),
    path.join(tempDir, "other-service", "apple-coreai"),
    path.join(tempDir, "indexing-service", "other-module"),
    path.join(tempDir, "indexing-service", "apple-coreai", "nested"),
    `${path.join(tempDir, "indexing-service", "apple-coreai")}/`,
    `${tempDir}/indexing-service/../indexing-service/apple-coreai`,
  ];

  try {
    for (const invalidRoot of invalidRoots) {
      assert.throws(() => validateArtifactRoot(invalidRoot));
      assert.throws(() => validateGenerationPath(invalidRoot, VALID_GENERATION));
      await assert.rejects(() =>
        buildAppleCoreAiCandidate(builderScript, tempDir, invalidRoot, VALID_GENERATION),
      );
    }
    assert.equal(wasExecuted(), false, "Builder must not be spawned for invalid roots");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("rejects final-root file before builder spawn and pointer promotion", async () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  fs.mkdirSync(path.dirname(artifactRoot), { recursive: true });
  fs.writeFileSync(artifactRoot, "regular file content instead of directory");
  const { builderScript, wasExecuted } = createFakeBuilder(tempDir);

  try {
    assert.throws(
      () => validateArtifactRoot(artifactRoot),
      /Path component must be a directory/,
    );
    assert.throws(
      () => validateGenerationPath(artifactRoot, VALID_GENERATION),
      /Path component must be a directory/,
    );
    assert.throws(
      () => promoteCurrentPointerAtomic(artifactRoot, VALID_GENERATION),
      /Path component must be a directory/,
    );

    await assert.rejects(
      () => buildAppleCoreAiCandidate(builderScript, tempDir, artifactRoot, VALID_GENERATION),
      /Path component must be a directory/,
    );
    assert.equal(wasExecuted(), false, "Builder must not be spawned when final root is a file");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("rejects final-root symlink and preserves external target and current.json", async () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const externalTarget = path.join(tempDir, "external-target");
  fs.mkdirSync(externalTarget, { recursive: true });
  const externalCurrentJson = path.join(externalTarget, "current.json");
  const initialContent = JSON.stringify({ artifactVersion: "victim-version", untouchable: true }, null, 2);
  fs.writeFileSync(externalCurrentJson, initialContent);

  const parentDir = path.join(tempDir, "indexing-service");
  fs.mkdirSync(parentDir, { recursive: true });
  const symlinkRoot = path.join(parentDir, "apple-coreai");
  fs.symlinkSync(externalTarget, symlinkRoot);
  const { builderScript, wasExecuted } = createFakeBuilder(tempDir);

  try {
    assert.throws(
      () => validateArtifactRoot(symlinkRoot),
      /Path component must not be a symbolic link/,
    );
    assert.throws(
      () => validateGenerationPath(symlinkRoot, VALID_GENERATION),
      /Path component must not be a symbolic link/,
    );
    assert.throws(
      () => promoteCurrentPointerAtomic(symlinkRoot, VALID_GENERATION),
      /Path component must not be a symbolic link/,
    );

    await assert.rejects(
      () => buildAppleCoreAiCandidate(builderScript, tempDir, symlinkRoot, VALID_GENERATION),
      /Path component must not be a symbolic link/,
    );
    assert.equal(wasExecuted(), false, "Builder must not be spawned when final root is a symlink");
    assert.equal(fs.readFileSync(externalCurrentJson, "utf8"), initialContent, "External target must be preserved");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("rejects symlinked indexing-service parent and preserves external parent target", async () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const externalParent = path.join(tempDir, "external-parent");
  fs.mkdirSync(path.join(externalParent, "apple-coreai"), { recursive: true });
  const externalCanary = path.join(externalParent, "sensitive.txt");
  fs.writeFileSync(externalCanary, "preserve-sensitive-data");

  const symlinkParent = path.join(tempDir, "indexing-service");
  fs.symlinkSync(externalParent, symlinkParent);
  const artifactRoot = path.join(symlinkParent, "apple-coreai");
  const { builderScript, wasExecuted } = createFakeBuilder(tempDir);

  try {
    assert.throws(
      () => validateArtifactRoot(artifactRoot),
      /Path component must not be a symbolic link/,
    );
    assert.throws(
      () => validateGenerationPath(artifactRoot, VALID_GENERATION),
      /Path component must not be a symbolic link/,
    );
    assert.throws(
      () => promoteCurrentPointerAtomic(artifactRoot, VALID_GENERATION),
      /Path component must not be a symbolic link/,
    );

    await assert.rejects(
      () => buildAppleCoreAiCandidate(builderScript, tempDir, artifactRoot, VALID_GENERATION),
      /Path component must not be a symbolic link/,
    );
    assert.equal(wasExecuted(), false, "Builder must not be spawned when parent is a symlink");
    assert.equal(fs.readFileSync(externalCanary, "utf8"), "preserve-sensitive-data");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("rejects real traversal generation strings before builder spawn and promotion", async () => {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  const { builderScript, wasExecuted } = createFakeBuilder(tempDir);

  const traversalGenerations = [
    "../../../etc/passwd",
    `${CANONICAL_COREAI_ARTIFACT_VERSION}-../../escape`,
    `${CANONICAL_COREAI_ARTIFACT_VERSION}-${VALID_UUID}/../../escape`,
    `${CANONICAL_COREAI_ARTIFACT_VERSION}-${VALID_UUID}/subdir`,
    `/${CANONICAL_COREAI_ARTIFACT_VERSION}-${VALID_UUID}`,
    "\\..\\..\\escape",
    "",
    "not-canonical-generation",
    `${CANONICAL_COREAI_ARTIFACT_VERSION}-not-a-uuid`,
  ];

  try {
    for (const gen of traversalGenerations) {
      assert.throws(() => validateGenerationPath(artifactRoot, gen));
      assert.throws(() => promoteCurrentPointerAtomic(artifactRoot, gen));
      await assert.rejects(() =>
        buildAppleCoreAiCandidate(builderScript, tempDir, artifactRoot, gen),
      );
    }
    assert.equal(wasExecuted(), false, "Builder must not be spawned for traversal generation");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("manifest and path validator use identical canonical artifact version constant", () => {
  assert.equal(APPLE_CORE_AI_MANIFEST.artifactVersion, CANONICAL_COREAI_ARTIFACT_VERSION);
  assert.equal(typeof CANONICAL_COREAI_ARTIFACT_VERSION, "string");
  assert.ok(CANONICAL_COREAI_ARTIFACT_VERSION.length > 0);

  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(canonicalTemp, "coreai-boundary-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  const manifestGen = `${APPLE_CORE_AI_MANIFEST.artifactVersion}-${VALID_UUID}`;

  try {
    assert.equal(
      validateGenerationPath(artifactRoot, manifestGen),
      path.join(artifactRoot, manifestGen),
    );
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
