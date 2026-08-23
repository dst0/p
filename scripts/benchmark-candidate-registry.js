import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { parseBenchmarkCandidateVersion } from "./benchmark-candidate-version.js";

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const REGISTRY_NAME = "benchmark-candidate-registry.json";
const LOCK_NAME = "benchmark-candidate-registry.lock";

function invalidRegistry(reason) {
  throw new Error(`Invalid candidate registry: ${reason}`);
}

function candidateNumber(candidateVersion) {
  return Number(candidateVersion.slice("5.0.1-rc.".length));
}

function hasExactKeys(value, keys) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validateRegistry(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.candidates) ||
    !hasExactKeys(value, ["schemaVersion", "candidates"])
  ) {
    invalidRegistry("expected schema version 1 with a candidates array");
  }
  const versions = new Set();
  const runtimes = new Set();
  for (const [index, entry] of value.candidates.entries()) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !hasExactKeys(entry, ["candidateVersion", "runtimeSha256"])
    ) {
      invalidRegistry(`candidate ${index + 1} must be an object`);
    }
    let version;
    try {
      version = parseBenchmarkCandidateVersion(entry.candidateVersion);
    } catch {
      invalidRegistry(`candidate ${index + 1} has an invalid version`);
    }
    if (candidateNumber(version) !== index + 1) invalidRegistry("candidate versions must be contiguous from rc.1");
    if (!FINGERPRINT_PATTERN.test(entry.runtimeSha256)) invalidRegistry(`candidate ${index + 1} has an invalid runtime hash`);
    if (versions.has(version) || runtimes.has(entry.runtimeSha256)) invalidRegistry("candidate and runtime bindings must be unique");
    versions.add(version);
    runtimes.add(entry.runtimeSha256);
  }
  return value;
}

function readRegistry(registryPath) {
  if (!existsSync(registryPath)) return { schemaVersion: 1, candidates: [] };
  if (!lstatSync(registryPath).isFile()) invalidRegistry("registry path must be a regular file");
  chmodSync(registryPath, 0o600);
  try {
    return validateRegistry(JSON.parse(readFileSync(registryPath, "utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid candidate registry:")) throw error;
    throw new Error("Invalid candidate registry: file is not valid JSON", { cause: error });
  }
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeRegistry(directory, registryPath, registry) {
  const temporaryPath = join(directory, `.${REGISTRY_NAME}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, registryPath);
    chmodSync(registryPath, 0o600);
    syncDirectory(directory);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

export function registerBenchmarkCandidate(repoRoot, candidateVersion, runtimeSha256) {
  const candidate = parseBenchmarkCandidateVersion(candidateVersion);
  if (typeof runtimeSha256 !== "string" || !FINGERPRINT_PATTERN.test(runtimeSha256)) {
    throw new Error("Benchmark immutable runtime fingerprint must be a lowercase SHA-256 hash");
  }
  const privateDirectory = join(repoRoot, ".pdev");
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  if (!lstatSync(privateDirectory).isDirectory()) {
    throw new Error("Benchmark candidate registry directory must not be a symbolic link");
  }
  chmodSync(privateDirectory, 0o700);
  const lockPath = join(privateDirectory, LOCK_NAME);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error && error.code === "EEXIST") throw new Error("Benchmark candidate registry is locked by another owner");
    throw error;
  }
  try {
    const registryPath = join(privateDirectory, REGISTRY_NAME);
    const registry = readRegistry(registryPath);
    const registeredCandidate = registry.candidates.find((entry) => entry.candidateVersion === candidate);
    if (registeredCandidate) {
      if (registeredCandidate.runtimeSha256 !== runtimeSha256) {
        throw new Error(`Benchmark candidate ${candidate} already belongs to a different runtime`);
      }
      return registeredCandidate;
    }
    const registeredRuntime = registry.candidates.find((entry) => entry.runtimeSha256 === runtimeSha256);
    if (registeredRuntime) {
      throw new Error(`Benchmark runtime is already registered as ${registeredRuntime.candidateVersion}`);
    }
    const expectedCandidate = `5.0.1-rc.${registry.candidates.length + 1}`;
    if (candidate !== expectedCandidate) throw new Error(`Benchmark next candidate must be ${expectedCandidate}`);
    const binding = { candidateVersion: candidate, runtimeSha256 };
    registry.candidates.push(binding);
    writeRegistry(privateDirectory, registryPath, registry);
    return binding;
  } finally {
    rmSync(lockPath, { recursive: true });
  }
}
