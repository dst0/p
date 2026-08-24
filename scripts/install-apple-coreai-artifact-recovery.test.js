import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { APPLE_CORE_AI_MANIFEST, ensureAppleCoreAiArtifact } from "./install-apple-coreai.js";

const READY_PROBE = Object.freeze({
  gpuActivity: false,
  npuFullyPlaced: true,
  preferredComputeUnit: "Neural Engine",
  status: "ready",
});

function writeValidMetadata(dir) {
  const meta = { artifactVersion: APPLE_CORE_AI_MANIFEST.artifactVersion, batchSize: 1, model: "Qwen/Qwen3-Embedding-0.6B", sequenceLength: 64 };
  fs.writeFileSync(path.join(dir, "artifact.json"), JSON.stringify(meta));
}

test("healthy current pointer probe reuse with no build or pointer write", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const currentJson = path.join(artifactRoot, "current.json");
  const initialContent = JSON.stringify({ artifactVersion: APPLE_CORE_AI_MANIFEST.artifactVersion }, null, 2);
  fs.writeFileSync(currentJson, initialContent);
  const initialStat = fs.statSync(currentJson);

  const calls = [];
  const buildCandidate = async () => { calls.push("build"); };
  const probeWorker = async (_py, _dir, target) => {
    calls.push({ target, type: "probe" });
    return READY_PROBE;
  };

  try {
    const result = await ensureAppleCoreAiArtifact({
      artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
    });

    assert.equal(result.artifactRoot, artifactRoot);
    assert.deepEqual(calls, [{ target: { artifactRoot }, type: "probe" }]);
    assert.equal(fs.readFileSync(currentJson, "utf8"), initialContent);
    assert.equal(fs.statSync(currentJson).mtimeMs, initialStat.mtimeMs);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("missing or failed current probe builds candidate, probes candidate, and promotes", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  const events = [];

  const buildCandidate = async (_py, _dir, root, generation) => {
    events.push({ generation, type: "build" });
    const candidateDir = path.join(root, generation);
    fs.mkdirSync(candidateDir, { recursive: true });
    writeValidMetadata(candidateDir);
  };

  const probeWorker = async (_py, _dir, target) => {
    events.push({ target, type: "probe" });
    return READY_PROBE;
  };

  try {
    const result = await ensureAppleCoreAiArtifact({
      artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
    });

    assert.equal(result.artifactRoot, artifactRoot);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "build");
    assert.equal(events[1].type, "probe");
    const candidateGen = events[0].generation;
    assert.equal(events[1].target.artifactDirectory, path.join(artifactRoot, candidateGen));

    const current = JSON.parse(fs.readFileSync(path.join(artifactRoot, "current.json"), "utf8"));
    assert.equal(current.artifactDirectory, candidateGen);
    assert.equal(current.artifactVersion, APPLE_CORE_AI_MANIFEST.artifactVersion);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("event order: current probe -> candidate build -> candidate probe -> pointer promotion", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const currentJson = path.join(artifactRoot, "current.json");
  fs.writeFileSync(currentJson, JSON.stringify({ artifactVersion: "old-version" }));

  const events = [];
  const buildCandidate = async (_py, _dir, root, generation) => {
    events.push("build");
    const candidateDir = path.join(root, generation);
    fs.mkdirSync(candidateDir, { recursive: true });
    writeValidMetadata(candidateDir);
  };
  const probeWorker = async (_py, _dir, target) => {
    if (target.artifactRoot) {
      events.push("probe-current");
      throw new Error("Current artifact invalid");
    }
    if (target.artifactDirectory) {
      events.push("probe-candidate");
      return READY_PROBE;
    }
  };

  try {
    await ensureAppleCoreAiArtifact({
      artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
    });

    assert.deepEqual(events, ["probe-current", "build", "probe-candidate"]);
    const current = JSON.parse(fs.readFileSync(currentJson, "utf8"));
    assert.equal(current.artifactVersion, APPLE_CORE_AI_MANIFEST.artifactVersion);
    assert.ok(current.artifactDirectory.startsWith(APPLE_CORE_AI_MANIFEST.artifactVersion));
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("candidate build failure leaves old pointer and generation intact without deleting candidate", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const currentJson = path.join(artifactRoot, "current.json");
  const oldContent = JSON.stringify({ artifactVersion: "old-v1" }, null, 2);
  fs.writeFileSync(currentJson, oldContent);

  const oldGenDir = path.join(artifactRoot, "old-v1");
  fs.mkdirSync(oldGenDir, { recursive: true });
  fs.writeFileSync(path.join(oldGenDir, "data.bin"), "old-bytes");

  let createdCandidateDir = null;
  const buildCandidate = async (_py, _dir, root, generation) => {
    createdCandidateDir = path.join(root, generation);
    fs.mkdirSync(createdCandidateDir, { recursive: true });
    fs.writeFileSync(path.join(createdCandidateDir, "prior.bin"), "prior-bytes");
    throw new Error("Disk full during export");
  };

  const probeWorker = async () => { throw new Error("Current probe failed"); };

  try {
    await assert.rejects(
      () => ensureAppleCoreAiArtifact({
        artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
      }),
      /Disk full during export/,
    );

    assert.equal(fs.readFileSync(currentJson, "utf8"), oldContent);
    assert.equal(fs.readFileSync(path.join(oldGenDir, "data.bin"), "utf8"), "old-bytes");
    assert.ok(createdCandidateDir && fs.existsSync(createdCandidateDir));
    assert.equal(fs.readFileSync(path.join(createdCandidateDir, "prior.bin"), "utf8"), "prior-bytes");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("candidate-probe failure never promotes and removes only its owned candidate", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const currentJson = path.join(artifactRoot, "current.json");
  const oldContent = JSON.stringify({ artifactVersion: "old-v1" }, null, 2);
  fs.writeFileSync(currentJson, oldContent);

  const oldGenDir = path.join(artifactRoot, "old-v1");
  fs.mkdirSync(oldGenDir, { recursive: true });
  fs.writeFileSync(path.join(oldGenDir, "data.bin"), "old-bytes");

  let candidateDir = null;
  const buildCandidate = async (_py, _dir, root, generation) => {
    candidateDir = path.join(root, generation);
    fs.mkdirSync(candidateDir, { recursive: true });
    writeValidMetadata(candidateDir);
  };

  const probeWorker = async (_py, _dir, target) => {
    if (target.artifactRoot) throw new Error("Current probe failed");
    if (target.artifactDirectory) throw new Error("Candidate residency check failed");
  };

  try {
    await assert.rejects(
      () => ensureAppleCoreAiArtifact({
        artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
      }),
      /Candidate residency check failed/,
    );

    assert.equal(fs.readFileSync(currentJson, "utf8"), oldContent);
    assert.equal(fs.readFileSync(path.join(oldGenDir, "data.bin"), "utf8"), "old-bytes");
    assert.ok(candidateDir && !fs.existsSync(candidateDir));
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("pointer promotion failure retains candidate without deleting either generation", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const currentJson = path.join(artifactRoot, "current.json");
  const oldContent = JSON.stringify({ artifactVersion: "old-v1" }, null, 2);
  fs.writeFileSync(currentJson, oldContent);

  let candidateDir = null;
  const buildCandidate = async (_py, _dir, root, generation) => {
    candidateDir = path.join(root, generation);
    fs.mkdirSync(candidateDir, { recursive: true });
    writeValidMetadata(candidateDir);
  };

  const probeWorker = async (_py, _dir, target) => {
    if (target.artifactRoot) throw new Error("Current probe failed");
    return READY_PROBE;
  };

  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error("EPERM: rename failed"); };

  try {
    await assert.rejects(
      () => ensureAppleCoreAiArtifact({
        artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
      }),
      /EPERM: rename failed/,
    );

    assert.equal(fs.readFileSync(currentJson, "utf8"), oldContent);
    assert.ok(candidateDir && fs.existsSync(candidateDir));
    assert.ok(fs.existsSync(path.join(candidateDir, "artifact.json")));
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("concurrent interleaved ensures end on an existing successfully probed generation", async () => {
  const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coreai-recovery-"));
  const artifactRoot = path.join(tempDir, "indexing-service", "apple-coreai");
  const probedGenerations = new Set();

  const buildCandidate = async (_py, _dir, root, generation) => {
    const genDir = path.join(root, generation);
    fs.mkdirSync(genDir, { recursive: true });
    writeValidMetadata(genDir);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  const probeWorker = async (_py, _dir, target) => {
    if (target.artifactRoot) throw new Error("No current pointer");
    if (target.artifactDirectory) {
      probedGenerations.add(path.basename(target.artifactDirectory));
      return READY_PROBE;
    }
  };

  try {
    const [resA, resB] = await Promise.all([
      ensureAppleCoreAiArtifact({
        artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
      }),
      ensureAppleCoreAiArtifact({
        artifactRoot, buildCandidate, codeIndexDirectory: "/tmp/mock-code-index", probeWorker, venvPython: "/tmp/mock-python",
      }),
    ]);

    assert.equal(resA.artifactRoot, artifactRoot);
    assert.equal(resB.artifactRoot, artifactRoot);

    const current = JSON.parse(fs.readFileSync(path.join(artifactRoot, "current.json"), "utf8"));
    assert.ok(probedGenerations.has(current.artifactDirectory), "Final pointer must name a probed generation");
    assert.ok(fs.existsSync(path.join(artifactRoot, current.artifactDirectory)), "Named generation must exist on disk");
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
