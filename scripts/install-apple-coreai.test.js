import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPLE_CORE_AI_MANIFEST,
  buildAppleCoreAiCandidate,
  installAppleCoreAiRuntime,
  isMacOsCoreAiAvailable,
  probeAppleCoreAiWorker,
  promoteCurrentPointerAtomic,
  validateCoreAiProbeHealth,
} from "./install-apple-coreai.js";

function createValidGeneration(rootDir, generation) {
  const genDir = path.join(rootDir, generation);
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(
    path.join(genDir, "artifact.json"),
    JSON.stringify({
      artifactVersion: APPLE_CORE_AI_MANIFEST.artifactVersion,
      batchSize: 1,
      model: "Qwen/Qwen3-Embedding-0.6B",
      sequenceLength: 64,
    }),
  );
  return genDir;
}

test("detects native Core AI only on supported Apple Silicon macOS", () => {
  assert.equal(isMacOsCoreAiAvailable({
    architecture: "arm64",
    macOsVersion: "27.0",
    platform: "darwin",
  }), true);
  assert.equal(isMacOsCoreAiAvailable({
    architecture: "arm64",
    macOsVersion: "26.6",
    platform: "darwin",
  }), false);
  assert.equal(isMacOsCoreAiAvailable({
    architecture: "x64",
    macOsVersion: "27.0",
    platform: "darwin",
  }), false);
});

test("pins the Core AI model source to an immutable Apple commit", () => {
  assert.match(APPLE_CORE_AI_MANIFEST.coreAiModelsCommit, /^[0-9a-f]{40}$/);
  assert.match(APPLE_CORE_AI_MANIFEST.coreAiModelsSha256, /^[0-9a-f]{64}$/);
  assert.equal(APPLE_CORE_AI_MANIFEST.artifactVersion, "qwen3-embedding-0.6b-ane-b1-s64-v1");
});

test("enforces exact production health contract", () => {
  const validHealth = {
    gpuActivity: false,
    npuFullyPlaced: true,
    preferredComputeUnit: "Neural Engine",
    status: "ready",
  };
  assert.doesNotThrow(() => validateCoreAiProbeHealth(validHealth));

  assert.throws(() => validateCoreAiProbeHealth(null), /payload is not an object/);
  assert.throws(() => validateCoreAiProbeHealth("not an object"), /payload is not an object/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, status: "error" }), /status is "error"/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, status: "initializing" }), /status is "initializing"/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, npuFullyPlaced: false }), /npuFullyPlaced is false/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, npuFullyPlaced: undefined }), /npuFullyPlaced is undefined/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, gpuActivity: true }), /gpuActivity is true/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, preferredComputeUnit: "CPU" }), /preferredComputeUnit is "CPU"/);
  assert.throws(() => validateCoreAiProbeHealth({ ...validHealth, preferredComputeUnit: "GPU" }), /preferredComputeUnit is "GPU"/);
});

test("probe parses stdout only and ignores harmless stderr warnings", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreai-test-"));
  const fakePython = path.join(tempDir, "fake_python.sh");
  const validHealth = JSON.stringify({
    gpuActivity: false,
    npuFullyPlaced: true,
    preferredComputeUnit: "Neural Engine",
    status: "ready",
  });
  fs.writeFileSync(fakePython, `#!/bin/sh\necho "WARNING: harmless framework notice" >&2\necho '${validHealth}'\n`, { mode: 0o755 });

  try {
    const probe = await probeAppleCoreAiWorker(fakePython, tempDir, { artifactRoot: "/tmp/mock-artifact" });
    assert.equal(probe.status, "ready");
    assert.equal(probe.preferredComputeUnit, "Neural Engine");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("probe fails closed with safe diagnostics on invalid stdout or failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreai-test-"));
  const failingScript = path.join(tempDir, "failing.sh");
  fs.writeFileSync(failingScript, `#!/bin/sh\necho "Traceback in /Users/secret/file.py" >&2\nexit 1\n`, { mode: 0o755 });
  const badJsonScript = path.join(tempDir, "bad_json.sh");
  fs.writeFileSync(badJsonScript, `#!/bin/sh\necho "Not JSON /tmp/foo/bar"\nexit 0\n`, { mode: 0o755 });

  try {
    await assert.rejects(
      () => probeAppleCoreAiWorker(failingScript, tempDir, { artifactRoot: "/tmp/mock-artifact" }),
      (err) => {
        assert.match(err.message, /Core AI worker probe process failed/);
        assert.doesNotMatch(err.message, /\/Users\/secret/);
        assert.match(err.message, /\[path\]/);
        return true;
      },
    );

    await assert.rejects(
      () => probeAppleCoreAiWorker(badJsonScript, tempDir, { artifactRoot: "/tmp/mock-artifact" }),
      (err) => {
        assert.match(err.message, /Invalid Core AI worker probe output/);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("buildAppleCoreAiCandidate constructs correct CLI arguments and returns JSON", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreai-test-"));
  const recorderScript = path.join(tempDir, "record.sh");
  const logFile = path.join(tempDir, "args.log");
  const validGen = `${APPLE_CORE_AI_MANIFEST.artifactVersion}-11111111-2222-3333-4444-555555555555`;
  fs.writeFileSync(recorderScript, `#!/bin/sh\necho "$@" >> "${logFile}"\necho '{"artifactDirectory": "/tmp/out", "generation": "${validGen}"}'\n`, { mode: 0o755 });

  try {
    const result = await buildAppleCoreAiCandidate(recorderScript, "/tmp/code-index", "/tmp/artifacts", validGen);
    assert.equal(result.generation, validGen);
    const logged = fs.readFileSync(logFile, "utf8").trim();
    assert.equal(logged, `/tmp/code-index/apple_coreai_artifact.py --output-root /tmp/artifacts --generation ${validGen}`);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("promoteCurrentPointerAtomic creates durable mode 0600 file and writes schema", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreai-test-"));
  const generation = `${APPLE_CORE_AI_MANIFEST.artifactVersion}-11111111-2222-3333-4444-555555555555`;
  createValidGeneration(tempDir, generation);

  try {
    promoteCurrentPointerAtomic(tempDir, generation);
    const pointerPath = path.join(tempDir, "current.json");
    assert.ok(fs.existsSync(pointerPath));
    const stat = fs.statSync(pointerPath);
    assert.equal(stat.mode & 0o777, 0o600);
    const content = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    assert.equal(content.artifactVersion, APPLE_CORE_AI_MANIFEST.artifactVersion);
    assert.equal(content.artifactDirectory, generation);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("promoteCurrentPointerAtomic pre-rename failure cleans temp and preserves old pointer", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreai-test-"));
  const generation = `${APPLE_CORE_AI_MANIFEST.artifactVersion}-11111111-2222-3333-4444-555555555555`;
  createValidGeneration(tempDir, generation);

  const currentPath = path.join(tempDir, "current.json");
  const oldContent = JSON.stringify({ artifactVersion: "old-version" });
  fs.writeFileSync(currentPath, oldContent);

  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error("EPERM: rename failed"); };

  try {
    assert.throws(
      () => promoteCurrentPointerAtomic(tempDir, generation),
      /EPERM: rename failed/,
    );
    assert.equal(fs.readFileSync(currentPath, "utf8"), oldContent);
    const tempFiles = fs.readdirSync(tempDir).filter((name) => name.startsWith("current.json."));
    assert.equal(tempFiles.length, 0);
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("promoteCurrentPointerAtomic post-rename directory-fsync failure surfaces ambiguity and retains candidate", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coreai-test-"));
  const generation = `${APPLE_CORE_AI_MANIFEST.artifactVersion}-11111111-2222-3333-4444-555555555555`;
  const genDir = createValidGeneration(tempDir, generation);

  const originalFsync = fs.fsyncSync;
  let fileFsynced = false;
  fs.fsyncSync = (fd) => {
    if (!fileFsynced) {
      fileFsynced = true;
      return originalFsync(fd);
    }
    const err = new Error("EIO: i/o error");
    err.code = "EIO";
    throw err;
  };

  try {
    assert.throws(
      () => promoteCurrentPointerAtomic(tempDir, generation),
      (err) => {
        assert.match(err.message, /Directory fsync failed after pointer rename/);
        assert.equal(err.code, "EIO");
        return true;
      },
    );
    assert.ok(fs.existsSync(genDir), "Candidate generation must be retained on directory fsync failure");
    assert.ok(fs.existsSync(path.join(tempDir, "current.json")), "Renamed pointer exists");
  } finally {
    fs.fsyncSync = originalFsync;
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("production indexing service awaits installAppleCoreAiRuntime without helper injection", () => {
  const indexingInstallerPath = path.resolve(import.meta.dirname, "install-indexing-service.js");
  const source = fs.readFileSync(indexingInstallerPath, "utf8");
  assert.match(
    source,
    /await\s+installAppleCoreAiRuntime\(\s*\{\s*agentDirectory:\s*AGENT_DIR,\s*codeIndexDirectory:\s*CODE_INDEX_DIR,\s*python:\s*findCompatiblePython\(\{\s*allowInstall:\s*true,\s*requiredMinor:\s*12\s*\}\),\s*\}\s*\)/,
  );

  const runtimeInstallerPath = path.resolve(import.meta.dirname, "install-apple-coreai.js");
  const runtimeSource = fs.readFileSync(runtimeInstallerPath, "utf8");
  assert.match(
    runtimeSource,
    /return\s+await\s+ensureAppleCoreAiArtifact\(\s*\{\s*artifactRoot,\s*codeIndexDirectory:\s*options\.codeIndexDirectory,\s*venvPython,\s*\}\s*\);/,
  );
});
