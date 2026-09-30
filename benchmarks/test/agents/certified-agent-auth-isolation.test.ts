import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBenchmarkAgentDirectories } from "../../src/agents/private-directories.ts";

test("certified agent directories do not copy user auth credentials into candidate sandboxes", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-agent-auth-"));
  const auth = join(root, "auth.json");
  const parent = join(root, "private");
  mkdirSync(parent);
  writeFileSync(auth, '{"mini-pc":{"type":"api_key","key":"private-canary"}}\n', { mode: 0o600 });
  const dirs = createBenchmarkAgentDirectories({ authFile: auth, certified: true }, parent);
  try {
    for (const agent of ["p", "pi"] as const) {
      const candidateAuth = join(dirs.dirs[agent], "auth.json");
      assert.deepEqual(JSON.parse(readFileSync(candidateAuth, "utf8")), {});
      assert.equal(statSync(candidateAuth).mode & 0o777, 0o600);
    }
    assert.match(readFileSync(auth, "utf8"), /private-canary/u, "The user source must remain untouched");
  } finally {
    dirs.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
