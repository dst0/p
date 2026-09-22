import { describe, expect, it } from "vitest";
import {
  classifyEffectPath,
  effectEscalation,
  pathsAreLightCompatible,
} from "../src/core/task-verification/task-tier.ts";

describe("verification effect escalation", () => {
  it.each([
    ["src/a.ts", "source"],
    ["./lib/util.py", "source"],
    ["scripts/build.sh", "source"],
    ["docs/conf.py", "source"],
    ["src\\win\\path.ts", "source"],
    ["src/a.test.ts", "test"],
    ["test/a.test.ts", "test"],
    ["__tests__/parser.js", "test"],
    ["test_parser.py", "test"],
    ["pkg/range_test.go", "test"],
    ["package.json", "config"],
    ["packages/x/tsconfig.build.json", "config"],
    ["requirements-dev.txt", "config"],
    [".github/workflows/ci.yml", "config"],
    ["Dockerfile.dev", "config"],
    ["Makefile", "config"],
    ["README.md", "docs"],
    ["docs/guide.md", "docs"],
    ["docs/diagram.svg", "docs"],
    ["notes.txt", "docs"],
    ["tests/fixtures/data.json", "other"],
    ["data.json", "other"],
    ["poem", "other"],
    ["node_modules/x/index.js", "other"],
    ["dist/a.js", "other"],
    ["packages/x/dist/a.js", "other"],
    ["build/static/main.js", "other"],
    ["out/index.js", "other"],
    ["vendor/lib.go", "other"],
    ["src/build/index.ts", "source"],
    ["tools/vendor/patch.py", "source"],
    ["build.ts", "source"],
  ] as const)("classifies %s as %s", (path, expected) => {
    expect(classifyEffectPath(path)).toBe(expected);
  });

  it("escalates on the first source, then test, then config path in priority order", () => {
    expect(effectEscalation(["README.md", "package.json", "src/a.test.ts", "src/a.ts"])).toEqual({
      tier: "strict",
      reason: "effect_source",
      trigger: "src/a.ts",
    });
    expect(effectEscalation(["package.json", "src/a.test.ts"])).toMatchObject({
      reason: "effect_test",
      trigger: "src/a.test.ts",
    });
    expect(effectEscalation(["README.md", "package.json"])).toMatchObject({
      reason: "effect_config",
      trigger: "package.json",
    });
  });

  it("keeps docs-only, data, generated, and empty ledgers LIGHT", () => {
    expect(effectEscalation(["README.md", "docs/guide.md", "notes.txt", "data.json"])).toBeUndefined();
    expect(effectEscalation(["node_modules/pkg/index.js", "dist/bundle.js", "tests/fixtures/x.json"])).toBeUndefined();
    expect(effectEscalation([])).toBeUndefined();
  });

  it("reports whether a ledger stays LIGHT-compatible", () => {
    expect(pathsAreLightCompatible([])).toBe(true);
    expect(pathsAreLightCompatible(["README.md", "out.json"])).toBe(true);
    expect(pathsAreLightCompatible(["README.md", "src/a.ts"])).toBe(false);
    expect(pathsAreLightCompatible(["package.json"])).toBe(false);
  });
});
