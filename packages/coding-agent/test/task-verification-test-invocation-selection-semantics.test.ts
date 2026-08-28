import { describe, expect, it } from "vitest";
import {
  commandContainsTestInvocation,
  focusedTestInvocation,
  type TestCommandInvocation,
} from "../src/core/task-verification/taskverificationcontroller-methods/test-command-invocation.ts";
import {
  focusedRequirementSelectors,
  hasPositivePassingTestResult,
  testInvocationCovers,
  testInvocationSelection,
} from "../src/core/task-verification/taskverificationcontroller-methods/test-invocation-selection.ts";

function javascriptInvocation(args: string[], overrides: Partial<TestCommandInvocation> = {}): TestCommandInvocation {
  return {
    args,
    allowsBareName: false,
    ecosystem: "javascript",
    workingDirectories: [],
    ...overrides,
  };
}

describe("task verification test invocation parsing", () => {
  it("unwraps environment, command, timeout, time, and package-manager options without losing selectors", () => {
    const invocation = focusedTestInvocation(
      "cd /workspace && env -u OLD FEATURE=1 command -- timeout -k 1s 30s time -f %E npm --workspace @scope/pkg test -- --runTestsByPath ./test/parser.test.ts -t 'handles quotes'",
    );

    expect(invocation).toEqual({
      args: ["--runTestsByPath", "./test/parser.test.ts", "-t", "handles quotes"],
      allowsBareName: false,
      ecosystem: "javascript",
      scopeNarrowed: true,
      workingDirectories: ["/workspace"],
    });
  });

  it("recognizes nested shell and lean-ctx payloads among unrelated shell commands", () => {
    const command = "printf prepare; lean-ctx --command \"bash -lc 'python3 -m pytest -k parser test_parser.py'\"";

    expect(commandContainsTestInvocation(command)).toBe(true);
    expect(focusedTestInvocation("lean-ctx -c 'npx --package vitest vitest run test/parser.test.ts'")).toMatchObject({
      args: ["test/parser.test.ts"],
      ecosystem: "javascript",
    });
  });

  it.each([
    "env -u",
    "timeout --signal",
    "time --output",
    "bash -c",
    "lean-ctx --command",
    "npm exec eslint test/parser.test.ts",
  ])("rejects incomplete or non-test wrapper command: %s", (command) => {
    expect(focusedTestInvocation(command)).toBeUndefined();
    expect(commandContainsTestInvocation(command)).toBe(false);
  });

  it("normalizes package-runner separators and direct runner subcommands", () => {
    expect(focusedTestInvocation("npm exec vitest -- run test/parser.test.ts --no-color")).toMatchObject({
      args: ["test/parser.test.ts", "--no-color"],
      scopeNarrowed: false,
    });
    expect(focusedTestInvocation("pnpm --filter parser run test:unit -- test/parser.test.ts")).toMatchObject({
      args: ["test/parser.test.ts"],
      scopeNarrowed: true,
    });
  });

  it.each([
    ["pytest test_parser.py", "python", false],
    ["python -m unittest test_parser.py", "python", false],
    ["./test.sh", "project", false],
    ["cargo test parser_case", "rust", true],
    ["go test ./parser", "go", false],
    ["node --test test/parser.test.ts", "javascript", false],
    ["node ../../node_modules/vitest/dist/cli.js run test/parser.test.ts", "javascript", false],
  ] as const)("classifies the direct runner ecosystem for %s", (command, ecosystem, allowsBareName) => {
    expect(focusedTestInvocation(command)).toMatchObject({ ecosystem, allowsBareName });
  });

  it("honors command and env separators while bounding recursive wrappers", () => {
    expect(focusedTestInvocation("FEATURE=1 command -p -- vitest run test/parser.test.ts")).toMatchObject({
      args: ["test/parser.test.ts"],
    });
    expect(focusedTestInvocation("command -v vitest")).toBeUndefined();
    expect(focusedTestInvocation("command -V vitest")).toBeUndefined();
    expect(focusedTestInvocation("env -C /repo npm test test/parser.test.ts")).toMatchObject({
      workingDirectories: ["/repo"],
    });
    expect(focusedTestInvocation("env -- jest test/parser.test.ts")).toMatchObject({ ecosystem: "javascript" });
    expect(focusedTestInvocation("")).toBeUndefined();
  });
});

describe("task verification test selector semantics", () => {
  it("accepts attached path and concrete regex-name options while normalizing locations", () => {
    const selection = testInvocationSelection(
      javascriptInvocation([
        "--runTestsByPath=./test/parser.test.ts:12:3",
        "--testNamePattern=parses alpha|parses beta",
      ]),
    );

    expect(selection).toEqual({
      broad: false,
      pathGlobs: [],
      pathSelectors: ["test/parser.test.ts"],
      testNames: ["parses alpha|parses beta"],
      vacuous: false,
    });
  });

  it.each([
    ["empty-matching regex", ["-t", ".*"]],
    ["generic alternatives", ["-t", "test|all"]],
    ["invalid regex", ["-t", "["]],
    ["unsafe wildcard", ["-t", "parser*branch"]],
    ["vacuous runner option", ["--passWithNoTests=true", "test/parser.test.ts"]],
    ["unknown option and value", ["--config", "test/parser.test.ts"]],
  ])("rejects %s selectors as vacuous", (_label, args) => {
    expect(testInvocationSelection(javascriptInvocation(args))).toMatchObject({ broad: false, vacuous: true });
  });

  it("distinguishes safe test globs from traversal and repository-wide globs", () => {
    expect(testInvocationSelection(javascriptInvocation(["test/**/*.test.ts"]))).toMatchObject({
      pathGlobs: ["test/**/*.test.ts"],
      vacuous: false,
    });
    expect(testInvocationSelection(javascriptInvocation(["test/../**/*.test.ts"]))).toMatchObject({ vacuous: true });
    expect(testInvocationSelection(javascriptInvocation(["**/*.test.ts"]))).toMatchObject({ vacuous: true });
  });

  it("treats the option separator as positional and recognizes a broad unfiltered run", () => {
    expect(testInvocationSelection(javascriptInvocation(["--", "test/parser.test.ts"]))).toMatchObject({
      pathSelectors: ["test/parser.test.ts"],
      vacuous: false,
    });
    expect(testInvocationSelection(javascriptInvocation([]))).toEqual({
      broad: true,
      pathGlobs: [],
      pathSelectors: [],
      testNames: [],
      vacuous: false,
    });
  });

  it("requires matching ecosystems, working directories, names, and concrete covered paths", () => {
    const glob = javascriptInvocation(["test/**/*.test.ts"], { workingDirectories: ["/repo"] });
    const focused = javascriptInvocation(["test/unit/parser.test.ts"], { workingDirectories: ["/repo"] });

    expect(testInvocationCovers(glob, focused)).toBe(true);
    expect(
      testInvocationCovers(glob, javascriptInvocation(["test/parser.test.ts"], { workingDirectories: ["/repo"] })),
    ).toBe(true);
    expect(testInvocationCovers(javascriptInvocation([], { workingDirectories: ["/repo"] }), focused)).toBe(true);
    expect(testInvocationCovers({ ...glob, ecosystem: "python" }, focused)).toBe(false);
    expect(testInvocationCovers({ ...glob, workingDirectories: ["/other"] }, focused)).toBe(false);
    expect(testInvocationCovers(javascriptInvocation(["-t", "parser branch"]), focused)).toBe(false);
    expect(
      testInvocationCovers(
        javascriptInvocation(["-t", "parser branch", "test/unit/parser.test.ts"]),
        javascriptInvocation(["-t", "other branch", "test/unit/parser.test.ts"]),
      ),
    ).toBe(false);
    expect(testInvocationCovers(focused, javascriptInvocation(["test/**/*.test.ts"]))).toBe(false);
    expect(
      testInvocationCovers(
        javascriptInvocation(["-t", "parser alpha", "-t", "parser beta", "test/unit/parser.test.ts"]),
        javascriptInvocation(["-t", "parser beta", "-t", "parser alpha", "test/unit/parser.test.ts"]),
      ),
    ).toBe(true);
  });

  it("matches recursive glob stars without requiring a directory separator", () => {
    const covering = javascriptInvocation(["test/**parser*.test.ts"]);

    expect(testInvocationCovers(covering, javascriptInvocation(["test/parser-core.test.ts"]))).toBe(true);
    expect(testInvocationCovers(covering, javascriptInvocation(["test/unit/parser-core.test.ts"]))).toBe(true);
    expect(testInvocationCovers(covering, javascriptInvocation(["test/unit/lexer.test.ts"]))).toBe(false);
  });

  it("derives exactly one requirement selector from a name, Cargo filter, or focused path", () => {
    expect(focusedRequirementSelectors(javascriptInvocation(["-t", "specific parser case"]))).toEqual([
      "specific parser case",
    ]);
    expect(
      focusedRequirementSelectors({
        args: ["parser_case"],
        allowsBareName: true,
        ecosystem: "rust",
        workingDirectories: [],
      }),
    ).toEqual(["parser_case"]);
    expect(focusedRequirementSelectors(javascriptInvocation(["test/unit/parser.test.ts"]))).toEqual(["parser.test.ts"]);
    expect(focusedRequirementSelectors(javascriptInvocation(["--runTestsByPath", "test/unit/parser.test.ts"]))).toEqual(
      ["parser.test.ts"],
    );
    expect(focusedRequirementSelectors(javascriptInvocation(["test/a.test.ts", "test/b.test.ts"]))).toBeUndefined();
    expect(
      focusedRequirementSelectors(javascriptInvocation(["test/a.test.ts"], { scopeNarrowed: true })),
    ).toBeUndefined();
  });

  it("accepts a substantive pass only when no failure or container-only summary contradicts it", () => {
    expect(hasPositivePassingTestResult("tests: 3 passed")).toBe(true);
    expect(hasPositivePassingTestResult("tests: 3 passed\ntests: 1 failed")).toBe(false);
    expect(hasPositivePassingTestResult("Test Files 1 passed (1)\nTests 0 passed (0)")).toBe(false);
  });
});
