import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const MAX_LINES = 300;
const MAX_CLASSES = 1;
const SOURCE_EXTENSIONS = new Set([".cs", ".go", ".java", ".js", ".jsx", ".py", ".rs", ".swift", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".build",
  ".git",
  ".pytest_cache",
  "__pycache__",
  "coverage",
  "dist",
  "fixtures",
  "node_modules",
  "vendor",
]);

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repositoryRoot, "scripts", "file-structure-baseline.json");

function collectSourceFiles(directory, files) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) collectSourceFiles(path.join(directory, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(extension) || entry.name.endsWith(".d.ts") || entry.name.includes(".generated.")) continue;
    files.push(path.join(directory, entry.name));
  }
}

function countPhysicalLines(source) {
  if (source.length === 0) return 0;
  const newlineCount = source.match(/\n/g)?.length ?? 0;
  return newlineCount + (source.endsWith("\n") ? 0 : 1);
}

function countTypeScriptClasses(filePath, source) {
  const scriptKind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  let count = 0;
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function countClasses(filePath, source) {
  const extension = path.extname(filePath);
  if ([".js", ".jsx", ".ts", ".tsx"].includes(extension)) return countTypeScriptClasses(filePath, source);
  const patterns = {
    ".cs": /^\s*(?:(?:public|private|protected|internal|abstract|sealed|static|partial)\s+)*class\s+/gm,
    ".java": /^\s*(?:(?:public|private|protected|abstract|final|static|sealed)\s+)*class\s+/gm,
    ".py": /^\s*class\s+/gm,
    ".swift": /^\s*(?:(?:public|private|internal|open|final)\s+)*class\s+/gm,
  };
  return patterns[extension]?.[Symbol.match](source)?.length ?? 0;
}

function inspectFiles() {
  const files = [];
  collectSourceFiles(path.join(repositoryRoot, "packages"), files);
  collectSourceFiles(path.join(repositoryRoot, "scripts"), files);
  return files.sort().map((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    return {
      classes: countClasses(filePath, source),
      file: path.relative(repositoryRoot, filePath),
      lines: countPhysicalLines(source),
    };
  });
}

const inspections = inspectFiles();
if (process.argv.includes("--print-baseline")) {
  const baseline = Object.fromEntries(
    inspections
      .filter(({ classes, lines }) => classes > MAX_CLASSES || lines > MAX_LINES)
      .map(({ classes, file, lines }) => [file, { classes, lines }]),
  );
  console.log(`${JSON.stringify(baseline, null, 2)}\n`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const failures = [];
const inspectedPaths = new Set(inspections.map(({ file }) => file));
for (const inspection of inspections) {
  const allowance = baseline[inspection.file];
  const allowedLines = allowance?.lines ?? MAX_LINES;
  const allowedClasses = allowance?.classes ?? MAX_CLASSES;
  if (inspection.lines > allowedLines) {
    failures.push(`${inspection.file}: ${inspection.lines} lines exceeds ${allowedLines}`);
  } else if (allowance && inspection.lines < allowedLines && inspection.lines > MAX_LINES) {
    failures.push(`${inspection.file}: tighten baseline lines from ${allowedLines} to ${inspection.lines}`);
  }
  if (inspection.classes > allowedClasses) {
    failures.push(`${inspection.file}: ${inspection.classes} classes exceeds ${allowedClasses}`);
  } else if (allowance && inspection.classes < allowedClasses && inspection.classes > MAX_CLASSES) {
    failures.push(`${inspection.file}: tighten baseline classes from ${allowedClasses} to ${inspection.classes}`);
  }
  if (allowance && inspection.lines <= MAX_LINES && inspection.classes <= MAX_CLASSES) {
    failures.push(`${inspection.file}: remove the now-stale baseline entry`);
  }
}
for (const file of Object.keys(baseline)) {
  if (!inspectedPaths.has(file)) failures.push(`${file}: remove the baseline entry for the missing or excluded file`);
}

if (failures.length > 0) {
  console.error(`File structure check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`File structure check passed for ${inspections.length} source files.`);
