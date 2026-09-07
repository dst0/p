import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyExactFileBytesAssertion } from "../src/core/task-verification/exact-file-assertion-classifier.ts";
import {
  exactFileAssertionMatchesCriterion,
  exactFileAssertionProvesCriterion,
} from "../src/core/task-verification/exact-file-criterion-matcher.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("exact file criterion matcher", () => {
  it("accepts canonical bytes with matching terminal-newline structure", () => {
    expect(
      proves("ready", 'status.txt has exact content with no trailing newline; exact_file_bytes("status.txt","ready")'),
    ).toBe(true);
    expect(
      proves(
        "ready\n",
        'status.txt has exact bytes with a terminal newline; exact_file_bytes("status.txt","ready\\n")',
      ),
    ).toBe(true);
  });

  it("keeps path-valued content after the line marker", () => {
    for (const firstLine of ["status.txt", "./status.txt"]) {
      expect(
        proves(
          `${firstLine}\nfoo\n`,
          `status.txt contains exactly the newline-terminated lines ${JSON.stringify(firstLine)} and "foo" in order`,
        ),
      ).toBe(true);
    }
  });

  it("binds the natural subject only before the external line marker", () => {
    const claim = claimFor("status.txt\nfoo\n");
    for (const criterion of [
      '"status.txt" contains exactly the newline-terminated lines "foo" in order',
      'contains exactly the newline-terminated lines "status.txt" and "foo" in order',
      '"other.txt" contains exactly the newline-terminated lines "status.txt" and "foo" in order',
      '"status.txt"; "other.txt" contains exactly the newline-terminated lines "foo" in order',
      '"after authentication" status.txt contains exactly the newline-terminated lines "foo" in order',
    ]) {
      expect(exactFileAssertionProvesCriterion(criterion, claim)).toBe(false);
    }
  });

  it("finds the line marker outside a quoted lines.txt subject", () => {
    const claim = claimFor(" contains exactly the newline-terminated lines \n", "lines.txt");
    expect(
      exactFileAssertionProvesCriterion(
        '"lines.txt" contains exactly the newline-terminated lines "foo" in order',
        claim,
      ),
    ).toBe(false);
  });

  it("binds singular and plural grammar to physical line count", () => {
    expect(proves("a\n", 'status.txt contains exactly the newline-terminated line "a"')).toBe(true);
    expect(proves("a\nb\n", 'status.txt contains exactly the newline-terminated line "a" and "b" in order')).toBe(
      false,
    );
    expect(proves("a\n", 'status.txt contains exactly the newline-terminated lines "a"')).toBe(false);
  });

  it("accepts model-generated single-quoted natural line literals", () => {
    const content = "Outcome: ready\nEvidence: targeted verification passed\n";
    for (const verb of ["contains", "exists with"]) {
      expect(
        proves(
          content,
          `status.txt ${verb} exactly two newline-terminated lines: 'Outcome: ready' and 'Evidence: targeted verification passed'`,
        ),
      ).toBe(true);
    }
  });

  it.each([
    ["backslash escape", "status.txt contains exactly two newline-terminated lines: 'ready\\n' and 'done'", " and \n"],
    [
      "literal newline",
      "status.txt contains exactly two newline-terminated lines: 'ready\ncontinued' and 'done'",
      " and \n",
    ],
    [
      "literal carriage return",
      "status.txt contains exactly two newline-terminated lines: 'ready\rcontinued' and 'done'",
      " and \n",
    ],
    [
      "embedded apostrophe",
      "status.txt contains exactly two newline-terminated lines: 'owner's ready' and 'done'",
      "owner\n and \n",
    ],
    ["unbalanced quote", "status.txt contains exactly two newline-terminated lines: 'ready and 'done'", "ready and \n"],
    [
      "wrong quoted subject",
      "'other.txt' contains exactly two newline-terminated lines: 'ready' and 'done'",
      "ready\ndone\n",
    ],
    [
      "extra quoted subject",
      "'status.txt'; 'other.txt' contains exactly two newline-terminated lines: 'ready' and 'done'",
      "ready\ndone\n",
    ],
  ])("rejects unsafe single-quoted natural syntax: %s", (_label, criterion, parsedCandidateBytes) => {
    expect(proves(parsedCandidateBytes, criterion)).toBe(false);
  });

  it("binds canonical and natural expected bytes exactly", () => {
    const claim = claimFor("ready\ndone\n");
    expect(exactFileAssertionMatchesCriterion('exact_file_bytes("status.txt","ready\\ndone\\n")', claim)).toBe(true);
    expect(
      exactFileAssertionMatchesCriterion(
        'status.txt contains exactly the newline-terminated lines "ready" and "done" in order',
        claim,
      ),
    ).toBe(true);
    expect(
      exactFileAssertionMatchesCriterion(
        'status.txt contains exactly the newline-terminated lines "wrong" and "bytes" in order',
        claim,
      ),
    ).toBe(false);
  });

  it.each([
    [
      'status.txt is created with exactly the newline-terminated lines "ready" and "done" after source.js authenticates build credentials',
    ],
    ['exact_file_bytes("status.txt","ready\\ndone\\n"); no other file is created'],
    ['only exact_file_bytes("status.txt","ready\\ndone\\n"); no additional output'],
    ['status.txt contains exact line "wrong"; exact_file_bytes("status.txt","ready\\ndone\\n")'],
    ['status.txt has exactly one newline-terminated line; exact_file_bytes("status.txt","ready\\ndone\\n")'],
    ['status.txt has exact content with no trailing newline; exact_file_bytes("status.txt","ready\\ndone\\n")'],
    ['status.txt has exact content "after authentication"; exact_file_bytes("status.txt","ready\\ndone\\n")'],
    ['exact_file_bytes("status.txt","ready\\ndone\\n"); exact_file_bytes("status.txt","wrong\\n")'],
    ['status.txt has exactly 999 bytes; exact_file_bytes("status.txt","ready\\ndone\\n")'],
    ['status.txt has exactly zero newlines; exact_file_bytes("status.txt","ready\\ndone\\n")'],
  ])("rejects unsupported or contradictory prose: %s", (criterion) => {
    expect(exactFileAssertionProvesCriterion(criterion, claimFor("ready\ndone\n"))).toBe(false);
  });

  it("rejects an ending claim contradicted by bytes", () => {
    expect(
      exactFileAssertionProvesCriterion(
        'status.txt ends in newline with exact content; exact_file_bytes("status.txt","ready")',
        claimFor("ready"),
      ),
    ).toBe(false);
  });
});

function proves(content: string, criterion: string): boolean {
  return exactFileAssertionProvesCriterion(criterion, claimFor(content));
}

function claimFor(content: string, path = "status.txt") {
  const cwd = mkdtempSync(join(tmpdir(), "p-exact-file-criterion-"));
  temporaryDirectories.push(cwd);
  writeFileSync(join(cwd, path), content);
  const escaped = content
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "%%")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  const claim = classifyExactFileBytesAssertion({
    cwd,
    taskOwnedPaths: [path],
    descriptor: `diff <(printf '${escaped}') ${path}`,
    isError: false,
  });
  if (!claim) throw new Error(`expected exact-file claim for ${path}`);
  return claim;
}
