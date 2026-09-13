import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAugmentedProjectInstructions,
  runCertifiedPreflights,
} from "../../src/workloads/certification-preflight.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test("augmented instructions require independent head, middle, and tail material", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-three-part-instructions-"));
  try {
    const source = join(root, "source.md");
    writeFileSync(source, `BEGIN\n${"middle source\n".repeat(20)}END\n`);
    const augmented = createAugmentedProjectInstructions(source, root);
    const text = readFileSync(augmented.augmentedPath, "utf8");
    const matches = [...text.matchAll(/certified-parity-(head|middle|tail)-[a-f0-9]{32}/gu)];
    assert.deepEqual(
      matches.map((match) => match[1]),
      ["head", "middle", "tail"],
    );
    assert.equal(new Set(matches.map((match) => match[0])).size, 3);
    assert.equal(augmented.receiptValue, matches.map((match) => match[0]).join("|"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight rejects a matching answer produced with a user-visible file tool", async () => {
  const root = mkdtempSync(join(tmpdir(), "certified-visible-read-"));
  const cli = join(root, "mock-agent.js");
  try {
    const source = join(root, "source.md");
    writeFileSync(source, "Project rules\n");
    const augmented = createAugmentedProjectInstructions(source, root);
    writeFileSync(
      cli,
      `#!/usr/bin/env node
const fs = require("node:fs");
const text = fs.readFileSync("AGENTS.md", "utf8");
const receipt = [...text.matchAll(/certified-parity-(?:head|middle|tail)-[a-f0-9]{32}/g)].map((m) => m[0]).join("|");
const kilo = process.argv.includes("run");
if (kilo) {
  process.stdout.write(JSON.stringify({type:"tool_use",part:{type:"tool",id:"read-1",tool:"read",state:{status:"completed"}}})+"\\n");
  process.stdout.write(JSON.stringify({type:"step_finish",part:{type:"step-finish",model:"backend/model",tokens:{input:1,output:1,total:2}}})+"\\n");
  process.stdout.write(JSON.stringify({type:"text",part:{type:"text",text:receipt}})+"\\n");
} else {
  process.stdout.write(JSON.stringify({type:"tool_execution_start",toolCallId:"read-1",toolName:"read",args:{}})+"\\n");
  process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:receipt}],responseModel:"backend/model",usage:{input:1,output:1,totalTokens:2,cost:{total:0}}}})+"\\n");
}
`,
      { mode: 0o755 },
    );
    chmodSync(cli, 0o755);
    const options = parseRunnerArgs([
      "--certified",
      "--model",
      "backend/model",
      "--expected-resolved-model",
      "backend/model",
      "--runs",
      "3",
      "--p-cli",
      cli,
      "--pi-executable",
      cli,
      "--kilo-executable",
      cli,
    ]);
    const binding = {
      node: { path: process.execPath, version: process.version, sha256: "a".repeat(64) },
      pSnapshot: { path: root, version: "1", sha256: "b".repeat(64) },
      pi: { path: cli, version: "1", sha256: "c".repeat(64) },
      kilo: { path: cli, version: "1", sha256: "d".repeat(64) },
      projectInstructions: {
        path: augmented.augmentedPath,
        sha256: augmented.augmentedSha256,
        receiptSha256: augmented.receiptSha256,
      },
    };
    const dirs = { p: join(root, "p"), pi: join(root, "pi"), kilo: join(root, "kilo") };
    const receipts = await runCertifiedPreflights(
      options,
      dirs,
      root,
      performance.now() + 30_000,
      augmented.receiptValue,
      binding,
    );
    assert.equal(
      receipts.every((receipt) => receipt.status === "failed"),
      true,
    );
    assert.equal(
      receipts.every((receipt) => /tool/iu.test(receipt.error ?? "")),
      true,
      JSON.stringify(receipts),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
