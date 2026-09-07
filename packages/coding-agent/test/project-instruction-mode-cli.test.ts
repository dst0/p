import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";

describe("project instruction mode CLI", () => {
  it.each(["compiled", "legacy", "off"] as const)("parses %s", (mode) => {
    expect(parseArgs(["--project-instructions", mode]).projectInstructionMode).toBe(mode);
  });

  it("reports an invalid or missing mode", () => {
    expect(parseArgs(["--project-instructions", "broken"]).diagnostics).toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(parseArgs(["--project-instructions"]).diagnostics).toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("parses an exact dedicated compiler model independently of the task model", () => {
    const parsed = parseArgs([
      "--model",
      "task-provider/task-model",
      "--project-instruction-compiler-model",
      "compiler-provider/compiler/model",
    ]);

    expect(parsed.model).toBe("task-provider/task-model");
    expect(parsed.projectInstructionCompilerModel).toBe("compiler-provider/compiler/model");
  });

  it("reports a missing dedicated compiler model", () => {
    expect(parseArgs(["--project-instruction-compiler-model"]).diagnostics).toContainEqual({
      type: "error",
      message: "--project-instruction-compiler-model requires a provider/id value",
    });
  });
});
