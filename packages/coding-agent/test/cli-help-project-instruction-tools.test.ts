import { afterEach, describe, expect, it, vi } from "vitest";
import { printHelp } from "../src/cli/args.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI help for built-in project instruction tools", () => {
  it("advertises project discovery, readers, and image generation names accepted by --tools", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => output.push(String(value)));

    printHelp();

    expect(output.join("\n")).toContain("list_skills");
    expect(output.join("\n")).toContain("read_rules");
    expect(output.join("\n")).toContain("read_skills");
    expect(output.join("\n")).toContain("generate_image");
  });
});
