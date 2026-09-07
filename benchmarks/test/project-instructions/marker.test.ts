import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCompiledProjectInstructionMarker } from "../../src/project-instructions/marker.ts";
import { createBaseSystemModeProof } from "../../src/project-instructions/probe.ts";

const AGENTS_HASH = "a".repeat(64);
const INPUT_HASH = "b".repeat(64);

function marker(attributes: string): string {
  return `<project_instructions ${attributes}>\nRules\n</project_instructions>`;
}

test("recognizes the runtime compiled marker with an input hash", () => {
  const projectInstructions = marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="compiled"`);
  const proof = createBaseSystemModeProof(
    { systemPrompt: projectInstructions, systemPromptOptions: { projectInstructions } },
    "compiled",
    AGENTS_HASH,
  );
  assert.equal(proof.hasCompiledMarker, true);
  assert.equal(proof.compiledAgentsHash, AGENTS_HASH);
  assert.equal(proof.compiledInputHash, INPUT_HASH);
  assert.equal(proof.compiledArtifactMode, "compiled");
});

test("accepts the exact attributes in any order and preserves fallback mode", () => {
  assert.deepEqual(
    parseCompiledProjectInstructionMarker(
      marker(`mode="fallback" input_sha256="${INPUT_HASH}" agents_sha256="${AGENTS_HASH}"`),
    ),
    { agentsSha256: AGENTS_HASH, inputSha256: INPUT_HASH, mode: "fallback" },
  );
});

test("does not report malformed or legacy opening tags as compiled proof", () => {
  for (const projectInstructions of [
    marker(`agents_sha256="${AGENTS_HASH}" mode="compiled"`),
    '<project_instructions path="/fixture/AGENTS.md">\nRules\n</project_instructions>',
  ]) {
    const proof = createBaseSystemModeProof(
      { systemPrompt: projectInstructions, systemPromptOptions: { projectInstructions } },
      "compiled",
      AGENTS_HASH,
    );
    assert.equal(proof.hasCompiledMarker, false);
    assert.equal(proof.compiledAgentsHash, undefined);
    assert.equal(proof.compiledInputHash, undefined);
    assert.equal(proof.compiledArtifactMode, undefined);
  }
});

for (const [label, content] of [
  ["missing input hash", marker(`agents_sha256="${AGENTS_HASH}" mode="compiled"`)],
  [
    "duplicate mode",
    marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="compiled" mode="exact"`),
  ],
  ["unexpected attribute", marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" status="compiled"`)],
  ["malformed hash", marker(`agents_sha256="${AGENTS_HASH}" input_sha256="short" mode="compiled"`)],
  ["invalid mode", marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="legacy"`)],
  ["malformed quoting", marker(`agents_sha256="${AGENTS_HASH}" input_sha256='${INPUT_HASH}' mode="compiled"`)],
  [
    "unclosed marker",
    marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="compiled"`).replace(
      "</project_instructions>",
      "",
    ),
  ],
  [
    "stray closing marker",
    `${marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="compiled"`)}</project_instructions>`,
  ],
  [
    "multiple markers",
    `${marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="compiled"`)}\n${marker(`agents_sha256="${AGENTS_HASH}" input_sha256="${INPUT_HASH}" mode="compiled"`)}`,
  ],
]) {
  test(`rejects ${label}`, () => {
    assert.equal(parseCompiledProjectInstructionMarker(content), undefined);
  });
}
