import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { benchmarkSandboxExecutable } from "../../src/harness/benchmark-isolation.ts";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import {
  createAugmentedProjectInstructions,
  evaluateInstructionParityReceipts,
  runCertifiedPreflights,
} from "../../src/workloads/certification-preflight.ts";
import { publishBenchmarkResults } from "../../src/workloads/result-publication.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const hash = (character: string): string => character.repeat(64);

function bindingWithReceipts(receipts: unknown[]) {
  return {
    node: { path: "/node", version: "v22", sha256: hash("a") },
    pSnapshot: { path: "/runtime", version: "1", sha256: hash("b") },
    pi: { path: "/pi", version: "1", sha256: hash("c") },
    kilo: { path: "/kilo", version: "1", sha256: hash("d") },
    projectInstructions: { path: "/AGENTS.md", sha256: hash("e") },
    receipts,
  };
}

function validReceipt(agent: "p" | "pi" | "kilo", character: string) {
  return {
    agent,
    status: "passed" as const,
    receiptSha256: hash(character),
    responseMatched: true,
    responseModel: "resolved/model",
    responseModels: ["resolved/model"],
    elapsedMs: 10,
  };
}

test("certified advertised arguments auto-create proof authority and reject P-only thinking", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "provider/model",
    "--expected-resolved-model",
    "resolved/model",
    "--runs",
    "3",
  ]);
  assert.match(options.projectInstructionProofReceipt ?? "", /^[a-f0-9]{64}$/u);
  assert.throws(
    () =>
      parseRunnerArgs([
        "--certified",
        "--model",
        "provider/model",
        "--expected-resolved-model",
        "resolved/model",
        "--runs",
        "3",
        "--thinking",
        "high",
      ]),
    /thinking.*certified|certified.*thinking/iu,
  );
});

test("certified mode permits distinct aliases because resolved backend identity is runtime-verified", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "pi-provider/model-alias",
    "--kilo-model",
    "kilo-provider/model-alias",
    "--expected-resolved-model",
    "shared/backend-model",
    "--runs",
    "3",
  ]);
  assert.equal(options.model, "pi-provider/model-alias");
  assert.equal(options.kiloModel, "kilo-provider/model-alias");
});

test("receipt evaluation rejects duplicate, unexpected, malformed, model-less, and nonfinite evidence", () => {
  const valid = [validReceipt("p", "1"), validReceipt("pi", "2"), validReceipt("kilo", "3")];
  const cases = [
    [...valid, validReceipt("p", "4")],
    [...valid, { ...validReceipt("p", "4"), agent: "codex" }],
    [{ ...valid[0], receiptSha256: "not-a-hash" }, valid[1], valid[2]],
    [{ ...valid[0], responseModel: undefined }, valid[1], valid[2]],
    [{ ...valid[0], responseModels: ["wrong/model", "resolved/model"] }, valid[1], valid[2]],
    [{ ...valid[0], elapsedMs: Number.NaN }, valid[1], valid[2]],
  ];
  for (const receipts of cases) {
    const failures = evaluateInstructionParityReceipts(
      bindingWithReceipts(receipts) as Parameters<typeof evaluateInstructionParityReceipts>[0],
      ["p", "pi", "kilo"],
      "resolved/model",
    );
    assert.ok(failures.length > 0, JSON.stringify(receipts));
  }
});

test("certified multi-cell publication writes results without single-cell outer authority", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-publication-"));
  try {
    const path = join(root, "results.json");
    bindCertifiedOutputRoot(root);
    const authority = publishBenchmarkResults(path, { results: [{ run: 1 }, { run: 2 }] }, true, "compiled");
    assert.equal(authority, undefined);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).results.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ephemeral preflight workspaces are deleted and Brotli recordings are redacted", async () => {
  const root = mkdtempSync(join(tmpdir(), "ephemeral-preflight-test-"));
  try {
    const mockCli = join(root, "honest-agent.js");
    const mockCode = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
let dir = process.cwd();
const dirIdx = args.indexOf("--dir");
if (dirIdx !== -1 && args[dirIdx + 1]) dir = args[dirIdx + 1];
const agentsPath = path.join(dir, "AGENTS.md");
let receipt = "";
if (fs.existsSync(agentsPath)) {
  receipt = [...fs.readFileSync(agentsPath, "utf8").matchAll(/certified-parity-(?:head|middle|tail)-[a-f0-9]{32}/g)].map((match) => match[0]).join("|");
}
if (args.includes("run")) {
  process.stdout.write(JSON.stringify({ type: "step_finish", part: { type: "step-finish", model: "mock/model", tokens: { input: 1, output: 1, total: 2 } } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: receipt } }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "assistant" } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "message_update", message: { content: [{ type: "text", text: receipt }] } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: receipt }], responseModel: "mock/model" } }) + "\\n");
}
`;
    writeFileSync(mockCli, mockCode, { mode: 0o755 });
    chmodSync(mockCli, 0o755);

    const source = join(root, "source.md");
    writeFileSync(source, "# Instructions\n");
    const augmented = createAugmentedProjectInstructions(source, root, "parity-receipt-secret-999");
    const opts = parseRunnerArgs([
      "--certified",
      "--runs",
      "3",
      "--model",
      "mock/model",
      "--expected-resolved-model",
      "mock/model",
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
    const agentDirs = { p: join(root, "c", "p"), pi: join(root, "c", "pi"), kilo: join(root, "c", "kilo") };
    const receipts = await runCertifiedPreflights(
      opts,
      agentDirs,
      root,
      performance.now() + 30_000,
      augmented.receiptValue,
      mockBinding,
    );

    assert.equal(receipts.length, 3);
    for (const r of receipts) assert.equal(r.status, "passed");

    for (const agent of ["p", "pi", "kilo"]) {
      assert.equal(existsSync(join(root, "preflight", agent)), false);
      const rec = join(root, "recordings", `${agent}-preflight.log.br`);
      assert.equal(existsSync(rec), true);
      const text = brotliDecompressSync(readFileSync(rec)).toString("utf8");
      assert.equal(text.includes(augmented.receiptValue), false);
      assert.ok(text.includes("<REDACTED_PARITY_RECEIPT>"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "sandboxed certified preflight blocks malicious attempts to read external files",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sandboxed-preflight-test-")));
    try {
      const outside = join(root, "outside");
      mkdirSync(outside, { recursive: true });
      const outsideFile = join(outside, "outside-secret.txt");
      writeFileSync(outsideFile, "LEAKED_SECRET_CONTENT");

      const runtime = join(root, "candidate-runtime");
      mkdirSync(runtime, { recursive: true });

      const mockCli = join(root, "malicious-agent.js");
      const mockCode = `#!/usr/bin/env node
const fs = require("node:fs");
let leak = "";
try {
  leak = fs.readFileSync(${JSON.stringify(outsideFile)}, "utf8");
} catch {
  leak = "ACCESS_DENIED";
}
process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "assistant" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_update", message: { content: [{ type: "text", text: leak }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: leak }], responseModel: "mock/model" } }) + "\\n");
`;
      writeFileSync(mockCli, mockCode, { mode: 0o755 });
      chmodSync(mockCli, 0o755);

      const source = join(root, "source.md");
      writeFileSync(source, "# Instructions\n");
      const augmented = createAugmentedProjectInstructions(source, root, "parity-receipt-secret-sandbox");
      const opts = parseRunnerArgs([
        "--certified",
        "--runs",
        "3",
        "--model",
        "mock/model",
        "--expected-resolved-model",
        "mock/model",
        "--p-cli",
        mockCli,
        "--pi-executable",
        mockCli,
        "--kilo-executable",
        mockCli,
        "--project-instructions-file",
        augmented.augmentedPath,
      ]);
      opts.candidateRuntimePath = runtime;

      const mockBinding = {
        node: { path: process.execPath, version: process.version, sha256: "a".repeat(64) },
        pSnapshot: { path: runtime, version: "0.4.0", sha256: "b".repeat(64) },
        pi: { path: mockCli, version: "1.0.0", sha256: "c".repeat(64) },
        kilo: { path: mockCli, version: "1.0.0", sha256: "d".repeat(64) },
        projectInstructions: {
          path: augmented.augmentedPath,
          sha256: augmented.augmentedSha256,
          receiptSha256: augmented.receiptSha256,
        },
      };
      const agentDirs = { p: join(root, "c", "p"), pi: join(root, "c", "pi"), kilo: join(root, "c", "kilo") };
      await runCertifiedPreflights(
        opts,
        agentDirs,
        root,
        performance.now() + 30_000,
        augmented.receiptValue,
        mockBinding,
      );

      for (const agent of ["p", "pi"]) {
        const rec = join(root, "recordings", `${agent}-preflight.log.br`);
        const text = brotliDecompressSync(readFileSync(rec)).toString("utf8");
        assert.equal(text.includes("LEAKED_SECRET_CONTENT"), false);
        assert.ok(text.includes("ACCESS_DENIED"));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
