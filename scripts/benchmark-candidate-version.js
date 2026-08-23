import { join } from "node:path";

const CANDIDATE_VERSION_PATTERN = /^5\.0\.1-rc\.([1-9]\d*)$/u;

export function parseBenchmarkCandidateVersion(value) {
  if (value === undefined) throw new Error("P_BENCHMARK_CANDIDATE_VERSION candidate version is required");
  const match = typeof value === "string" ? CANDIDATE_VERSION_PATTERN.exec(value) : null;
  if (match === null || !Number.isSafeInteger(Number(match[1]))) {
    throw new Error("P_BENCHMARK_CANDIDATE_VERSION must match 5.0.1-rc.<positive integer>");
  }
  return value;
}

export function assertBenchmarkCandidateOutputPath(output, candidateVersion) {
  const candidate = parseBenchmarkCandidateVersion(candidateVersion);
  const escapedCandidate = candidate.replaceAll(".", "\\.");
  const exactCandidate = new RegExp(`(?:^|[^A-Za-z0-9])v${escapedCandidate}(?:$|[^A-Za-z0-9])`, "u");
  if (!exactCandidate.test(output)) {
    throw new Error(`Benchmark output path must contain the exact candidate v${candidate}`);
  }
  return output;
}

export function resolveBenchmarkCandidateOutput(repoRoot, requestedOutput, candidateVersion, timestamp) {
  const candidate = parseBenchmarkCandidateVersion(candidateVersion);
  const output = requestedOutput ??
    join(repoRoot, "benchmarks", "results", `${timestamp}-v${candidate}-project-instructions-paired`);
  return assertBenchmarkCandidateOutputPath(output, candidate);
}
