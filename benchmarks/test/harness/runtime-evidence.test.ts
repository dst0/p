import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  copyKiloRuntimeEvidence,
  listKiloRuntimeDataEvidence,
  listKiloRuntimeStateEvidence,
} from "../../src/harness/runtime-evidence.ts";

test("copies sandbox policy without archiving volatile Kilo lock credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-evidence-"));
  try {
    const data = join(root, "data");
    const state = join(root, "state");
    const destination = join(root, "evidence");
    const log = join(data, "kilo", "log", "runtime.log");
    const privateSession = join(data, "kilo", "storage", "session", "private-id.json");
    const policy = join(state, "kilo-sandbox-policy", "policy", "rule.json");
    const lock = join(state, "kilo", "locks", "active.lock", "meta.json");
    mkdirSync(join(log, ".."), { recursive: true });
    mkdirSync(join(privateSession, ".."), { recursive: true });
    mkdirSync(join(policy, ".."), { recursive: true });
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(log, "useful runtime diagnostic\n");
    writeFileSync(privateSession, '{"session":"must-not-be-inventoried"}\n');
    writeFileSync(policy, '{"mode":"deny"}\n');
    writeFileSync(lock, '{"token":"ephemeral-secret","hostname":"private-host"}\n');

    copyKiloRuntimeEvidence(data, state, destination);

    assert.equal(readFileSync(join(destination, "runtime-logs", "runtime.log"), "utf8"), "useful runtime diagnostic\n");
    assert.equal(
      readFileSync(join(destination, "runtime-state", "kilo-sandbox-policy", "policy", "rule.json"), "utf8"),
      '{"mode":"deny"}\n',
    );
    assert.equal(existsSync(join(destination, "runtime-state", "kilo")), false);
    assert.deepEqual(listKiloRuntimeStateEvidence(state), ["kilo-sandbox-policy/policy/rule.json"]);
    assert.deepEqual(listKiloRuntimeDataEvidence(data), ["kilo/log/runtime.log"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
