import { describe, expect, it, vi } from "vitest";
import { parseArgs, printHelp } from "../src/cli/args.ts";
import type { TaskVerificationMode } from "../src/index.ts";
import { buildSessionOptions } from "../src/main/runtime-init.ts";

describe("task verification mode CLI", () => {
  it("exports the mode type from the public SDK", () => {
    const publicModes: TaskVerificationMode[] = ["evidence", "audit", "off"];
    expect(publicModes).toEqual(["evidence", "audit", "off"]);
  });

  it.each(["auto", "light", "strict", "off", "evidence", "audit"] as const)("parses %s", (mode) => {
    expect(parseArgs(["--task-verification", mode]).taskVerificationMode).toBe(mode);
  });

  it("reports invalid and missing values as startup errors", () => {
    const message = "--task-verification requires one of: auto, light, strict, off, evidence, audit";
    expect(parseArgs(["--task-verification", "full"]).diagnostics).toContainEqual({ type: "error", message });
    expect(parseArgs(["--task-verification"]).diagnostics).toContainEqual({ type: "error", message });
    expect(parseArgs(["--task-verification", "--print"]).diagnostics).toContainEqual({ type: "error", message });
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

  it("documents auto as the default and the legacy engine selections", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printHelp();
      const help = log.mock.calls[0]?.[0];
      expect(help).toContain(
        "--task-verification <mode>     Verification: auto (default: light, strict for code+tests), light, strict, off;",
      );
      expect(help).toContain("evidence/audit force strict with that engine (audit is experimental)");
    } finally {
      log.mockRestore();
    }
  });
});
