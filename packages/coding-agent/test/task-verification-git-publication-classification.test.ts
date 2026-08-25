import { describe, expect, it } from "vitest";
import {
  containsGitPublishCommand,
  isSafePublishCommandSequence,
} from "../src/core/task-verification/git-command-classification.ts";

describe("task-verification Git publication classification", () => {
  it("recognizes escaped shell words used by Git publication commands", () => {
    expect(containsGitPublishCommand(String.raw`git -C /tmp/review\ worktree push origin HEAD`)).toBe(true);
    expect(containsGitPublishCommand(String.raw`git -c "core.sshCommand=ssh \"quoted\"" push origin HEAD`)).toBe(true);
  });

  it("follows env option separators into a nested split-string command", () => {
    expect(containsGitPublishCommand("env -- git push origin HEAD")).toBe(true);
    expect(containsGitPublishCommand("env -- env -S 'git push origin HEAD'")).toBe(true);
  });

  it("does not classify incomplete wrappers, Git options, or read-only commands as publication", () => {
    expect(containsGitPublishCommand("env")).toBe(false);
    expect(containsGitPublishCommand("git --no-pager")).toBe(false);
    expect(containsGitPublishCommand("git -C /tmp/review status --short")).toBe(false);
  });

  it("accepts only publish operations and safe directory changes in a publish sequence", () => {
    expect(isSafePublishCommandSequence("git push origin HEAD")).toBe(true);
    expect(isSafePublishCommandSequence("cd /tmp/review && git commit -m 'verified' && git push")).toBe(true);
    expect(isSafePublishCommandSequence("env -S 'git push origin HEAD'")).toBe(true);
    expect(isSafePublishCommandSequence("node generator.js && git push")).toBe(false);
    expect(isSafePublishCommandSequence("git add . && git commit -m changed")).toBe(false);
    expect(isSafePublishCommandSequence("git push > publish.log")).toBe(false);
    expect(isSafePublishCommandSequence("git push $(node generator.js)")).toBe(false);
  });

  it("classifies nested shell publication without trusting nested mutations", () => {
    expect(containsGitPublishCommand("bash -c 'git push origin HEAD'")).toBe(true);
    expect(isSafePublishCommandSequence("bash -c 'git push origin HEAD'")).toBe(true);
    expect(containsGitPublishCommand("sh -c 'node generator.js && git push'")).toBe(true);
    expect(isSafePublishCommandSequence("sh -c 'node generator.js && git push'")).toBe(false);
  });
});
