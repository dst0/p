import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createBenchmarkAgentDirectories } from "../../src/agents/private-directories.ts";

describe("benchmark budget choice", () => {
  it("explicitly authorizes Unlimited in the private P profile without touching user settings", () => {
    const parent = mkdtempSync(join(tmpdir(), "p-benchmark-budget-test-"));
    try {
      const directories = createBenchmarkAgentDirectories({ authFile: join(parent, "absent-auth.json") }, parent);
      try {
        assert.deepEqual(JSON.parse(readFileSync(join(directories.dirs.p, "settings.json"), "utf8")), {
          runBudget: { mode: "unlimited" },
        });
      } finally {
        directories.dispose();
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
