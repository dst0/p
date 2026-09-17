import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tsconfigPath = join(repoRoot, "benchmarks", "tsconfig.json");
const bindingPath = join(repoRoot, "benchmarks", "src", "project-instructions", "coding-agent-runtime-bindings.ts");

function parseBenchmarkConfig(): ts.ParsedCommandLine {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfigPath), {}, tsconfigPath);
  assert.deepEqual(parsed.errors, []);
  return parsed;
}

function directCodingAgentDistImports(parsed: ts.ParsedCommandLine): string[] {
  const imports: string[] = [];
  for (const path of parsed.fileNames.filter((file) => file.includes(`${sep}benchmarks${sep}`))) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      if (statement.moduleSpecifier.text.includes("packages/coding-agent/dist/") && path !== bindingPath) {
        imports.push(`${path}:${statement.moduleSpecifier.text}`);
      }
    }
  }
  return imports.sort();
}

function bindingContractIssues(): string[] {
  const source = ts.createSourceFile(
    bindingPath,
    readFileSync(bindingPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const runtimeImports = new Map<string, string>();
  const sourceImports = new Map<string, string>();
  const authorityCasts = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const namespace = statement.importClause?.namedBindings;
      if (!namespace || !ts.isNamespaceImport(namespace)) continue;
      const imports = statement.importClause?.isTypeOnly ? sourceImports : runtimeImports;
      imports.set(namespace.name.text, statement.moduleSpecifier.text);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const outer = declaration.initializer;
      if (!outer || !ts.isAsExpression(outer) || !ts.isTypeQueryNode(outer.type)) continue;
      const inner = outer.expression;
      if (!ts.isAsExpression(inner) || inner.type.kind !== ts.SyntaxKind.UnknownKeyword) continue;
      if (!ts.isIdentifier(inner.expression) || !ts.isIdentifier(outer.type.exprName)) continue;
      authorityCasts.add(`${inner.expression.text}:${outer.type.exprName.text}`);
    }
  }

  const issues: string[] = [];
  for (const [runtimeName, runtimeSpecifier] of runtimeImports) {
    if (!runtimeSpecifier.includes("packages/coding-agent/dist/")) continue;
    const expectedSourceSpecifier = runtimeSpecifier.replace("/dist/", "/src/").replace(/\.js$/u, ".ts");
    const expectedSourceName = runtimeName.replace(/Runtime$/u, "Source");
    if (sourceImports.get(expectedSourceName) !== expectedSourceSpecifier) {
      issues.push(`${runtimeName} lacks type-only ${expectedSourceName} from ${expectedSourceSpecifier}`);
    }
    if (!authorityCasts.has(`${runtimeName}:${expectedSourceName}`)) {
      issues.push(`${runtimeName} lacks an unknown-to-typeof-${expectedSourceName} authority cast`);
    }
  }
  if (runtimeImports.size === 0) issues.push("binding has no runtime namespace imports");
  return issues.sort();
}

test("benchmark declarations remain source-authoritative when runtime dist declarations are stale", () => {
  const parsed = parseBenchmarkConfig();
  assert.deepEqual(directCodingAgentDistImports(parsed), []);
  assert.deepEqual(bindingContractIssues(), []);
});
