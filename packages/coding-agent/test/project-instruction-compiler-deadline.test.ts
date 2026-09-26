import { describe, expect, it, vi } from "vitest";
import { runProjectInstructionCompiler } from "../src/core/project-instructions/compiler-runner.ts";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/types.ts";

describe("project instruction compiler deadline lifecycle", () => {
  it("does not invoke a compiler when its supplied signal is already aborted", async () => {
    const parent = new AbortController();
    parent.abort(new Error("caller cancelled"));
    const compiler = vi.fn<ProjectInstructionCompiler>(async () => {
      throw new Error("compiler should not start");
    });
    const result = await runProjectInstructionCompiler(
      compiler,
      { sources: [{ path: "AGENTS.md", content: "Always inspect the source." }], modules: [], constraints: [] },
      { signal: parent.signal, deadlineSeconds: 1 },
    );
    expect(result.status).toBe("failed");
    expect(compiler).not.toHaveBeenCalled();
  });

  it("removes parent and effective abort listeners after a successful compilation", async () => {
    const parent = new AbortController();
    const parentAdd = vi.spyOn(parent.signal, "addEventListener");
    const parentRemove = vi.spyOn(parent.signal, "removeEventListener");
    let effectiveAdd: ReturnType<typeof vi.spyOn> | undefined;
    let effectiveRemove: ReturnType<typeof vi.spyOn> | undefined;
    const compiler: ProjectInstructionCompiler = async (_request, options) => {
      const signal = options?.signal;
      expect(signal).toBeDefined();
      effectiveAdd = vi.spyOn(signal!, "addEventListener");
      effectiveRemove = vi.spyOn(signal!, "removeEventListener");
      return {
        body: "No source constraints apply to every task.",
        triggers: {},
        classifications: { modules: {}, constraints: {} },
        alwaysOn: {},
      };
    };
    const result = await runProjectInstructionCompiler(
      compiler,
      { sources: [{ path: "AGENTS.md", content: "Always inspect the source." }], modules: [], constraints: [] },
      { signal: parent.signal, deadlineSeconds: 1 },
    );
    expect(result.status).toBe("success");
    expect(parentAdd).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(parentRemove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(effectiveAdd).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(effectiveRemove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
