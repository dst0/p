import { describe, expect, it, vi } from "vitest";
import { parseArgs, printHelp } from "../src/cli/args.ts";
import type { TaskVerificationMode } from "../src/index.ts";
import { buildSessionOptions } from "../src/main/runtime-init.ts";

describe("task verification mode CLI", () => {
  it("exports the mode type from the public SDK", () => {
    const publicModes: TaskVerificationMode[] = ["evidence", "audit", "off"];
    expect(publicModes).toEqual(["evidence", "audit", "off"]);
  });

  it.each(["evidence", "audit", "off"] as const)("parses %s", (mode) => {
    expect(parseArgs(["--task-verification", mode]).taskVerificationMode).toBe(mode);
  });

  it("reports invalid and missing values as startup errors", () => {
    expect(parseArgs(["--task-verification", "full"]).diagnostics).toContainEqual({
      type: "error",
      message: "--task-verification requires one of: evidence, audit, off",
    });
    expect(parseArgs(["--task-verification"]).diagnostics).toContainEqual({
      type: "error",
      message: "--task-verification requires one of: evidence, audit, off",
    });
  });

  it("passes the CLI selection into session options independently of other modes", () => {
    const parsed = parseArgs([
      "--task-verification",
      "audit",
      "--project-instructions",
      "legacy",
      "--completion-mode",
      "explicit",
    ]);
    const result = buildSessionOptions(parsed, "print", [], false, {} as never, {} as never);

    expect(result.options).toMatchObject({
      completionMode: "explicit_finish",
      projectInstructionMode: "legacy",
      taskVerificationMode: "audit",
    });
  });

  it("documents evidence as the default and audit as experimental", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printHelp();
      expect(log.mock.calls[0]?.[0]).toContain(
        "--task-verification <mode>     Task verification: evidence (default), audit (experimental), or off",
      );
    } finally {
      log.mockRestore();
    }
  });
});
