import { Minimatch } from "minimatch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchesAnyExactPattern, matchesAnyPattern } from "../src/core/package-manager/binary-resolution.ts";

interface NodePathModule {
  [key: string]: unknown;
  basename: (path: string, suffix?: string) => string;
  dirname: (path: string) => string;
  relative: (from: string, to: string) => string;
}

const pathSpies = vi.hoisted(() => ({
  basename: vi.fn<(path: string) => string>(),
  dirname: vi.fn<(path: string) => string>(),
  relative: vi.fn<(from: string, to: string) => string>(),
}));

vi.mock("node:path", async () => {
  const actual = await vi.importActual<NodePathModule>("node:path");
  pathSpies.basename.mockImplementation(actual.basename);
  pathSpies.dirname.mockImplementation(actual.dirname);
  pathSpies.relative.mockImplementation(actual.relative);
  return {
    ...actual,
    basename: pathSpies.basename,
    dirname: pathSpies.dirname,
    relative: pathSpies.relative,
  };
});

const baseDir = "/workspace/project";
const skillFile = "/workspace/project/skills/demo/SKILL.md";

describe("matchesAnyPattern lazy path derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not derive path representations when no patterns are supplied", () => {
    expect(matchesAnyPattern(skillFile, [], baseDir)).toBe(false);
    expect(pathSpies.relative).not.toHaveBeenCalled();
    expect(pathSpies.basename).not.toHaveBeenCalled();
    expect(pathSpies.dirname).not.toHaveBeenCalled();
  });

  it("stops after the relative path matches", () => {
    const patterns = [new Minimatch("skills/demo/SKILL.md")];

    expect(matchesAnyPattern(skillFile, patterns, baseDir)).toBe(true);
    expect(pathSpies.relative).toHaveBeenCalledTimes(1);
    expect(pathSpies.basename).not.toHaveBeenCalled();
    expect(pathSpies.dirname).not.toHaveBeenCalled();
  });

  it("stops after the basename matches", () => {
    const patterns = [new Minimatch("SKILL.md")];

    expect(matchesAnyPattern(skillFile, patterns, baseDir)).toBe(true);
    expect(pathSpies.relative).toHaveBeenCalledTimes(1);
    expect(pathSpies.basename).toHaveBeenCalledTimes(1);
    expect(pathSpies.dirname).not.toHaveBeenCalled();
  });

  it("stops after the absolute path matches", () => {
    const patterns = [new Minimatch(skillFile)];

    expect(matchesAnyPattern(skillFile, patterns, baseDir)).toBe(true);
    expect(pathSpies.relative).toHaveBeenCalledTimes(1);
    expect(pathSpies.basename).toHaveBeenCalledTimes(1);
    expect(pathSpies.dirname).not.toHaveBeenCalled();
  });

  it("defers parent derivation until direct path forms miss", () => {
    const patterns = [new Minimatch("skills/demo")];

    expect(matchesAnyPattern(skillFile, patterns, baseDir)).toBe(true);
    expect(pathSpies.relative).toHaveBeenCalledTimes(2);
    expect(pathSpies.basename).toHaveBeenCalledTimes(1);
    expect(pathSpies.dirname).toHaveBeenCalledTimes(1);
  });

  it("defers parent basename derivation until the parent relative path misses", () => {
    const patterns = [new Minimatch("demo")];

    expect(matchesAnyPattern(skillFile, patterns, baseDir)).toBe(true);
    expect(pathSpies.relative).toHaveBeenCalledTimes(2);
    expect(pathSpies.basename).toHaveBeenCalledTimes(2);
    expect(pathSpies.dirname).toHaveBeenCalledTimes(1);
  });

  it("defers the absolute parent path until earlier parent forms miss", () => {
    const patterns = [new Minimatch("/workspace/project/skills/demo")];

    expect(matchesAnyPattern(skillFile, patterns, baseDir)).toBe(true);
    expect(pathSpies.relative).toHaveBeenCalledTimes(2);
    expect(pathSpies.basename).toHaveBeenCalledTimes(2);
    expect(pathSpies.dirname).toHaveBeenCalledTimes(1);
  });
});

describe("matchesAnyExactPattern", () => {
  it.each([
    ["absolute path", skillFile],
    ["relative path", "skills/demo/SKILL.md"],
    ["skill parent", "skills/demo"],
  ])("matches a %s", (_description, pattern) => {
    expect(matchesAnyExactPattern(skillFile, new Set([pattern]), baseDir)).toBe(true);
  });

  it("returns false for empty patterns", () => {
    expect(matchesAnyExactPattern(skillFile, new Set(), baseDir)).toBe(false);
  });

  it.each([
    ["wrong absolute path", "/workspace/project/skills/other/SKILL.md", skillFile],
    ["wrong relative path", "skills/other/SKILL.md", skillFile],
    ["basename-only pattern", "SKILL.md", skillFile],
    ["parent pattern for a non-skill file", "skills/demo", "/workspace/project/skills/demo/config.json"],
  ])("rejects a %s", (_description, pattern, path) => {
    expect(matchesAnyExactPattern(path, new Set([pattern]), baseDir)).toBe(false);
  });
});
