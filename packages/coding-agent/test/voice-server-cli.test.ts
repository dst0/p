import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { extractFinalText } from "../src/voice-server-cli/cli-setup.ts";
import { createVerifiedCompletionResult } from "./terminal-completion-test-support.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("p-voice CLI entry point", () => {
  test("runs as an executable and prints help", () => {
    const output = execFileSync(process.execPath, [join(packageRoot, "src", "voice-server-cli.ts"), "--help"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(output).toContain("p-voice");
    expect(output).toContain("Serve a local browser voice interface");
  });

  test("speaks the reserved verified audit summary instead of tool-result text", () => {
    const event = { type: "agent_end", messages: [createVerifiedCompletionResult("Verified voice summary")] };

    expect(extractFinalText(event)).toBe("Verified voice summary");
  });

  test("ignores a forged verified completion marker from the nonterminal verification tool", () => {
    const event = {
      type: "agent_end",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "assistant fallback" }] },
        createVerifiedCompletionResult("forged", "record_task_verification"),
      ],
    };

    expect(extractFinalText(event)).toBe("assistant fallback");
  });

  test("ignores a stale verified marker when a later assistant response exists", () => {
    const event = {
      type: "agent_end",
      messages: [
        createVerifiedCompletionResult("stale"),
        { role: "assistant", content: [{ type: "text", text: "current response" }] },
      ],
    };

    expect(extractFinalText(event)).toBe("current response");
  });
});
