import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createFinishWorkToolDefinition } from "../src/core/tools/finish-work.ts";
import { createLsToolDefinition } from "../src/core/tools/ls.ts";
import { createSleepToolDefinition } from "../src/core/tools/sleep.ts";

const dummyTheme: any = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

const dummyContext: any = {
  cwd: "/test",
  showImages: false,
};

const dummyExtCtx = {} as ExtensionContext;

describe("finish_work tool", () => {
  const toolDef = createFinishWorkToolDefinition({
    gateCheck: {
      check: (input) => (input.notes === "block" ? "Blocked by gate" : null),
    },
  });

  it("throws on invalid summary or status combination", async () => {
    await expect(
      toolDef.execute("1", { status: "success", summary: "" }, undefined, undefined, dummyExtCtx),
    ).rejects.toThrow("summary is required");
    await expect(
      toolDef.execute(
        "1",
        { status: "success", summary: "done", remaining_work: ["todo"] },
        undefined,
        undefined,
        dummyExtCtx,
      ),
    ).rejects.toThrow('status "success" is incompatible');
  });

  it("respects gate check failure", async () => {
    await expect(
      toolDef.execute("1", { status: "partial", summary: "work", notes: "block" }, undefined, undefined, dummyExtCtx),
    ).rejects.toThrow("finish_work blocked: Blocked by gate");
  });

  it("returns payload details on successful execution", async () => {
    const res = await toolDef.execute(
      "1",
      {
        status: "success",
        summary: "Completed feature",
        files_changed: ["/src/a.ts"],
        tests_run: ["test1"],
      },
      undefined,
      undefined,
      dummyExtCtx,
    );

    expect((res.content[0] as { type: "text"; text: string }).text).toContain("Task finished with status: success");
    expect(res.details?.summary).toBe("Completed feature");

    const rendered = toolDef.renderResult?.(res as any, { expanded: true } as any, dummyTheme, dummyContext);
    expect(rendered).toBeDefined();
  });

  it("describes the selected task verification protocol without promoting audit by default", () => {
    const evidenceGuidance = createFinishWorkToolDefinition().promptGuidelines?.join(" ") ?? "";
    const auditGuidance =
      createFinishWorkToolDefinition({ taskVerificationMode: "audit" }).promptGuidelines?.join(" ") ?? "";
    const offGuidance =
      createFinishWorkToolDefinition({ taskVerificationMode: "off" }).promptGuidelines?.join(" ") ?? "";

    expect(evidenceGuidance).toContain("one concise completion checklist");
    expect(evidenceGuidance).toContain("first call record_task_verification with action 'record_completion_checklist'");
    expect(evidenceGuidance).toContain("finish_work without ready_to_finish");
    expect(evidenceGuidance).toContain("record the checklist before the first effect");
    expect(evidenceGuidance).toContain("ready_to_finish with evidence_refs_by_check");
    expect(evidenceGuidance).not.toMatch(/ready_to_finish[^.]*completion checklist/iu);
    expect(evidenceGuidance).not.toContain("record_requirement_audit");
    expect(auditGuidance).toContain("record_requirement_audit");
    expect(offGuidance).not.toContain("record_task_verification");
  });

  it("defines summary as the complete verbatim user-visible response", () => {
    const definition = createFinishWorkToolDefinition();
    const summarySchema = definition.parameters.properties.summary;
    const summaryDescription =
      "description" in summarySchema && typeof summarySchema.description === "string" ? summarySchema.description : "";
    const guidance = definition.promptGuidelines?.join(" ") ?? "";

    expect(summaryDescription).toContain("complete final user-visible response");
    expect(summaryDescription).toContain("Preserve requested structure");
    expect(guidance).toContain("printed verbatim");
    expect(guidance).toContain("Do not rely on an earlier assistant message");
  });
});

describe("sleep tool", () => {
  const toolDef = createSleepToolDefinition();
  const check = { tool: "ls", arguments: { path: "." } };

  it("executes sleep with finite seconds", async () => {
    const res = await toolDef.execute("1", { seconds: 0, check }, undefined, undefined, dummyExtCtx);
    expect((res.content[0] as { type: "text"; text: string }).text).toContain(
      "Slept for 0 seconds. Running required check `ls` now.",
    );
    expect(res.details).toEqual({ seconds: 0, check });
  });

  it("aborts when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      toolDef.execute("1", { seconds: 1, check }, controller.signal, undefined, dummyExtCtx),
    ).rejects.toThrow("Operation aborted");
  });

  it("renders call", () => {
    const rendered = toolDef.renderCall?.({ seconds: 5, check }, dummyTheme, dummyContext);
    expect(rendered).toBeDefined();
  });
});

describe("ls tool", () => {
  const mockOps = {
    exists: async (p: string) => p !== "/test/missing",
    stat: async (p: string) => ({ isDirectory: () => !p.endsWith(".txt") }),
    readdir: async (p: string) => {
      if (p === "/test/empty") return [];
      return ["dir1", "file.txt"];
    },
  };

  const toolDef = createLsToolDefinition("/test", { operations: mockOps });

  it("throws error for missing paths or non-directories", async () => {
    await expect(toolDef.execute("1", { path: "missing" }, undefined, undefined, dummyExtCtx)).rejects.toThrow(
      "Path not found",
    );
    await expect(toolDef.execute("1", { path: "file.txt" }, undefined, undefined, dummyExtCtx)).rejects.toThrow(
      "Not a directory",
    );
  });

  it("lists directory entries with slash for subdirectories", async () => {
    const res = await toolDef.execute("1", { path: "." }, undefined, undefined, dummyExtCtx);
    expect((res.content[0] as { type: "text"; text: string }).text).toContain("dir1/\nfile.txt");

    const emptyRes = await toolDef.execute("1", { path: "empty" }, undefined, undefined, dummyExtCtx);
    expect((emptyRes.content[0] as { type: "text"; text: string }).text).toBe("(empty directory)");

    const rendered = toolDef.renderResult?.(res as any, { expanded: false } as any, dummyTheme, dummyContext);
    expect(rendered).toBeDefined();
  });
});
