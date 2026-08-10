import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

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
});
