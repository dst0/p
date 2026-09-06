import { describe, expect, it } from "vitest";
import { focusedTestInvocation } from "../src/core/task-verification/taskverificationcontroller-methods/test-command-invocation.ts";
import {
  focusedRequirementSelectors,
  testInvocationCovers,
  testInvocationSelection,
} from "../src/core/task-verification/taskverificationcontroller-methods/test-invocation-selection.ts";

function invocation(command: string) {
  const parsed = focusedTestInvocation(command);
  expect(parsed, command).toBeDefined();
  return parsed!;
}

describe("focused test selector authority", () => {
  it.each(["jest --runTestsByPath=./test/inventory.test.ts:18:2 --no-color", "vitest run -- test/inventory.test.ts"])(
    "normalizes the selected test location without losing file identity: %s",
    (command) => {
      const parsed = invocation(command);

      expect(focusedRequirementSelectors(parsed)).toEqual(["inventory.test.ts"]);
      expect(testInvocationSelection(parsed)).toEqual({
        broad: false,
        pathGlobs: [],
        pathSelectors: ["test/inventory.test.ts"],
        testNames: [],
        vacuous: false,
      });
    },
  );

  it.each([
    "jest --runTestsByPath src/inventory.ts",
    "jest --runTestsByPath test/*.test.ts",
    "vitest run test/inventory.test.ts --config custom.config.js",
    "vitest run test/inventory.test.ts --passWithNoTests",
    "vitest run test/inventory.test.ts -t 'inventory|all'",
    "vitest run test/inventory.test.ts -t '.*'",
    "vitest run test/inventory.test.ts -t",
  ])("withholds requirement evidence from unresolved or empty selections: %s", (command) => {
    const parsed = invocation(command);

    expect(focusedRequirementSelectors(parsed)).toBeUndefined();
    expect(testInvocationSelection(parsed)).toMatchObject({ broad: false, vacuous: true });
    expect(testInvocationCovers(parsed, invocation("vitest run test/inventory.test.ts"))).toBe(false);
  });

  it("uses one concrete case selector while refusing to attribute a multi-case selection to one requirement", () => {
    const command = "vitest run test/inventory.test.ts --test-name-pattern='^inventory preserves quantity$'";
    expect(focusedRequirementSelectors(invocation(command))).toEqual(["^inventory preserves quantity$"]);
    expect(
      focusedRequirementSelectors(invocation(`${command} -t 'inventory rejects negative quantity'`)),
    ).toBeUndefined();
  });

  it("requires the same selected case before broader path coverage can replace previous evidence", () => {
    const passed = invocation("vitest run 'test/**/*.test.ts' -t 'inventory preserves quantity'");
    const failed = invocation("vitest run test/inventory.test.ts -t 'inventory rejects negative quantity'");

    expect(testInvocationCovers(passed, failed)).toBe(false);
    expect(
      testInvocationCovers(passed, invocation("vitest run test/inventory.test.ts -t 'inventory preserves quantity'")),
    ).toBe(true);
  });
});
