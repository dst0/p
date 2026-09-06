import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const workspaces: string[] = [];

afterEach(() => {
  for (const cwd of workspaces.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe("Node command readiness evidence", () => {
  it.each(["--import", "--require"])("accepts a real passing Node test with %s before --test", async (preload) => {
    const harness = await createWorkspace("Create result.txt and run its tests.");
    await mutateResult(harness, "requested result\n");
    await runNodeTests(harness, preload);

    expect(await ready(harness)).toContain("verification_token:");
    expect(harness.controller.completionGate("finish successfully")).toBeUndefined();
  });

  it("invalidates preloaded test evidence after a new mutation and accepts only a fresh rerun", async () => {
    const harness = await createWorkspace("Create result.txt and run its tests.");
    await mutateResult(harness, "requested result\n");
    await runNodeTests(harness, "--import");
    expect(await ready(harness)).toContain("verification_token:");

    await mutateResult(harness, "requested result\n\n");
    expect(await ready(harness)).not.toContain("verification_token:");
    expect(harness.controller.completionGate("finish successfully")?.block).toBe(true);
    await runNodeTests(harness, "--import");
    expect(await ready(harness)).toContain("verification_token:");
  });

  it("does not accept quoted test command text as proof that tests executed", async () => {
    const harness = await createWorkspace("Create result.txt and run its tests.");
    await mutateResult(harness, "requested result\n");
    await afterEvidenceTool(
      harness.agent,
      "bash",
      { command: "printf 'node --test test/behavior.test.js\\nℹ pass 1\\nℹ fail 0\\n'" },
      "node --test test/behavior.test.js\nℹ pass 1\nℹ fail 0\n",
    );

    expect(await ready(harness)).toContain("no successful current-revision test evidence");
    expect(harness.controller.completionGate("finish successfully")?.block).toBe(true);
  });

  it("accepts the local TypeScript executable after a real successful typecheck", async () => {
    const harness = await createWorkspace("Create result.txt and run typecheck.");
    symlinkSync(join(import.meta.dirname, "../../../node_modules"), join(harness.cwd, "node_modules"));
    writeFileSync(join(harness.cwd, "index.ts"), "export const value: string = 'requested result';\n");
    writeFileSync(
      join(harness.cwd, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true, types: [] }, files: ["index.ts"] }),
    );
    await mutateResult(harness, "requested result\n");
    const output = execFileSync(join(harness.cwd, "node_modules/.bin/tsc"), ["--noEmit"], {
      cwd: harness.cwd,
      encoding: "utf8",
      timeout: 30_000,
    });
    await afterEvidenceTool(harness.agent, "bash", { command: "node_modules/.bin/tsc --noEmit" }, output);

    expect(await ready(harness)).toContain("verification_token:");
  });
});

async function createWorkspace(prompt: string) {
  const cwd = mkdtempSync(join(tmpdir(), "p-node-readiness-"));
  workspaces.push(cwd);
  mkdirSync(join(cwd, "test"));
  writeFileSync(join(cwd, "package.json"), '{"type":"commonjs"}\n');
  writeFileSync(join(cwd, "preload.js"), 'process.env.P_READINESS_PRELOAD = "enabled";\n');
  writeFileSync(
    join(cwd, "test/behavior.test.js"),
    [
      'const test = require("node:test");',
      'const assert = require("node:assert/strict");',
      'const { readFileSync } = require("node:fs");',
      'test("the requested result is present and the preload ran", () => {',
      '  assert.equal(process.env.P_READINESS_PRELOAD, "enabled");',
      '  assert.equal(readFileSync("result.txt", "utf8").trim(), "requested result");',
      "});",
    ].join("\n"),
  );
  const harness = { ...createEvidenceHarness(cwd), cwd };
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content: prompt, timestamp: Date.now() } });
  expect(
    await callEvidenceVerification(harness.controller, {
      action: "record_completion_checklist",
      completion_checklist: ["result.txt contains the requested result line"],
    }),
  ).toContain("Completion checklist recorded");
  return harness;
}

async function mutateResult(harness: Awaited<ReturnType<typeof createWorkspace>>, content: string) {
  const args = { path: "result.txt", content };
  const call = evidenceToolCall("write", args);
  expect(await beforeEvidenceTool(harness.agent, "write", args, call)).toBeUndefined();
  writeFileSync(join(harness.cwd, args.path), content);
  await afterEvidenceTool(harness.agent, "write", args, "wrote result.txt", call);
}

async function runNodeTests(harness: Awaited<ReturnType<typeof createWorkspace>>, preload: string) {
  const args = [preload, "./preload.js", "--test", "test/behavior.test.js"];
  const output = execFileSync(process.execPath, args, { cwd: harness.cwd, encoding: "utf8", timeout: 30_000 });
  await afterEvidenceTool(harness.agent, "bash", { command: `node ${args.join(" ")}` }, output);
}

async function ready(harness: Awaited<ReturnType<typeof createWorkspace>>) {
  return callEvidenceVerification(harness.controller, { action: "ready_to_finish", unresolved_failures: [] });
}
