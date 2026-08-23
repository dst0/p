import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProjectInstructionOuterAuthorityCapture,
  createProjectInstructionOuterAuthorityEnvelope,
} from "./benchmark-project-instruction-outer-authority.js";
import { runBenchmarkChild } from "./benchmark-project-instructions-liveness.js";

test("nested turn IPC cannot expose the runner outer channel to model descendants", async () => {
  const receipt = "a".repeat(64);
  const authority = { expectedTurnCount: 1, baseSystemModeProofs: [{}], userTurns: [{}] };
  const envelope = createProjectInstructionOuterAuthorityEnvelope(receipt, authority, "b".repeat(64));
  const nestedSource = `
    const { spawnSync } = require("node:child_process");
    process.send({ kind: "turn-proof" }, () => {
      process.disconnect();
      const descendant = spawnSync(process.execPath, ["-e", "process.stdout.write(String(typeof process.send))"], { encoding: "utf8" });
      process.stdout.write(descendant.stdout);
    });
  `;
  const runnerSource = `
    const { spawn } = require("node:child_process");
    const nested = spawn(process.execPath, ["-e", ${JSON.stringify(nestedSource)}], { stdio: ["ignore", "pipe", "ignore", "ipc"] });
    let nestedMessage;
    let nestedOutput = "";
    nested.on("message", (message) => { nestedMessage = message; });
    nested.stdout.on("data", (chunk) => { nestedOutput += chunk; });
    nested.on("close", (code) => {
      if (code !== 0 || nestedMessage?.kind !== "turn-proof" || nestedOutput !== "undefined") process.exit(2);
      process.send(${JSON.stringify(envelope)}, () => process.disconnect());
    });
  `;
  const capture = createProjectInstructionOuterAuthorityCapture(receipt);
  const result = await runBenchmarkChild(
    process.execPath,
    ["-e", runnerSource],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    capture,
  );
  assert.equal(result.status, 0);
  assert.deepEqual(result.projectInstructionAuthority, envelope.authority);
});
