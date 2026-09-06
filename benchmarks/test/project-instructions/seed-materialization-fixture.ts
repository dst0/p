import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "@dst0/p-ai";
import { buildProjectInstructionConstraints } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-constraints.js";
import { buildProjectInstructionCompilerModelIdentity } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-reasoning-control.js";
import { materializeProjectInstructionCompilerResult } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-validation.js";
import { splitInstructionSources } from "../../../packages/coding-agent/dist/core/project-instructions/content.js";
import { PROJECT_INSTRUCTION_COMPILER_VERSION } from "../../../packages/coding-agent/dist/core/project-instructions/processor.js";
import { DEFAULT_MODEL_COMPILER_CONTRACT_REVISION } from "../../../packages/coding-agent/dist/core/project-instructions/session-controller.js";
import type { ProjectInstructionClassifications } from "../../../packages/coding-agent/src/core/project-instructions/types.ts";
import { createCertifiedSeedRecord, createSeedCertificate } from "../../src/project-instructions/seed-record.ts";

const helper = fileURLToPath(new URL("../../src/project-instructions/seed.ts", import.meta.url));
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const compilerModel: Model<"openai-completions"> = {
  id: "model",
  name: "Compiler model",
  api: "openai-completions",
  provider: "provider",
  baseUrl: "https://compiler.invalid/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 65_536,
  maxTokens: 4_096,
  thinkingLevelMap: { off: "disabled" },
  compat: { thinkingFormat: "qwen" },
};

export function createSeedMaterializationFixture(
  root: string,
  compilerVersion = PROJECT_INSTRUCTION_COMPILER_VERSION,
  compilerIdentity = buildProjectInstructionCompilerModelIdentity(
    compilerModel,
    DEFAULT_MODEL_COMPILER_CONTRACT_REVISION,
  ),
) {
  const content = `# Rules\n${Array.from({ length: 240 }, (_, index) => `- When code changes, run focused check ${index}.`).join("\n")}\n`;
  const sourcePath = join(root, "source-AGENTS.md");
  const workspace = join(root, "workspace");
  const seedPath = join(root, "seed.json");
  const certificatePath = join(root, "certificate.json");
  const receiptPath = join(root, "receipt.json");
  const modelsPath = join(root, "models.json");
  writeFileSync(sourcePath, content, { mode: 0o600 });
  writeFileSync(
    modelsPath,
    `${JSON.stringify({
      providers: {
        provider: {
          baseUrl: compilerModel.baseUrl,
          apiKey: "test-key",
          api: compilerModel.api,
          models: [
            {
              id: compilerModel.id,
              reasoning: compilerModel.reasoning,
              thinkingLevelMap: compilerModel.thinkingLevelMap,
              compat: compilerModel.compat,
            },
          ],
        },
      },
    })}\n`,
    { mode: 0o600 },
  );
  const sources = [{ path: sourcePath, content }];
  const modules = splitInstructionSources(sources);
  const constraints = buildProjectInstructionConstraints(modules);
  const classifications: ProjectInstructionClassifications = {
    modules: Object.fromEntries(modules.map((module) => [module.id, "routed" as const])),
    constraints: Object.fromEntries(constraints.map((constraint) => [constraint.id, "routed" as const])),
  };
  const triggers = Object.fromEntries(modules.map((module) => [module.id, "code changes"]));
  const result = materializeProjectInstructionCompilerResult(classifications, triggers, constraints);
  const seed = createCertifiedSeedRecord({
    sourceSha256: sha256(content),
    modelsSha256: sha256(readFileSync(modelsPath)),
    runtimeSha256: "c".repeat(64),
    compilerVersion,
    compilerIdentity,
    compilerModel: { provider: compilerModel.provider, id: compilerModel.id, api: compilerModel.api },
    result,
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
    elapsedMs: 100,
  });
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  const certificate = createSeedCertificate(seed, sha256(readFileSync(seedPath)));
  writeFileSync(certificatePath, `${JSON.stringify(certificate)}\n`, { mode: 0o600 });
  return {
    sourcePath,
    modelsPath,
    workspace,
    seedPath,
    certificatePath,
    receiptPath,
    certificate,
    compilerIdentity,
    result,
    sourceSha256: sha256(content),
  };
}

export function materializeSeedFixture(fixture: ReturnType<typeof createSeedMaterializationFixture>) {
  return spawnSync(
    process.execPath,
    [
      helper,
      "materialize",
      "--source",
      fixture.sourcePath,
      "--models-file",
      fixture.modelsPath,
      "--workspace",
      fixture.workspace,
      "--seed",
      fixture.seedPath,
      "--certificate",
      fixture.certificatePath,
      "--receipt",
      fixture.receiptPath,
    ],
    { encoding: "utf8" },
  );
}
