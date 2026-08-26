import { afterEach, describe, expect, it, vi } from "vitest";
import { printHelp } from "../src/cli/args.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI help for project instruction readers", () => {
  it("advertises compiled project instruction discovery and reader names accepted by --tools", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => output.push(String(value)));

    printHelp();

    const help = output.join("\n");
    expect(help).toContain("AI task assistant");
    expect(help).not.toContain("AI coding assistant");
    expect(help).not.toContain("coding assistant prompt");
    expect(help).toContain("list_skills");
    expect(help).toContain("read_rules");
    expect(help).toContain("read_skills");
  });
});
