import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];
const BENCHMARK_RUNNER = join("scripts", "benchmark-agents.js");
const BENCHMARK_PROJECT_INSTRUCTION_PROBE = join("scripts", "benchmark-project-instruction-probe.js");
const BENCHMARK_SEED_HELPER = join("scripts", "benchmark-project-instruction-seed.js");
const BENCHMARK_ORCHESTRATOR = join("scripts", "benchmark-project-instructions.js");

export function assertEmptyOutputDirectory(path) {
  if (existsSync(path) && readdirSync(path).length > 0) throw new Error(`Output directory is not empty: ${path}`);
}

export function createRuntimeSnapshot(repoRoot, temporaryParent) {
  const snapshot = mkdtempSync(join(temporaryParent, "p-benchmark-runtime-"));
  try {
    const copyOptions = {
      mode: fsConstants.COPYFILE_FICLONE,
      recursive: true,
      verbatimSymlinks: true,
    };
    cpSync(join(repoRoot, "node_modules"), join(snapshot, "node_modules"), copyOptions);
    cpSync(join(repoRoot, "package.json"), join(snapshot, "package.json"), copyOptions);
    cpSync(join(repoRoot, "package-lock.json"), join(snapshot, "package-lock.json"), copyOptions);
    snapshotBenchmarkRunnerClosure(repoRoot, snapshot, copyOptions);
    cpSync(
      join(repoRoot, "benchmarks", "fixtures", "durable-workflow"),
      join(snapshot, "benchmarks", "fixtures", "durable-workflow"),
      copyOptions,
    );
    for (const pkg of runtimePackages) {
      const target = join(snapshot, "packages", pkg);
      mkdirSync(target, { recursive: true });
      cpSync(join(repoRoot, "packages", pkg, "package.json"), join(target, "package.json"), copyOptions);
      cpSync(join(repoRoot, "packages", pkg, "dist"), join(target, "dist"), copyOptions);
    }
    copyPublishedRuntimeExtras(repoRoot, snapshot, copyOptions);
    assertSnapshotSymlinksContained(snapshot);
    return snapshot;
  } catch (error) {
    rmSync(snapshot, { recursive: true, force: true });
    throw error;
  }
}

export function benchmarkRunnerPath(snapshot) {
  return join(snapshot, BENCHMARK_RUNNER);
}

export function benchmarkSeedHelperPath(snapshot) {
  return join(snapshot, BENCHMARK_SEED_HELPER);
}

export function benchmarkProjectInstructionProbePath(snapshot) {
  return join(snapshot, BENCHMARK_PROJECT_INSTRUCTION_PROBE);
}

export function snapshotBenchmarkRunnerClosure(repoRoot, snapshot, copyOptions = {}) {
  const scriptsRoot = join(repoRoot, "scripts");
  const pending = [
    join(repoRoot, BENCHMARK_RUNNER),
    join(repoRoot, BENCHMARK_PROJECT_INSTRUCTION_PROBE),
    join(repoRoot, BENCHMARK_SEED_HELPER),
    join(repoRoot, BENCHMARK_ORCHESTRATOR),
  ];
  const copied = new Set();
  while (pending.length > 0) {
    const source = pending.pop();
    if (copied.has(source)) continue;
    if (!isPathInside(scriptsRoot, source) || !source.endsWith(".js") || !existsSync(source)) {
      throw new Error(`Benchmark runner import escapes or is missing from scripts: ${source}`);
    }
    copied.add(source);
    const destination = join(snapshot, "scripts", relative(scriptsRoot, source));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, copyOptions);
    const contents = readFileSync(source, "utf8");
    for (const specifier of relativeModuleSpecifiers(contents, source)) {
      const imported = resolve(dirname(source), specifier);
      if (isPathInside(scriptsRoot, imported)) pending.push(imported);
      else if (!isRuntimePackageModule(repoRoot, imported)) {
        throw new Error(`Benchmark runner import escapes or is missing from scripts: ${imported}`);
      }
    }
  }
}

function isRuntimePackageModule(repoRoot, path) {
  return (
    path.endsWith(".js") &&
    existsSync(path) &&
    runtimePackages.some((pkg) => isPathInside(join(repoRoot, "packages", pkg, "dist"), path))
  );
}

function relativeModuleSpecifiers(contents, source) {
  const parsed = ts.createSourceFile(source, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const specifiers = [];
  const visit = (node) => {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) {
        throw new Error(`Benchmark runner contains a non-literal dynamic import: ${source}`);
      }
    }
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
      specifiers.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

function copyPublishedRuntimeExtras(repoRoot, snapshot, copyOptions) {
  const codeIndexSource = join(repoRoot, "packages", "code-index");
  const codeIndexTarget = join(snapshot, "packages", "code-index");
  for (const entry of readdirSync(codeIndexSource)) {
    if (!entry.endsWith(".py") && !entry.startsWith("requirements")) continue;
    cpSync(join(codeIndexSource, entry), join(codeIndexTarget, entry), copyOptions);
  }
  for (const directory of ["benchmarks", "embedding_backends"]) {
    const source = join(codeIndexSource, directory);
    if (existsSync(source)) cpSync(source, join(codeIndexTarget, directory), copyOptions);
  }
  const nativeSource = join(repoRoot, "packages", "tui", "native");
  if (existsSync(nativeSource)) {
    cpSync(nativeSource, join(snapshot, "packages", "tui", "native"), copyOptions);
  }
  const extensionExamplesSource = join(repoRoot, "packages", "coding-agent", "examples", "extensions");
  if (existsSync(extensionExamplesSource)) {
    cpSync(
      extensionExamplesSource,
      join(snapshot, "packages", "coding-agent", "examples", "extensions"),
      copyOptions,
    );
  }
}

function listEntries(root, current = root) {
  const paths = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...listEntries(root, path));
    else paths.push(relative(root, path));
  }
  return paths.toSorted();
}

function assertSnapshotSymlinksContained(snapshot) {
  const snapshotPath = resolve(snapshot);
  const snapshotRoot = realpathSync(snapshotPath);
  for (const relativePath of listEntries(snapshot)) {
    const path = join(snapshot, relativePath);
    if (!lstatSync(path).isSymbolicLink()) continue;
    // Preserve workspace links only when every copied link points back into the
    // immutable tree; links to the live checkout or other host state fail closed.
    const target = resolve(dirname(path), readlinkSync(path));
    if (!isPathInside(snapshotPath, target)) {
      throw new Error(`Runtime symlink escapes immutable runtime snapshot: ${relativePath}`);
    }
    if (!existsSync(target)) {
      throw new Error(`Runtime symlink is unresolved inside immutable runtime snapshot: ${relativePath}`);
    }
    if (!isPathInside(snapshotRoot, realpathSync(target))) {
      throw new Error(`Runtime symlink resolves outside immutable runtime snapshot: ${relativePath}`);
    }
  }
}

function isPathInside(root, path) {
  const targetRelative = relative(root, path);
  return targetRelative !== ".." && !targetRelative.startsWith(`..${sep}`) && !isAbsolute(targetRelative);
}

export function hashRuntimeSnapshot(snapshot, nodeExecutable) {
  const hash = createHash("sha256");
  for (const relativePath of listEntries(snapshot)) {
    const path = join(snapshot, relativePath);
    hash.update(relativePath);
    hash.update("\0");
    if (lstatSync(path).isSymbolicLink()) hash.update(`link:${readlinkSync(path)}`);
    else hash.update(readFileSync(path));
    hash.update("\0");
  }
  hash.update("node\0");
  hash.update(readFileSync(nodeExecutable));
  return hash.digest("hex");
}
