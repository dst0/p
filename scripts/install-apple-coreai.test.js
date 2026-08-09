import assert from "node:assert/strict";
import test from "node:test";

import { APPLE_CORE_AI_MANIFEST, isMacOsCoreAiAvailable } from "./install-apple-coreai.js";

test("detects native Core AI only on supported Apple Silicon macOS", () => {
  assert.equal(isMacOsCoreAiAvailable({
    architecture: "arm64",
    macOsVersion: "27.0",
    platform: "darwin",
  }), true);
  assert.equal(isMacOsCoreAiAvailable({
    architecture: "arm64",
    macOsVersion: "26.6",
    platform: "darwin",
  }), false);
  assert.equal(isMacOsCoreAiAvailable({
    architecture: "x64",
    macOsVersion: "27.0",
    platform: "darwin",
  }), false);
});

test("pins the Core AI model source to an immutable Apple commit", () => {
  assert.match(APPLE_CORE_AI_MANIFEST.coreAiModelsCommit, /^[0-9a-f]{40}$/);
  assert.match(APPLE_CORE_AI_MANIFEST.coreAiModelsSha256, /^[0-9a-f]{64}$/);
  assert.equal(APPLE_CORE_AI_MANIFEST.artifactVersion, "qwen3-embedding-0.6b-ane-b1-s64-v1");
});
