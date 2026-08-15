import { describe, expect, it, vi } from "vitest";
import { runCliMain } from "../src/cli.ts";

describe("CLI entrypoint error handling and exit codes", () => {
  it("catches fatal CLI errors and exits with code 1", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null | undefined) => {
      throw new Error(`process.exit: ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(runCliMain(["node", "cli.ts", "--unknown-flag"])).rejects.toThrow("process.exit: 1");
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
