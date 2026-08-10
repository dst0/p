import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exportFromFile = vi.hoisted(() => vi.fn());
vi.mock("../src/core/export-html/index.ts", () => ({ exportFromFile }));

import { handleExportCommand } from "../src/main/export-command.ts";

describe("export command", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing without an export request", async () => {
    await handleExportCommand({ export: undefined } as never);
    expect(exportFromFile).not.toHaveBeenCalled();
  });

  it("exports to the requested output and exits successfully", async () => {
    exportFromFile.mockResolvedValue("/tmp/session.html");
    await handleExportCommand({ export: "session.jsonl", messages: ["output.html"] } as never);
    expect(exportFromFile).toHaveBeenCalledWith("session.jsonl", "output.html");
    expect(console.log).toHaveBeenCalledWith("Exported to: /tmp/session.html");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("reports export failures and exits unsuccessfully", async () => {
    exportFromFile.mockRejectedValue(new Error("bad session"));
    await handleExportCommand({ export: "session.jsonl", messages: [] } as never);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("bad session"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
