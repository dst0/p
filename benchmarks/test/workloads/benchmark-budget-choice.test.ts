import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createBenchmarkAgentDirectories } from "../../src/agents/private-directories.ts";

describe("benchmark budget choice", () => {
  it("gives P and Pi identical model bytes and explicit Unlimited private profiles", () => {
    const parent = mkdtempSync(join(tmpdir(), "p-benchmark-budget-test-"));
    try {
      const modelsFile = join(parent, "models.json");
      writeFileSync(modelsFile, '{"providers":{"fixture":true}}\n');
      const directories = createBenchmarkAgentDirectories(
        { authFile: join(parent, "absent-auth.json"), modelsFile },
        parent,
      );
      try {
        for (const agent of ["p", "pi"]) {
          assert.deepEqual(JSON.parse(readFileSync(join(directories.dirs[agent], "settings.json"), "utf8")), {
            runBudget: { mode: "unlimited" },
          });
          assert.equal(
            readFileSync(join(directories.dirs[agent], "models.json"), "utf8"),
            readFileSync(modelsFile, "utf8"),
          );
        }
      } finally {
        directories.dispose();
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
