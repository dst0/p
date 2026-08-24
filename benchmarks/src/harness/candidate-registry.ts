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
import type { BenchmarkCandidateVersion } from "./candidate-version.ts";
import { parseBenchmarkCandidateVersion } from "./candidate-version.ts";

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const REGISTRY_NAME = "benchmark-candidate-registry.json";
const LOCK_NAME = "benchmark-candidate-registry.lock";

export interface BenchmarkCandidateBinding {
  candidateVersion: BenchmarkCandidateVersion;
  runtimeSha256: string;
}

interface BenchmarkCandidateRegistry {
  schemaVersion: 1;
  candidates: BenchmarkCandidateBinding[];
}

function invalidRegistry(reason: string): never {
  throw new Error(`Invalid candidate registry: ${reason}`);
}

function candidateNumber(candidateVersion: BenchmarkCandidateVersion): number {
  return Number(candidateVersion.slice("5.0.1-rc.".length));
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validateRegistry(value: unknown): BenchmarkCandidateRegistry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidRegistry("expected schema version 1 with a candidates array");
  }
  const document = value as { schemaVersion?: unknown; candidates?: unknown };
  if (
    document.schemaVersion !== 1 ||
    !Array.isArray(document.candidates) ||
    !hasExactKeys(document, ["schemaVersion", "candidates"])
  ) {
    invalidRegistry("expected schema version 1 with a candidates array");
  }
  const versions = new Set<BenchmarkCandidateVersion>();
  const runtimes = new Set<string>();
  const candidates: BenchmarkCandidateBinding[] = [];
  for (const [index, valueEntry] of document.candidates.entries()) {
    if (
      valueEntry === null ||
      typeof valueEntry !== "object" ||
      Array.isArray(valueEntry) ||
      !hasExactKeys(valueEntry, ["candidateVersion", "runtimeSha256"])
    ) {
      invalidRegistry(`candidate ${index + 1} must be an object`);
    }
    const entry = valueEntry as { candidateVersion?: unknown; runtimeSha256?: unknown };
    let version: BenchmarkCandidateVersion;
    try {
      version = parseBenchmarkCandidateVersion(entry.candidateVersion);
    } catch {
      invalidRegistry(`candidate ${index + 1} has an invalid version`);
    }
    if (candidateNumber(version) !== index + 1) invalidRegistry("candidate versions must be contiguous from rc.1");
    if (typeof entry.runtimeSha256 !== "string" || !FINGERPRINT_PATTERN.test(entry.runtimeSha256)) {
      invalidRegistry(`candidate ${index + 1} has an invalid runtime hash`);
    }
    if (versions.has(version) || runtimes.has(entry.runtimeSha256)) {
      invalidRegistry("candidate and runtime bindings must be unique");
    }
    versions.add(version);
    runtimes.add(entry.runtimeSha256);
    candidates.push({ candidateVersion: version, runtimeSha256: entry.runtimeSha256 });
  }
  return { schemaVersion: 1, candidates };
}

function readRegistry(registryPath: string): BenchmarkCandidateRegistry {
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

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeRegistry(directory: string, registryPath: string, registry: BenchmarkCandidateRegistry): void {
  const temporaryPath = join(directory, `.${REGISTRY_NAME}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
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

export function registerBenchmarkCandidate(
  repoRoot: string,
  candidateVersion: unknown,
  runtimeSha256: unknown,
): BenchmarkCandidateBinding {
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
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Benchmark candidate registry is locked by another owner");
    }
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
