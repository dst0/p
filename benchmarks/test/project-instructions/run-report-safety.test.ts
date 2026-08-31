import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tokens } from "marked";
import { marked } from "marked";
import { markdownCodeSpan } from "../../src/harness/markdown.ts";
import { createUnavailableCellLiveness } from "../../src/project-instructions/run-liveness.ts";
import { renderPairedReport } from "../../src/project-instructions/run-report.ts";

const payload =
  "alpha```beta ~~struck~~ https://example.test/path\n\n## forged-heading\n<script>forged()</script>\n| extra | cell |";

test("paired report safely renders every dynamic prose, code-span, and table value", () => {
  const liveness = {
    ...createUnavailableCellLiveness(),
    progressEvidence: `progress/${payload}.jsonl.br`,
  };
  const report = renderPairedReport({
    generatedAt: payload,
    model: payload,
    compilerModel: payload,
    binarySha256: payload,
    seed: payload,
    candidateVersion: "5.0.1-rc.1",
    runs: 3,
    tasks: [payload],
    schedule: [{ run: 1, task: payload, conditions: [payload, payload, payload] }],
    samples: [
      {
        run: 1,
        task: payload,
        condition: payload,
        mode: payload,
        taskVerificationMode: payload,
        status: payload,
        quality: { rawScore: 1, maxScore: 2 },
        metrics: { usage: { totalTokens: 3 } },
        elapsedMs: 4,
        liveness,
      },
    ],
    completed: false,
    gate: {
      passed: false,
      failure: { run: 1, task: payload, mode: payload, kind: payload, reason: payload, liveness },
    },
  });
  const tokens = marked.lexer(report);
  const headings = tokens
    .filter((token): token is Tokens.Heading => token.type === "heading")
    .map((token) => token.text);
  const tables = tokens.filter((token): token is Tokens.Table => token.type === "table");
  const html = marked.parse(report);
  assert.equal(typeof html, "string");
  if (typeof html !== "string") throw new Error("marked unexpectedly returned an asynchronous result");
  assert.deepEqual(headings, [
    "Project-instruction three-condition benchmark",
    "Randomized condition order",
    "Samples",
  ]);
  assert.deepEqual(
    tables.map((table) => table.header.length),
    [5, 11],
  );
  assert.ok(tables.every((table) => table.rows.every((row) => row.length === table.header.length)));
  assert.doesNotMatch(html, /<script>|forged\(\)<\/script>/iu);
  assert.doesNotMatch(html, /<a\s|<del>/iu);
  assert.doesNotMatch(report, /^## forged-heading$/mu);
});

test("empty dynamic code values render as an actual empty code element", () => {
  assert.equal(marked.parseInline(markdownCodeSpan("")), "<code></code>");
});
