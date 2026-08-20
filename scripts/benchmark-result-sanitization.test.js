import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeBenchmarkEvidence } from "./benchmark-result-sanitization.js";

test("sanitizes nested benchmark paths without mutating the source", () => {
  const output = "/Users/example/dev/p/benchmarks/results/run";
  const source = {
    details: `${output}/workspaces/p/run-1/task/src/index.ts:2`,
    nested: [
      "/Users/example/dev/p/packages/coding-agent/dist/cli.js",
      "/Users/example/.p/agent/models.json",
      "ordinary diagnostic",
    ],
    keyed: {
      [`${output}/stderr/p-run.log`]: "path used as a map key",
    },
  };

  const sanitized = sanitizeBenchmarkEvidence(source, {
    output,
    repoRoot: "/Users/example/dev/p",
    home: "/Users/example",
  });

  assert.deepEqual(sanitized, {
    details: "./workspaces/p/run-1/task/src/index.ts:2",
    nested: ["<repo>/packages/coding-agent/dist/cli.js", "~/.p/agent/models.json", "ordinary diagnostic"],
    keyed: {
      "./stderr/p-run.log": "path used as a map key",
    },
  });
  assert.equal(source.details.startsWith(output), true);
});

test("rejects object keys that collide after path sanitization", () => {
  const output = "/Users/example/dev/p/benchmarks/results/run";
  assert.throws(
    () => sanitizeBenchmarkEvidence(
      {
        [`${output}/stderr/p-run.log`]: "absolute",
        "./stderr/p-run.log": "already portable",
      },
      { output, repoRoot: "/Users/example/dev/p", home: "/Users/example" },
    ),
    /duplicate object key/u,
  );
});
