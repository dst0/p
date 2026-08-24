import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(rootDir, "package.json");

function readRootPackageJson() {
  const content = readFileSync(packageJsonPath, "utf8");
  return JSON.parse(content);
}

test("root check script explicitly scopes biome formatting to include packages/coding-agent", () => {
  const pkg = readRootPackageJson();
  assert.ok(pkg.scripts && typeof pkg.scripts.check === "string", "package.json must define a check script");

  const checkScript = pkg.scripts.check;
  const phases = checkScript.split("&&").map((phase) => phase.trim());
  const biomePhase = phases.find((phase) => phase.startsWith("biome check"));

  assert.ok(biomePhase, "check script must contain a biome check phase");

  const tokens = biomePhase.split(/\s+/);
  assert.ok(tokens.includes("--write"), "biome check phase must include --write flag");
  assert.ok(tokens.includes("--error-on-warnings"), "biome check phase must include --error-on-warnings flag");
  assert.ok(tokens.includes("."), "biome check phase must explicitly include '.' as an input target");
  assert.ok(
    tokens.includes("packages/coding-agent"),
    "biome check phase must explicitly include 'packages/coding-agent' as an input target",
  );
  assert.equal(phases[0], biomePhase, "biome check phase must execute before subsequent gate checks");
});
