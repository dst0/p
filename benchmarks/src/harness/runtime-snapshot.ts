import { createHash } from "node:crypto";
import {
  type CopySyncOptions,
  cpSync,
  existsSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];
const BENCHMARK_SOURCE_ROOT = join("benchmarks", "src");
const BENCHMARK_RUNNER = join(BENCHMARK_SOURCE_ROOT, "run-agents.ts");
const BENCHMARK_PROJECT_INSTRUCTION_PROBE = join(BENCHMARK_SOURCE_ROOT, "project-instructions", "probe.ts");
const BENCHMARK_SEED_HELPER = join(BENCHMARK_SOURCE_ROOT, "project-instructions", "seed.ts");
const BENCHMARK_CLOSURE_SEEDS = [
  BENCHMARK_RUNNER,
  join(BENCHMARK_SOURCE_ROOT, "run-project-instructions.ts"),
  BENCHMARK_PROJECT_INSTRUCTION_PROBE,
  BENCHMARK_SEED_HELPER,
  join(BENCHMARK_SOURCE_ROOT, "harness", "seed-helper-process.ts"),
];
const EVALUATOR_FIXTURE_NAMES = new Set(["hidden.test.ts", "rubric.json"]);

export type BenchmarkFixtureScope = "all" | "candidate" | "evaluator";

export interface RuntimeSnapshotOptions {
  fixtureScope?: BenchmarkFixtureScope;
}

export function assertEmptyOutputDirectory(path: string): void {
  if (existsSync(path) && readdirSync(path).length > 0) throw new Error(`Output directory is not empty: ${path}`);
}

export function createRuntimeSnapshot(
  repoRoot: string,
  temporaryParent: string,
  options: RuntimeSnapshotOptions = {},
): string {
  const snapshot = mkdtempSync(join(temporaryParent, "p-benchmark-runtime-"));
  try {
    const copyOptions = { mode: fsConstants.COPYFILE_FICLONE, recursive: true, verbatimSymlinks: true };
    cpSync(join(repoRoot, "node_modules"), join(snapshot, "node_modules"), copyOptions);
    cpSync(join(repoRoot, "package.json"), join(snapshot, "package.json"), copyOptions);
    cpSync(join(repoRoot, "package-lock.json"), join(snapshot, "package-lock.json"), copyOptions);
    snapshotBenchmarkRunnerClosure(repoRoot, snapshot, copyOptions);
    copyBenchmarkFixtures(repoRoot, snapshot, options.fixtureScope ?? "all", copyOptions);
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

export function createCandidateRuntimeSnapshot(repoRoot: string, temporaryParent: string): string {
  return createRuntimeSnapshot(repoRoot, temporaryParent, { fixtureScope: "candidate" });
}

export function copyBenchmarkEvaluatorFixtures(
  repoRoot: string,
  destination: string,
  copyOptions: CopySyncOptions = {},
): void {
  copyBenchmarkFixtures(repoRoot, destination, "evaluator", copyOptions);
}

function copyBenchmarkFixtures(
  repoRoot: string,
  destination: string,
  scope: BenchmarkFixtureScope,
  copyOptions: CopySyncOptions,
): void {
  const source = join(repoRoot, "benchmarks", "fixtures");
  const target = join(destination, "benchmarks", "fixtures");
  copyFixtureTree(source, target, scope, copyOptions);
}

function copyFixtureTree(
  source: string,
  target: string,
  scope: BenchmarkFixtureScope,
  copyOptions: CopySyncOptions,
): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const evaluatorFixture = !entry.isDirectory() && EVALUATOR_FIXTURE_NAMES.has(entry.name);
    if (
      !entry.isDirectory() &&
      ((scope === "candidate" && evaluatorFixture) || (scope === "evaluator" && !evaluatorFixture))
    ) {
      continue;
    }
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      mkdirSync(dirname(targetPath), { recursive: true });
      symlinkSync(readlinkSync(sourcePath), targetPath);
    } else if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      copyFixtureTree(sourcePath, targetPath, scope, copyOptions);
    } else {
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(sourcePath, targetPath, copyOptions);
    }
  }
}

export function benchmarkRunnerPath(snapshot: string): string {
  return join(snapshot, BENCHMARK_RUNNER);
}

export function benchmarkSeedHelperPath(snapshot: string): string {
  return join(snapshot, BENCHMARK_SEED_HELPER);
}

export function benchmarkProjectInstructionProbePath(snapshot: string): string {
  return join(snapshot, BENCHMARK_PROJECT_INSTRUCTION_PROBE);
}

export function snapshotBenchmarkRunnerClosure(
  repoRoot: string,
  snapshot: string,
  copyOptions: CopySyncOptions = {},
): void {
  const sourceRoot = join(repoRoot, BENCHMARK_SOURCE_ROOT);
  const pending = BENCHMARK_CLOSURE_SEEDS.map((path) => join(repoRoot, path));
  const copied = new Set();
  while (pending.length > 0) {
    const source = pending.pop();
    if (source === undefined) break;
    if (copied.has(source)) continue;
    if (!isPathInside(sourceRoot, source) || !source.endsWith(".ts") || !existsSync(source)) {
      throw new Error(`Benchmark source import escapes or is missing from benchmarks/src: ${source}`);
    }
    copied.add(source);
    const destination = join(snapshot, BENCHMARK_SOURCE_ROOT, relative(sourceRoot, source));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, copyOptions);
    const contents = readFileSync(source, "utf8");
    for (const specifier of relativeModuleSpecifiers(contents, source)) {
      const imported = resolve(dirname(source), specifier);
      if (isPathInside(sourceRoot, imported)) pending.push(imported);
      else if (!isRuntimePackageModule(repoRoot, imported)) {
        throw new Error(`Benchmark source import escapes or is missing from benchmarks/src: ${imported}`);
      }
    }
  }
}

function isRuntimePackageModule(repoRoot: string, path: string): boolean {
  return (
    path.endsWith(".js") &&
    existsSync(path) &&
    runtimePackages.some((pkg) => isPathInside(join(repoRoot, "packages", pkg, "dist"), path))
  );
}

function relativeModuleSpecifiers(contents: string, source: string): string[] {
  const parsed = ts.createSourceFile(source, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    let specifier: ts.Expression | undefined;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      !isTypeOnlyModuleDeclaration(node)
    ) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error(`Benchmark source contains a dynamic import: ${source}`);
    }
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
      specifiers.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

function isTypeOnlyModuleDeclaration(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    return (
      node.isTypeOnly ||
      (node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((element) => element.isTypeOnly))
    );
  }
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return (
    clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function copyPublishedRuntimeExtras(repoRoot: string, snapshot: string, copyOptions: CopySyncOptions): void {
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
    cpSync(extensionExamplesSource, join(snapshot, "packages", "coding-agent", "examples", "extensions"), copyOptions);
  }
}

function listEntries(root: string, current = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...listEntries(root, path));
    else paths.push(relative(root, path));
  }
  return paths.sort();
}

export function assertSnapshotSymlinksContained(snapshot: string): void {
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

function isPathInside(root: string, path: string): boolean {
  const targetRelative = relative(root, path);
  return targetRelative !== ".." && !targetRelative.startsWith(`..${sep}`) && !isAbsolute(targetRelative);
}

function createSnapshotHash(snapshot: string): ReturnType<typeof createHash> {
  const hash = createHash("sha256");
  for (const relativePath of listEntries(snapshot)) {
    const path = join(snapshot, relativePath);
    hash.update(relativePath);
    hash.update("\0");
    if (lstatSync(path).isSymbolicLink()) hash.update(`link:${readlinkSync(path)}`);
    else hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash;
}

export function hashRuntimeSnapshot(snapshot: string, nodeExecutable: string): string {
  const hash = createSnapshotHash(snapshot);
  hash.update("node\0");
  hash.update(readFileSync(nodeExecutable));
  return hash.digest("hex");
}

export function hashSnapshotDirectory(snapshot: string): string {
  return createSnapshotHash(snapshot).digest("hex");
}
