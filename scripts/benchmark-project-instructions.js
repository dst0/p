#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPairedSchedule,
  parsePairedArgs,
} from "./benchmark-project-instructions-core.js";
import { createClassifiedBenchmarkGateFailure } from "./benchmark-project-instructions-failure.js";
import { printPairedBenchmarkHelp } from "./benchmark-project-instructions-help.js";
import { hashFile } from "./benchmark-project-instruction-evidence.js";
import {
  assertEmptyOutputDirectory,
  benchmarkProjectInstructionProbePath,
  hashRuntimeSnapshot,
} from "./benchmark-runtime-snapshot.js";
import * as privateInputs from "./benchmark-private-input-snapshots.js";
import { createBenchmarkAuthOutputGuard } from "./benchmark-auth-output-guard.js";
import { resolveBenchmarkCandidateOutput, parseBenchmarkCandidateVersion } from "./benchmark-candidate-version.js";
import { registerBenchmarkCandidate } from "./benchmark-candidate-registry.js";
import { createPairedBenchmarkResources, finalizePairedBenchmarkResources } from "./benchmark-paired-resources.js";
import { certifyBenchmarkProjectInstructions } from "./benchmark-project-instruction-seed-runner.js";
import { writePairedBenchmarkEvidence } from "./benchmark-project-instructions-output.js";
import { runPairedBenchmarkSchedule } from "./benchmark-project-instructions-schedule.js";
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const codingAgentCli = join("packages", "coding-agent", "dist", "cli.js");
const timestampLabel = () => new Date().toISOString().replaceAll(/[:.]/gu, "-");
export async function runProjectInstructionsBenchmark({
  argv = process.argv.slice(2),
  environment = process.env,
  root = repoRoot,
  dependencies = {},
} = {}) {
  const pathExists = dependencies.pathExists ?? existsSync;
  const createResources = dependencies.createResources ?? createPairedBenchmarkResources;
  const finalizeResources = dependencies.finalizeResources ?? finalizePairedBenchmarkResources;
  const createAuthOutputGuard = dependencies.createAuthOutputGuard ?? createBenchmarkAuthOutputGuard;
  const privateInputEvidence = dependencies.privateInputEvidence ?? privateInputs.benchmarkPrivateInputEvidence;
  const hashRuntime = dependencies.hashRuntime ?? hashRuntimeSnapshot;
  const registerCandidate = dependencies.registerCandidate ?? registerBenchmarkCandidate;
  const writeEvidence = dependencies.writeEvidence ?? writePairedBenchmarkEvidence;
  const certify = dependencies.certify ?? certifyBenchmarkProjectInstructions;
  const runSchedule = dependencies.runSchedule ?? runPairedBenchmarkSchedule;
  const options = parsePairedArgs(argv);
  if (options.help) return printPairedBenchmarkHelp();
  const candidateVersion = parseBenchmarkCandidateVersion(environment.P_BENCHMARK_CANDIDATE_VERSION);
  const output = resolveBenchmarkCandidateOutput(root, options.output, candidateVersion, timestampLabel());
  const source = join(root, "AGENTS.md");
  if (!pathExists(join(root, codingAgentCli))) throw new Error("P must be built before benchmarking");
  if (!pathExists(source)) throw new Error("Repository AGENTS.md is required for the paired benchmark");
  assertEmptyOutputDirectory(output);
  mkdirSync(join(output, "inputs"), { recursive: true });
  const projectInstructionsFile = join(output, "inputs", "AGENTS.md");
  copyFileSync(source, projectInstructionsFile);
  const authSource = join(homedir(), ".p", "agent", "auth.json");
  const resources = createResources({ repoRoot: root, temporaryParent: tmpdir(), modelsSource: options.modelsFile, authSource, model: options.model });
  let authOutputGuard;
  try {
    const { runtimeSnapshot, scratchRoot, privateSnapshots } = resources;
    authOutputGuard = createAuthOutputGuard([authSource, privateSnapshots.auth.path]);
    options.pCli = join(runtimeSnapshot, codingAgentCli);
    options.projectInstructionProbe = benchmarkProjectInstructionProbePath(runtimeSnapshot);
    options.projectInstructionsFile = projectInstructionsFile;
    options.privateSnapshots = privateSnapshots;
    options.authOutputGuard = authOutputGuard;
    options.authFiles = [authSource, privateSnapshots.auth.path];
    options.modelsFile = privateSnapshots.models.path;
    options.sourceSha256 = hashFile(projectInstructionsFile);
    const seed = options.seed ?? randomBytes(16).toString("hex");
    const runtimeSha256 = hashRuntime(runtimeSnapshot, process.execPath);
    registerCandidate(root, candidateVersion, runtimeSha256);
    const schedule = buildPairedSchedule(options.tasks, options.runs, seed);
    const document = {
      schemaVersion: 1,
      candidateVersion,
      generatedAt: new Date().toISOString(),
      model: options.model, compilerModel: options.compilerModel,
      binarySha256: runtimeSha256,
      projectInstructionsSourceSha256: options.sourceSha256,
      ...privateInputEvidence(privateSnapshots),
      seed,
      runs: options.runs,
      tasks: options.tasks,
      schedule,
      samples: [],
      gate: { passed: true },
      completed: false,
    };
    writeEvidence(output, document);
    console.log(`Paired benchmark output: ${output}`);
    console.log(`Immutable P runtime SHA-256: ${runtimeSha256}`);
    console.log(`Project instruction source SHA-256: ${options.sourceSha256}`);
    console.log(`Randomization seed: ${seed}`);
    try {
      options.seed = certify({
        scratchRoot,
        runtimeSnapshot,
        runtimeSha256,
        sourceFile: projectInstructionsFile,
        sourceSha256: options.sourceSha256,
        privateSnapshots,
        compilerModel: options.compilerModel,
        authOutputGuard,
      });
      document.compilerPreparation = options.seed.certificate.compilerPreparation;
      writeEvidence(output, document);
    } catch (error) {
      document.gate = {
        passed: false,
        failure: createClassifiedBenchmarkGateFailure({ run: 0, task: "compiler-certification" }, "compiled", error, { compilerCertification: true }),
      };
      writeEvidence(output, document);
      process.exitCode = 2;
      return;
    }
    await runSchedule({
      options,
      output,
      scratchRoot,
      runtimeSnapshot,
      runtimeSha256,
      schedule,
      document,
      deadline: Date.now() + options.maxRuntimeSeconds * 1000,
      repoRoot: root,
    });
  } finally {
    finalizeResources(resources, authOutputGuard, output, [authSource, resources.privateSnapshots.auth.path]);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    await runProjectInstructionsBenchmark();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
