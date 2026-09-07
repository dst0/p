import { describe, expect, it, vi } from "vitest";
import { createWriteTool } from "../src/core/tools/write.ts";

describe("rootless cwd-qualified write paths", () => {
  it("fails before creating directories or writing content", async () => {
    const mkdir = vi.fn(async () => {});
    const writeFile = vi.fn(async () => {});
    const cwd = "/private/var/folders/example/workspace";
    const tool = createWriteTool(cwd, { operations: { mkdir, writeFile } });

    await expect(
      tool.execute("rootless-write", {
        path: "private/var/folders/example/workspace/src/index.ts",
        content: "export const nested = false;\n",
      }),
    ).rejects.toThrow(/leading root separator is missing/iu);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
