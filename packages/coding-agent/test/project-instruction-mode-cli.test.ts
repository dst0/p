import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { buildSessionOptions } from "../src/main/runtime-init.ts";

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

  it("parses valid startup deadline values including 0", () => {
    expect(parseArgs(["--project-instruction-startup-deadline", "0"]).projectInstructionStartupDeadline).toBe(0);
    expect(parseArgs(["--project-instruction-startup-deadline", "15"]).projectInstructionStartupDeadline).toBe(15);
  });

  it("defaults cold-start compilation to 12 seconds independently of task thinking", () => {
    const defaultOptions = buildSessionOptions(parseArgs([]), "print", [], false, {} as never, {} as never);
    expect(defaultOptions.options.projectInstructionStartupDeadline).toBe(12);

    const parsed = parseArgs(["--thinking", "high", "--project-instruction-startup-deadline", "0"]);
    const explicitOptions = buildSessionOptions(parsed, "print", [], false, {} as never, {} as never);
    expect(explicitOptions.options.projectInstructionStartupDeadline).toBe(0);
    expect(explicitOptions.options.thinkingLevel).toBe("high");
  });

  it("reports invalid startup deadline values", () => {
    expect(parseArgs(["--project-instruction-startup-deadline", "-1"]).diagnostics).toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(parseArgs(["--project-instruction-startup-deadline", "abc"]).diagnostics).toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(parseArgs(["--project-instruction-startup-deadline"]).diagnostics).toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
    expect(parseArgs(["--project-instruction-startup-deadline", "2147484"]).diagnostics).toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
  });
});
