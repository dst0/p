import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { migrateLegacyIndexingConfig, readCodeRagConfig, writeCodeRagConfig } from "./indexing-config.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true });
});

function createAgentDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

test("writes private config atomically and preserves unrelated fields", () => {
  const agentDirectory = createAgentDirectory();
  writeCodeRagConfig(agentDirectory, { embeddingDevice: "cpu", maxEmbeddingBatchSize: 8 });
  writeCodeRagConfig(agentDirectory, { embeddingDevice: "ryzenai", maxEmbeddingBatchSize: undefined });

  assert.deepEqual(readCodeRagConfig(agentDirectory), { embeddingDevice: "ryzenai" });
  assert.equal(fs.statSync(path.join(agentDirectory, "code-rag.json")).mode & 0o777, 0o600);
});

test("migrates legacy device and batch files once", () => {
  const agentDirectory = createAgentDirectory();
  fs.writeFileSync(path.join(agentDirectory, "indexing-device.txt"), "mps\n");
  fs.writeFileSync(path.join(agentDirectory, "indexing-max-batch-size"), "12\n");

  assert.deepEqual(migrateLegacyIndexingConfig(agentDirectory), {
    embeddingDevice: "mps",
    maxEmbeddingBatchSize: 12,
  });
  assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-device.txt")), false);
  assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-max-batch-size")), false);
  assert.deepEqual(readCodeRagConfig(agentDirectory), { embeddingDevice: "mps", maxEmbeddingBatchSize: 12 });
});

test("supports the extensionless legacy device filename", () => {
  const agentDirectory = createAgentDirectory();
  fs.writeFileSync(path.join(agentDirectory, "indexing-device"), "cpu\n");

  assert.deepEqual(migrateLegacyIndexingConfig(agentDirectory), { embeddingDevice: "cpu" });
  assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-device")), false);
});

test("existing config wins over legacy files", () => {
  const agentDirectory = createAgentDirectory();
  writeCodeRagConfig(agentDirectory, { embeddingDevice: "cpu", maxEmbeddingBatchSize: 4 });
  fs.writeFileSync(path.join(agentDirectory, "indexing-device.txt"), "mps\n");
  fs.writeFileSync(path.join(agentDirectory, "indexing-device"), "npu\n");
  fs.writeFileSync(path.join(agentDirectory, "indexing-max-batch-size"), "64\n");

  assert.deepEqual(migrateLegacyIndexingConfig(agentDirectory), {
    embeddingDevice: "cpu",
    maxEmbeddingBatchSize: 4,
  });
  assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-device.txt")), false);
  assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-device")), false);
});

test("supports enableTray boolean field", () => {
  const agentDirectory = createAgentDirectory();
  writeCodeRagConfig(agentDirectory, { enableTray: true });
  assert.equal(readCodeRagConfig(agentDirectory).enableTray, true);

  writeCodeRagConfig(agentDirectory, { enableTray: false });
  assert.equal(readCodeRagConfig(agentDirectory).enableTray, false);
});

test("rejects non-object configuration", () => {
  const agentDirectory = createAgentDirectory();
  fs.writeFileSync(path.join(agentDirectory, "code-rag.json"), "[]\n");
  assert.throws(() => readCodeRagConfig(agentDirectory), /expected a JSON object/);
});

