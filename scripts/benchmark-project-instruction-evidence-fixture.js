import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderProjectInstructions,
  selectProjectInstructionPromptForTools,
} from "../packages/coding-agent/src/core/project-instructions/prompt.ts";
import { computeBenchmarkProjectInstructionResultHash } from "./benchmark-project-instruction-cache.js";
import { hashFile } from "./benchmark-project-instruction-evidence.js";

export function createCompiledFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "benchmark-instruction-evidence-"));
  const sourceFile = join(root, "AGENTS.md");
  writeFileSync(sourceFile, "# Rules\n\nAlways verify.\n", "utf8");
  const sourceSha256 = hashFile(sourceFile);
  const inputHash = "a".repeat(64);
  const agentsHash = "c".repeat(64);
  const otherSources = Array.from({ length: 3 }, (_, index) => {
    const path = join(root, `CONTEXT-${index}.md`);
    const content = `Context ${index}.\n`;
    writeFileSync(path, content, "utf8");
    return { path, contentHash: hashText(content) };
  });
  const taskSource = { path: sourceFile, contentHash: sourceSha256 };
  const sources =
    options.sourceScenario === "wrong-path"
      ? [{ ...otherSources[0], contentHash: sourceSha256 }, ...otherSources.slice(1)]
      : options.sourceScenario === "wrong-hash"
        ? [...otherSources, { ...taskSource, contentHash: "e".repeat(64) }]
        : options.sourceScenario === "duplicate"
          ? [...otherSources, taskSource, taskSource]
          : [...otherSources, taskSource];
  const cache = join(root, ".pdev", "instructions");
  const markerInputHash = options.markerInputHash ?? inputHash;
  const canonicalPrompt = renderProjectInstructions({
    agentsHash,
    inputHash: markerInputHash,
    cacheDir: cache,
    mode: "compiled",
    body: "Always verify.",
    sources: [],
    rules: [],
    skills: [],
  });
  if (!canonicalPrompt) throw new Error("fixture prompt exceeded the project-instruction budget");
  const artifactPrompt = options.malformedGuidance
    ? canonicalPrompt.replace("Use list_skills", "Use list skills")
    : canonicalPrompt;
  const prompt = selectProjectInstructionPromptForTools(
    { prompt: artifactPrompt, cacheDir: cache, manifest: { inputHash } },
    ["read_rules", "list_skills", "read_skills"],
  );
  const rulesCatalog = "# Rule catalog\n\n- `rules/testing.md`\n";
  const skillsCatalog = "# Skill catalog\n";
  const ruleContent = "# Calculator testing\n\nRun calculator tests.\n";
  const manifest = {
    schemaVersion: 1,
    compilerVersion: "project-instructions-v4",
    agentsHash,
    inputHash,
    promptHash: hashText(artifactPrompt),
    rulesCatalogHash: hashText(rulesCatalog),
    skillsCatalogHash: hashText(skillsCatalog),
    rulesCatalogPages: [],
    skillsCatalogPages: [],
    mode: "compiled",
    compilerStatus: options.compilerStatus ?? "success",
    compilerDiagnostic: options.compilerDiagnostic,
    compilerUsage: {
      input: 100,
      output: 10,
      cacheRead: 20,
      cacheWrite: 0,
      total: 130,
      ...options.compilerUsageExtra,
    },
    promptFile: "prompt.md",
    rulesCatalogFile: "rules/catalog.md",
    skillsCatalogFile: "skills/catalog.md",
    sources,
    rules: [
      {
        id: "testing",
        link: "rules/testing.md",
        file: "rules/testing.md",
        title: "Calculator testing",
        trigger: "calculator tests",
        routable: true,
        sourcePath: sourceFile,
        contentHash: hashText(ruleContent),
      },
    ],
    skills: [],
  };
  const resultHash = computeBenchmarkProjectInstructionResultHash(manifest);
  const version = `${inputHash}-${resultHash}`;
  const versionDir = join(cache, "versions", version);
  mkdirSync(join(versionDir, "rules"), { recursive: true });
  mkdirSync(join(versionDir, "skills"), { recursive: true });
  writeFileSync(join(versionDir, "prompt.md"), artifactPrompt, "utf8");
  writeFileSync(join(versionDir, "rules/catalog.md"), rulesCatalog);
  writeFileSync(join(versionDir, "skills/catalog.md"), skillsCatalog);
  writeFileSync(join(versionDir, "rules/testing.md"), ruleContent);
  const manifestFile = join(versionDir, "manifest.json");
  writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, resultHash })}\n`, "utf8");
  writeFileSync(
    join(cache, "current.json"),
    `${JSON.stringify({ schemaVersion: 1, agentsHash, inputHash, version, ...options.currentExtra })}\n`,
    "utf8",
  );
  return { root, sourceFile, sourceSha256, inputHash, prompt, manifestFile, versionDir };
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}
