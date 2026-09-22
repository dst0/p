import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  certifiedTaskIds,
  certifiedTaskMaxScore,
} from "../benchmarks/src/workloads/certified-task-score-policy.ts";
import { disableDetachedGitMaintenance } from "./git-test-fixture.js";
import { persistBenchmarkCertification } from "./release-benchmark-certification.js";

const releaseScript = resolve("scripts/release.js");
const versionBumpScript = resolve("scripts/version-bump.js");
const workspacePackages = [
  ["packages/agent/package.json", "@dst0/p-agent"],
  ["packages/ai/package.json", "@dst0/p-ai"],
  ["packages/coding-agent/package.json", "@dst0/p-coding-agent"],
  ["packages/code-index/package.json", "@dst0/p-code-index"],
  ["packages/site/package.json", "@dst0/p-site"],
  ["packages/tui/package.json", "@dst0/p-tui"],
  ["packages/coding-agent/examples/extensions/with-deps/package.json", "fixture-with-deps"],
  ["packages/coding-agent/examples/extensions/custom-provider-anthropic/package.json", "fixture-anthropic"],
  ["packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/package.json", "fixture-gitlab"],
  ["packages/coding-agent/examples/extensions/sandbox/package.json", "fixture-sandbox"],
];

export function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function gitBuffer(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot });
}

export function write(repoRoot, relativePath, content) {
  const target = join(repoRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function cloneReleaseFlowFixtureRepository(fixture, directoryName) {
  const cloneRoot = join(fixture.root, directoryName);
  git(fixture.root, "clone", fixture.remoteRoot, cloneRoot);
  disableDetachedGitMaintenance(cloneRoot);
  return cloneRoot;
}

function addPackageFiles(repoRoot) {
  const lockPackages = { "": { version: "0.4.0" } };
  for (const [path, name] of workspacePackages) {
    write(repoRoot, path, `${JSON.stringify({ name, version: "0.4.0" }, null, 2)}\n`);
    lockPackages[path.replace("/package.json", "")] = { name, version: "0.4.0" };
  }
  write(
    repoRoot,
    "package.json",
    '{"name":"fixture","version":"0.4.0","type":"module","workspaces":["packages/*","packages/coding-agent/examples/extensions/*"]}\n',
  );
  write(
    repoRoot,
    "package-lock.json",
    `${JSON.stringify({ name: "fixture", version: "0.4.0", packages: lockPackages }, null, 2)}\n`,
  );
}

export function createReleaseFlowFixture() {
  const root = mkdtempSync(join(tmpdir(), "p-release-flow-"));
  const repoRoot = join(root, "repo");
  const remoteRoot = join(root, "origin.git");
  mkdirSync(repoRoot);
  git(root, "init", "--bare", "-b", "main", remoteRoot);
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(remoteRoot);
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "release-test@example.invalid");
  git(repoRoot, "config", "user.name", "Release Test");
  git(repoRoot, "remote", "add", "origin", remoteRoot);
  addPackageFiles(repoRoot);
  write(repoRoot, "AGENTS.md", "release rules\n");
  write(
    repoRoot,
    "packages/agent/CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n## [0.4.0] - 2026-08-01\n",
  );
  for (const path of [
    "benchmarks/src/workloads/certified-task-score-policy.ts",
    "benchmarks/src/workloads/release-benchmark-base.ts",
    "scripts/release.js",
    "scripts/release-audit.js",
    "scripts/release-audit-certificate.js",
    "scripts/release-audit-evidence.js",
    "scripts/release-benchmark-artifact-validation.js",
    "scripts/release-benchmark-artifacts.js",
    "scripts/release-benchmark-certification.js",
    "scripts/release-benchmark-evidence-storage.js",
    "scripts/release-certificate-receipt.js",
    "scripts/release-change-fragments.js",
    "scripts/release-changelog-audit.js",
    "scripts/release-inputs.js",
    "scripts/release-path-policy.js",
    "scripts/release-output-verifier.js",
    "scripts/release-origin-policy.js",
    "scripts/release-target-policy.js",
    "scripts/release-transaction.js",
    "scripts/release-version-content.js",
    "scripts/release-workspaces.js",
    "scripts/verify-release-certificate.js",
    ".github/workflows/build-binaries.yml",
    ".github/workflows/ci.yml",
  ]) {
    write(repoRoot, path, `${path}\n`);
  }
  write(repoRoot, "scripts/version-bump.js", `import ${JSON.stringify(versionBumpScript)};\n`);
  write(
    repoRoot,
    "scripts/generate-coding-agent-shrinkwrap.js",
    'import { readFileSync, writeFileSync } from "node:fs";\nconst pkg = JSON.parse(readFileSync("packages/coding-agent/package.json"));\nconst shrinkwrap = JSON.parse(readFileSync("packages/coding-agent/npm-shrinkwrap.json"));\nshrinkwrap.version = pkg.version;\nshrinkwrap.packages[""].version = pkg.version;\nwriteFileSync("packages/coding-agent/npm-shrinkwrap.json", `${JSON.stringify(shrinkwrap, null, 2)}\\n`);\n',
  );
  write(
    repoRoot,
    "packages/coding-agent/npm-shrinkwrap.json",
    '{"name":"@dst0/p-coding-agent","version":"0.4.0","packages":{"":{"name":"@dst0/p-coding-agent","version":"0.4.0"}}}\n',
  );
  write(repoRoot, "packages/ai/src/models.generated.ts", "export const generatedModels = [];\n");
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "release 0.4.0");
  git(repoRoot, "tag", "v0.4.0");
  write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
  write(
    repoRoot,
    ".changes/add-value.json",
    '{"schemaVersion":1,"packages":["agent"],"type":"Added","summary":"Add the fixture value export."}\n',
  );
  write(repoRoot, "packages/agent/src/index.js", "export const value = 1;\n");
  write(
    repoRoot,
    "packages/agent/CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Added value.\n\n## [0.4.0] - 2026-08-01\n",
  );
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "add value");
  git(repoRoot, "push", "-u", "origin", "main", "--tags");
  const fakeBin = join(root, "bin");
  write(root, "bin/npm", "#!/bin/sh\nexit 0\n");
  chmodSync(join(fakeBin, "npm"), 0o755);
  return { root, repoRoot, remoteRoot, fakeBin };
}

export function runFixtureRelease(fixture, targetVersion = "0.5.0", options = {}) {
  const args = [releaseScript, targetVersion];
  if (options.allowMajor === true) {
    args.push("--allow-major");
  }
  return spawnSync(process.execPath, args, {
    cwd: fixture.repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${fixture.fakeBin}:${process.env.PATH}` },
    timeout: 120_000,
  });
}

export function writeFixtureBenchmarkCertification(fixture, targetVersion = "5.0.1", options = {}) {
  const tasks = [...certifiedTaskIds];
  const agents = ["p", "pi", "kilo"];
  const evidenceRoot = join(fixture.root, "benchmark-evidence");
  const resultPath = join(evidenceRoot, "results.json");
  const reportPath = join(evidenceRoot, "report.md");
  mkdirSync(evidenceRoot, { recursive: true });
  const artifactHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const bindingPaths = [
    "AGENTS.md",
    "package.json",
    "package-lock.json",
    "scripts/release.js",
    "scripts/release-inputs.js",
    "scripts/release-audit.js",
    ".github/workflows/build-binaries.yml",
    "packages/agent/CHANGELOG.md",
  ];
  const binding = Object.fromEntries(
    [
      "candidateRuntimeSha256",
      "evaluatorSha256",
      "holdoutSha256",
      "kiloExecutableSha256",
      "modelConfigurationSha256",
      "nodeExecutableSha256",
      "piExecutableSha256",
      "projectInstructionsSha256",
    ].map((field, index) => [field, artifactHash(join(fixture.repoRoot, bindingPaths[index]))]),
  );
  const results = [];
  for (let run = 1; run <= 3; run += 1) {
    for (const agent of agents) {
      for (const task of tasks) {
        const sparse = { run, agent, task };
        const maxScore = certifiedTaskMaxScore[task];
        const score = agent === "p" || options.tiedPerformance ? maxScore : maxScore - 1;
        results.push(
          options.sparseRows
            ? sparse
            : {
                ...sparse,
                status: "passed",
                elapsedMs: agent === "p" && !options.tiedPerformance ? 90 : 100,
                exitCode: 0,
                timedOut: false,
                nudges: 0,
                metrics: {
                  usage: {
                    input: 40,
                    output: agent === "p" && !options.tiedPerformance ? 50 : 60,
                    totalTokens: agent === "p" && !options.tiedPerformance ? 90 : 100,
                    cacheRead: 0,
                    cacheWrite: 0,
                    cost: { total: agent === "p" && !options.tiedPerformance ? 0.09 : 0.1 },
                  },
                  toolCalls: 5,
                  toolErrors: 0,
                  errors: [],
                  responseModel: "fixture/model",
                  responseModels: ["fixture/model"],
                },
                quality: {
                  passed: true,
                  score,
                  maxScore,
                  rawScore: score,
                  penalty: 0,
                },
              },
        );
      }
    }
  }
  writeFileSync(
    resultPath,
    `${JSON.stringify({
      agents,
      runs: 3,
      tasks: tasks.map((id) => ({ id })),
      certification: {
        passed: true,
        failures: [],
        thresholds: { maxDurationRatio: 1, maxTokenRatio: 1 },
        binding: {
          node: { sha256: binding.nodeExecutableSha256 },
          pSnapshot: { sha256: binding.candidateRuntimeSha256 },
          pi: { sha256: binding.piExecutableSha256 },
          kilo: { sha256: binding.kiloExecutableSha256 },
          modelConfiguration: { sha256: binding.modelConfigurationSha256 },
          projectInstructions: { sha256: binding.projectInstructionsSha256 },
          evaluator: { sha256: binding.evaluatorSha256 },
          holdoutSha256: binding.holdoutSha256,
        },
      },
      results,
    })}\n`,
  );
  writeFileSync(reportPath, "## Certification Results\n\n**Result: PASSED**\n");
  return persistBenchmarkCertification(fixture.repoRoot, {
    targetVersion,
    resultSha256: artifactHash(resultPath),
    reportSha256: artifactHash(reportPath),
    matrix: {
      agents,
      tasks,
      runs: 3,
      cellCount: 36,
      expectedResolvedModel: "fixture/model",
    },
    binding,
    thresholds: { maxDurationRatio: 1, maxTokenRatio: 1, maxCostRatio: null },
    createdAt: options.createdAt ?? new Date().toISOString(),
  }, { resultPath, reportPath });
}
