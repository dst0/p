import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import {
  formatPromptTemplateInvocation,
  loadPromptTemplates,
  loadSourcedPromptTemplates,
  parseCommandArgs,
} from "../../src/harness/prompt-templates.ts";

import { createTempDir } from "./session-test-utils.ts";

describe("loadPromptTemplates", () => {
  it("loads markdown templates non-recursively from one or more dirs", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("a/nested", { recursive: true });
    await env.createDir("b", { recursive: true });
    await env.writeFile("a/one.md", "---\ndescription: One template\n---\nHello $1");
    await env.writeFile("a/nested/ignored.md", "Ignored");
    await env.writeFile("b/two.md", "First line description\nBody");

    const { promptTemplates, diagnostics } = await loadPromptTemplates(env, ["a", "b"]);

    expect(diagnostics).toEqual([]);
    expect(promptTemplates).toEqual([
      { name: "one", description: "One template", content: "Hello $1" },
      { name: "two", description: "First line description", content: "First line description\nBody" },
    ]);
  });

  it("preserves source info for sourced prompt templates", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.createDir("prompts", { recursive: true });
    await env.writeFile("prompts/example.md", "---\ndescription: Example\n---\nExample body");

    const { promptTemplates, diagnostics } = await loadSourcedPromptTemplates(env, [
      { path: "prompts", source: { type: "project" as const } },
    ]);

    expect(diagnostics).toEqual([]);
    expect(promptTemplates).toEqual([
      {
        promptTemplate: { name: "example", description: "Example", content: "Example body" },
        source: { type: "project" },
      },
    ]);
  });

  it("attaches source info to diagnostics", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.writeFile("broken.md", "---\ndescription: [unterminated\n---\nBody");

    const { promptTemplates, diagnostics } = await loadSourcedPromptTemplates(env, [
      { path: "broken.md", source: { type: "user" as const } },
    ]);

    expect(promptTemplates).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      type: "warning",
      path: join(root, "broken.md"),
      source: { type: "user" },
    });
  });

  it("loads explicit markdown files and symlinked files", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.writeFile("target.md", "---\ndescription: Target\n---\nTarget body");
    await symlink(join(root, "target.md"), join(root, "link.md"));

    const { promptTemplates } = await loadPromptTemplates(env, ["target.md", "link.md"]);

    expect(promptTemplates).toEqual([
      { name: "target", description: "Target", content: "Target body" },
      { name: "link", description: "Target", content: "Target body" },
    ]);
  });

  it("uses mapPromptTemplate callback when provided", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.writeFile("custom.md", "Content");
    const { promptTemplates } = await loadSourcedPromptTemplates(
      env,
      [{ path: "custom.md", source: "src-1" }],
      (tpl, src) => ({ ...tpl, mapped: true, sourceName: src }),
    );
    expect(promptTemplates[0].promptTemplate).toMatchObject({
      name: "custom",
      mapped: true,
      sourceName: "src-1",
    });
  });

  it("truncates long description from first line (> 60 chars)", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const longLine = "A".repeat(80);
    await env.writeFile("long.md", longLine);
    const { promptTemplates } = await loadPromptTemplates(env, ["long.md"]);
    expect(promptTemplates[0].description).toBe(`${"A".repeat(60)}...`);
  });

  it("handles directory list_failed and read_failed diagnostics", async () => {
    const env: any = {
      fileInfo: async (p: string) => {
        if (p === "bad-dir") return { ok: true, value: { path: "bad-dir", kind: "directory", name: "bad-dir" } };
        if (p === "bad-file.md") return { ok: true, value: { path: "bad-file.md", kind: "file", name: "bad-file.md" } };
        if (p === "err-info") return { ok: false, error: { code: "permission_denied", message: "Denied" } };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
      listDir: async () => ({ ok: false, error: { code: "permission_denied", message: "List error" } }),
      readTextFile: async () => ({ ok: false, error: { code: "read_error", message: "Read error" } }),
      canonicalPath: async () => ({ ok: false, error: { code: "not_found", message: "Not found" } }),
    };

    const res1 = await loadPromptTemplates(env, ["bad-dir"]);
    expect(res1.diagnostics[0].code).toBe("list_failed");

    const res2 = await loadPromptTemplates(env, ["bad-file.md"]);
    expect(res2.diagnostics[0].code).toBe("read_failed");

    const res3 = await loadPromptTemplates(env, ["err-info"]);
    expect(res3.diagnostics[0].code).toBe("file_info_failed");
  });

  it("handles symlink resolveKind errors when canonicalPath or fileInfo fails", async () => {
    const env: any = {
      fileInfo: async (p: string) => {
        if (p === "symlink-err")
          return { ok: true, value: { path: "symlink-err", kind: "symlink", name: "symlink-err" } };
        if (p === "symlink-target-err")
          return { ok: true, value: { path: "symlink-target-err", kind: "symlink", name: "symlink-target-err" } };
        if (p === "target-err")
          return { ok: false, error: { code: "permission_denied", message: "Target info denied" } };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
      canonicalPath: async (p: string) => {
        if (p === "symlink-err")
          return { ok: false, error: { code: "permission_denied", message: "Canonical path denied" } };
        if (p === "symlink-target-err") return { ok: true, value: "target-err" };
        return { ok: false, error: { code: "not_found", message: "Not found" } };
      },
    };

    const res = await loadPromptTemplates(env, ["symlink-err", "symlink-target-err"]);
    expect(res.diagnostics.map((d) => d.code)).toEqual(["file_info_failed", "file_info_failed"]);
  });
});

describe("formatPromptTemplateInvocation and parseCommandArgs", () => {
  it("substitutes command arguments", () => {
    const content = "$1 $" + "{@:2} $ARGUMENTS";
    expect(formatPromptTemplateInvocation({ name: "one", content }, ["hello world", "test"])).toBe(
      "hello world test hello world test",
    );
  });

  it("parses single and double quoted arguments and space/tab separators", () => {
    expect(parseCommandArgs("foo \"bar baz\" 'hello world'\tone")).toEqual(["foo", "bar baz", "hello world", "one"]);
    expect(parseCommandArgs("")).toEqual([]);
  });

  it("substitutes slice arguments and handles start <= 0", () => {
    const template = {
      name: "sub",
      content: "$" + "{@:1:2} | $" + "{@:0:1} | $ARGUMENTS | $@",
    };
    const res = formatPromptTemplateInvocation(template, ["a", "b", "c"]);
    expect(res).toBe("a b | a | a b c | a b c");
  });

  it("handles parse_failed, unclosed quote, and missing $1 placeholder bounds", async () => {
    // 1. parse_failed
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await env.writeFile("bad.md", "---\ndescription: [invalid yaml\n  : :\n---\nBody");
    const res = await loadPromptTemplates(env, ["bad.md"]);
    expect(res.diagnostics[0].code).toBe("parse_failed");

    // 2. unclosed quote in parseCommandArgs
    expect(parseCommandArgs('foo "unclosed string')).toEqual(["foo", "unclosed string"]);

    // 3. missing $1 placeholder out of bounds
    expect(formatPromptTemplateInvocation({ name: "t", content: "arg: $1" }, [])).toBe("arg: ");
  });
});
