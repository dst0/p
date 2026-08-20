import assert from "node:assert/strict";
import { test } from "node:test";
import {
  benchmarkModels,
  modelAliasForAgent,
} from "./benchmark-model-attribution.js";

test("keeps Codex attribution independent from PI and P", () => {
  const options = {
    agents: ["pi", "p", "codex", "kilo", "agy"],
    model: "shared/pi-p",
    codexModel: "openai/gpt-codex",
    kiloModel: "gateway/kilo-model",
    agyModel: "google/agy-model",
  };

  assert.equal(modelAliasForAgent("codex", options), "openai/gpt-codex");
  assert.equal(modelAliasForAgent("p", options), "shared/pi-p");
  assert.deepEqual(benchmarkModels(options), {
    pi: "shared/pi-p",
    p: "shared/pi-p",
    codex: "openai/gpt-codex",
    kilo: "gateway/kilo-model",
    agy: "google/agy-model",
  });
});
