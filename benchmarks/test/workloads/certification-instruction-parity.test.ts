import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAugmentedProjectInstructions,
  evaluateInstructionParityReceipts,
  runCertifiedPreflights,
  verifyWorkspaceInstructions,
} from "../../src/workloads/certification-preflight.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

function createHonestMockAgent(scriptPath: string): void {
  const code = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
let dir = process.cwd();
const dirIdx = args.indexOf("--dir");
if (dirIdx !== -1 && args[dirIdx + 1]) dir = args[dirIdx + 1];
const agentsPath = path.join(dir, "AGENTS.md");

let receipt = "";
if (fs.existsSync(agentsPath)) {
  const content = fs.readFileSync(agentsPath, "utf8");
  receipt = [...content.matchAll(/certified-parity-(?:head|middle|tail)-[a-f0-9]{32}/g)]
    .map((match) => match[0])
    .join("|");
}

// Verify argv never contains the receipt token
for (const arg of args) {
  if (arg.includes("certified-parity-")) {
    process.stderr.write("LEAK_DETECTED: receipt leaked in argv\\n");
    process.exit(1);
  }
}

if (args[0] === "run") {
  process.stdout.write(JSON.stringify({
    type: "step_finish",
    part: {
      type: "step-finish",
      model: "mock/test-model",
      tokens: { input: 10, output: 10, total: 20 },
    },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "text",
    part: { type: "text", text: receipt },
  }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({
    type: "message_start",
    message: { role: "assistant" },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "message_update",
    message: { content: [{ type: "text", text: receipt }] },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: receipt }],
      responseModel: "mock/test-model",
    },
  }) + "\\n");
}
`;
  writeFileSync(scriptPath, code, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
}

function createArgvEchoingMockAgent(scriptPath: string): void {
  const code = `#!/usr/bin/env node
const args = process.argv.slice(2);
const found = args.find((a) => a.includes("certified-parity-"));
const text = found ? "Found: " + found : "no receipt found";
if (args[0] === "run") {
  process.stdout.write(JSON.stringify({ type: "step_finish", part: { type: "step-finish", model: "mock/test-model", tokens: { input: 10, output: 10, total: 20 } } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text } }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "assistant" } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "message_update", message: { content: [{ type: "text", text }] } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], responseModel: "mock/test-model" } }) + "\\n");
}
`;
  writeFileSync(scriptPath, code, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
}

test("workspace instruction verification detects missing, symlink escape, and tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "instruction-verify-test-"));
  try {
    const ws = join(root, "workspace");
    mkdirSync(ws, { recursive: true });

    // Missing file fails
    assert.throws(() => verifyWorkspaceInstructions(ws, "a".repeat(64)), /Missing AGENTS.md/u);

    // Symlink fails closed
    const outsideFile = join(root, "outside.md");
    writeFileSync(outsideFile, "outside content\n");
    symlinkSync(outsideFile, join(ws, "AGENTS.md"));
    assert.throws(() => verifyWorkspaceInstructions(ws, "a".repeat(64)), /must not be a symbolic link/u);
    rmSync(join(ws, "AGENTS.md"));

    // Hash mismatch fails closed
    writeFileSync(join(ws, "AGENTS.md"), "tampered content\n");
    assert.throws(() => verifyWorkspaceInstructions(ws, "a".repeat(64)), /hash mismatch/u);

    // Valid file succeeds
    const sourceFile = join(root, "source.md");
    writeFileSync(sourceFile, "# Instructions\nRule 1\n");
    const augmented = createAugmentedProjectInstructions(sourceFile, root, "parity-receipt-fixed-nonce-12345");
    writeFileSync(join(ws, "AGENTS.md"), augmented.receiptValue);
    assert.throws(() => verifyWorkspaceInstructions(ws, augmented.augmentedSha256), /hash mismatch/u);
    writeFileSync(join(ws, "AGENTS.md"), readFileSync(augmented.augmentedPath));
    assert.doesNotThrow(() => verifyWorkspaceInstructions(ws, augmented.augmentedSha256));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all three preflights receive only the question while runtime auto-loading supplies all challenge parts", async () => {
  const root = mkdtempSync(join(tmpdir(), "preflight-test-"));
  try {
    const mockCli = join(root, "mock-agent.js");
    createHonestMockAgent(mockCli);

    const sourceInstructions = join(root, "source-AGENTS.md");
    writeFileSync(sourceInstructions, "# Project Instructions\nAlways be concise.\n");

    const augmented = createAugmentedProjectInstructions(sourceInstructions, root, "parity-receipt-test-token-abcdef");

    const runnerOpts = parseRunnerArgs([
      "--certified",
      "--model",
      "mock/test-model",
      "--expected-resolved-model",
      "mock/test-model",
      "--runs",
      "3",
      "--p-cli",
      mockCli,
      "--pi-executable",
      mockCli,
      "--kilo-executable",
      mockCli,
      "--project-instructions-file",
      augmented.augmentedPath,
    ]);

    const mockBinding = {
      node: { path: process.execPath, version: process.version, sha256: "a".repeat(64) },
      pSnapshot: { path: root, version: "0.4.0", sha256: "b".repeat(64) },
      pi: { path: mockCli, version: "1.0.0", sha256: "c".repeat(64) },
      kilo: { path: mockCli, version: "1.0.0", sha256: "d".repeat(64) },
      projectInstructions: {
        path: augmented.augmentedPath,
        sha256: augmented.augmentedSha256,
        receiptSha256: augmented.receiptSha256,
      },
    };

    const agentDirs = {
      p: join(root, "config", "p"),
      pi: join(root, "config", "pi"),
      kilo: join(root, "config", "kilo"),
    };

    const receipts = await runCertifiedPreflights(
      runnerOpts,
      agentDirs,
      root,
      performance.now() + 30_000,
      augmented.receiptValue,
      mockBinding,
    );

    assert.equal(receipts.length, 3);
    for (const receipt of receipts) {
      assert.equal(receipt.status, "passed", `Agent ${receipt.agent} failed: ${receipt.error}`);
      assert.equal(receipt.responseMatched, true);
      assert.equal(receipt.receiptSha256, augmented.receiptSha256);
      assert.equal(receipt.responseModel, "mock/test-model");
      assert.deepEqual(receipt.responseModels, ["mock/test-model"]);
    }

    const failures = evaluateInstructionParityReceipts(
      { ...mockBinding, receipts },
      ["p", "pi", "kilo"],
      "mock/test-model",
    );
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fake agent echoing argv fails because receipt value is never passed in argv", async () => {
  const root = mkdtempSync(join(tmpdir(), "cheater-agent-test-"));
  try {
    const mockCli = join(root, "cheater-agent.js");
    createArgvEchoingMockAgent(mockCli);

    const sourceInstructions = join(root, "source-AGENTS.md");
    writeFileSync(sourceInstructions, "# Project Instructions\nAlways be concise.\n");

    const augmented = createAugmentedProjectInstructions(sourceInstructions, root, "parity-receipt-cheater-nonce");

    const runnerOpts = parseRunnerArgs([
      "--certified",
      "--runs",
      "3",
      "--model",
      "mock/test-model",
      "--expected-resolved-model",
      "mock/test-model",
      "--p-cli",
      mockCli,
      "--pi-executable",
      mockCli,
      "--kilo-executable",
      mockCli,
      "--project-instructions-file",
      augmented.augmentedPath,
    ]);

    const mockBinding = {
      node: { path: process.execPath, version: process.version, sha256: "a".repeat(64) },
      pSnapshot: { path: root, version: "0.4.0", sha256: "b".repeat(64) },
      pi: { path: mockCli, version: "1.0.0", sha256: "c".repeat(64) },
      kilo: { path: mockCli, version: "1.0.0", sha256: "d".repeat(64) },
      projectInstructions: {
        path: augmented.augmentedPath,
        sha256: augmented.augmentedSha256,
        receiptSha256: augmented.receiptSha256,
      },
    };

    const agentDirs = {
      p: join(root, "config", "p"),
      pi: join(root, "config", "pi"),
      kilo: join(root, "config", "kilo"),
    };

    const receipts = await runCertifiedPreflights(
      runnerOpts,
      agentDirs,
      root,
      performance.now() + 30_000,
      augmented.receiptValue,
      mockBinding,
    );

    assert.equal(receipts.length, 3);
    for (const receipt of receipts) {
      assert.equal(receipt.status, "failed");
      assert.equal(receipt.responseMatched, false);
      assert.match(receipt.error ?? "", /Response did not contain the expected receipt value/u);
    }

    const failures = evaluateInstructionParityReceipts(
      { ...mockBinding, receipts },
      ["p", "pi", "kilo"],
      "mock/test-model",
    );
    assert.equal(failures.length, 3);
    for (const f of failures) {
      assert.match(f, /Instruction parity preflight failed for agent/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
