#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStorage } from "../../../packages/coding-agent/dist/core/auth-storage.js";
import { ModelRegistry } from "../../../packages/coding-agent/dist/core/model-registry.js";
import { getProjectInstructionCompilerFailureTelemetry } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-attempt-diagnostics.js";
import { buildProjectInstructionConstraints } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-constraints.js";
import { classifyProjectInstructionCompilerError } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-diagnostics.js";
import { validateProjectInstructionCompilerResult } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-validation.js";
import { splitInstructionSources } from "../../../packages/coding-agent/dist/core/project-instructions/content.js";
import { compileProjectInstructionsWithModel } from "../../../packages/coding-agent/dist/core/project-instructions/model-compiler.js";
import {
  PROJECT_INSTRUCTION_COMPILER_VERSION,
  prepareProjectInstructions,
} from "../../../packages/coding-agent/dist/core/project-instructions/processor.js";
import { DEFAULT_MODEL_COMPILER_CONTRACT_REVISION } from "../../../packages/coding-agent/dist/core/project-instructions/session-controller.js";
import type { ProjectInstructionManifest } from "../../../packages/coding-agent/src/core/project-instructions/types.ts";
import { computeAuthorizedProjectInstructionPromptHashes } from "./prompt-projection.ts";
import {
  assertCertifiedSeedRecord,
  assertSeedCertificate,
  createCertifiedSeedRecord,
  createSeedCertificate,
} from "./seed-record.ts";

const PREFLIGHT_EXIT_CODE = 86;

function parseArgs(argv: string[]): { command: string; options: Record<string, string> } {
  const [command, ...values] = argv;
  if (!command || !["certify", "materialize"].includes(command)) throw new Error("Seed helper command is required");
  const pathOptions = new Set(["source", "models-file", "auth-file", "seed", "certificate", "workspace", "receipt"]);
  const options: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined)
      throw new Error("Seed helper arguments must be name/value pairs");
    const key = name.slice(2);
    options[key] = pathOptions.has(key) ? resolve(value) : value;
  }
  return { command, options };
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requestedModel(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) throw new Error("Seed helper model must be provider/id");
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

async function certify(options: Record<string, string>): Promise<void> {
  for (const name of [
    "source",
    "models-file",
    "auth-file",
    "compiler-model",
    "runtime-sha256",
    "seed",
    "certificate",
  ]) {
    if (!options[name]) throw new Error(`Seed certification is missing --${name}`);
  }
  const source = readFileSync(options.source, "utf8");
  const sourceSha256 = hashFile(options.source);
  const modelsSha256 = hashFile(options["models-file"]);
  const requested = requestedModel(options["compiler-model"]);
  const authStorage = AuthStorage.create(options["auth-file"]);
  const registry = ModelRegistry.create(authStorage, options["models-file"]);
  const model = registry.find(requested.provider, requested.id);
  if (!model) throw new Error("Exact seed compiler model was not found");
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error("Seed compiler authentication failed");
  const sources = [{ path: options.source, content: source }];
  const modules = splitInstructionSources(sources);
  const constraints = buildProjectInstructionConstraints(modules);
  const startedAt = performance.now();
  const compiled = await compileProjectInstructionsWithModel(
    { sources, modules, constraints },
    { model, apiKey: auth.apiKey, headers: auth.headers, timeoutMs: 600_000 },
  );
  const elapsedMs = performance.now() - startedAt;
  if (!compiled.usage) throw new Error("Seed compiler did not report usage");
  const { usage, ...result } = compiled;
  validateProjectInstructionCompilerResult(result, modules, constraints);
  const compilerIdentity = `${model.provider}/${model.id}:${DEFAULT_MODEL_COMPILER_CONTRACT_REVISION}`;
  const seed = createCertifiedSeedRecord({
    sourceSha256,
    modelsSha256,
    runtimeSha256: options["runtime-sha256"],
    compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
    compilerIdentity,
    compilerModel: { provider: model.provider, id: model.id, api: model.api },
    result,
    usage,
    elapsedMs,
  });
  writePrivateJson(options.seed, seed);
  writePrivateJson(options.certificate, createSeedCertificate(seed, hashFile(options.seed)));
}

async function materialize(options: Record<string, string>): Promise<void> {
  for (const name of ["source", "workspace", "seed", "certificate", "receipt"]) {
    if (!options[name]) throw new Error(`Seed materialization is missing --${name}`);
  }
  const certificate = assertSeedCertificate(JSON.parse(readFileSync(options.certificate, "utf8")));
  const preparation = certificate.compilerPreparation;
  const seed = assertCertifiedSeedRecord(JSON.parse(readFileSync(options.seed, "utf8")), preparation);
  const expectedCompilerIdentity = `${seed.compilerModel.provider}/${seed.compilerModel.id}:${DEFAULT_MODEL_COMPILER_CONTRACT_REVISION}`;
  if (
    seed.compilerVersion !== PROJECT_INSTRUCTION_COMPILER_VERSION ||
    seed.compilerIdentity !== expectedCompilerIdentity
  ) {
    throw new Error("Certified seed compiler identity does not match this runtime");
  }
  if (hashFile(options.seed) !== preparation.seedSha256) throw new Error("Certified seed file changed");
  if (hashFile(options.source) !== seed.sourceSha256) throw new Error("Certified seed source changed");
  if (existsSync(join(options.workspace, ".pdev"))) throw new Error("Seed workspace already contains project state");
  mkdirSync(options.workspace, { recursive: true, mode: 0o700 });
  const agentsPath = join(options.workspace, "AGENTS.md");
  copyFileSync(options.source, agentsPath);
  const content = readFileSync(agentsPath, "utf8");
  const modules = splitInstructionSources([{ path: agentsPath, content }]);
  const constraints = buildProjectInstructionConstraints(modules);
  validateProjectInstructionCompilerResult(seed.result, modules, constraints);
  let seedMaterializations = 0;
  const prepared = await prepareProjectInstructions({
    cwd: options.workspace,
    cacheDir: join(options.workspace, ".pdev", "instructions"),
    contextFiles: [{ path: agentsPath, content }],
    skills: [],
    compilerIdentity: seed.compilerIdentity,
    compiler: async () => {
      seedMaterializations += 1;
      return seed.result;
    },
  });
  if (
    seedMaterializations !== 1 ||
    prepared.manifest.mode !== "compiled" ||
    prepared.manifest.compilerUsage !== undefined
  ) {
    throw new Error("Seed materialization did not produce one provider-free compiled artifact");
  }
  const authorizedPromptHashes = computeAuthorizedProjectInstructionPromptHashes(prepared.prompt);
  if (!authorizedPromptHashes) throw new Error("Seed materialization prompt projections are invalid");
  if (hashFile(options.source) !== seed.sourceSha256)
    throw new Error("Certified seed source changed during materialization");
  writePrivateJson(options.receipt, {
    schemaVersion: 1,
    seedSha256: preparation.seedSha256,
    certificationHash: seed.certificationHash,
    providerCompilerInvocations: 0,
    seedMaterializations,
    cacheClosureSha256: hashDirectory(join(options.workspace, ".pdev", "instructions")),
    authorizedPromptHashes,
    manifest: pickManifestIdentity(prepared.manifest),
  });
}

function pickManifestIdentity(manifest: ProjectInstructionManifest): Record<string, unknown> {
  return {
    compilerVersion: manifest.compilerVersion,
    agentsHash: manifest.agentsHash,
    inputHash: manifest.inputHash,
    resultHash: manifest.resultHash,
    promptHash: manifest.promptHash,
    rulesCatalogHash: manifest.rulesCatalogHash,
    skillsCatalogHash: manifest.skillsCatalogHash,
    mode: manifest.mode,
    compilerStatus: manifest.compilerStatus,
  };
}

function hashDirectory(root: string): string {
  const canonicalRoot = realpathSync(root);
  const files = listRegularFiles(canonicalRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(canonicalRoot, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listRegularFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile()) || (stats.isFile() && stats.nlink !== 1)) {
      throw new Error("Seed cache contains an unsafe artifact");
    }
    if (stats.isDirectory()) files.push(...listRegularFiles(root, path));
    else files.push(relative(root, path));
  }
  return files.sort();
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "certify") await certify(options);
  else await materialize(options);
  process.stdout.write('{"status":"success"}\n');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const compilerFailure = getProjectInstructionCompilerFailureTelemetry(error);
    process.stdout.write(
      `${JSON.stringify({
        status: "failed",
        diagnostic: classifyProjectInstructionCompilerError(error),
        ...(compilerFailure ? { compilerFailure } : {}),
      })}\n`,
    );
    process.exitCode = PREFLIGHT_EXIT_CODE;
  });
}
