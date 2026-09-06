import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { wrapToolDefinitions } from "../src/core/tools/tool-definition-wrapper.ts";

describe("tool definition effect boundaries", () => {
  it("preserves batch order and execution hooks while assigning built-in effects", async () => {
    const parameters = Type.Object({ path: Type.String() });
    const result = { content: [{ type: "text" as const, text: "Fixture contents" }], details: {} };
    const execute = vi.fn<ToolDefinition<typeof parameters>["execute"]>(async () => result);
    const prepareArguments = (args: unknown) => ({ path: String(args) });
    const definitions: ToolDefinition<typeof parameters>[] = [
      {
        name: "read",
        label: "Read file",
        description: "Read an existing file",
        parameters,
        prepareArguments,
        executionMode: "parallel",
        execute,
      },
      {
        name: "write",
        label: "Write file",
        description: "Write a workspace file",
        parameters,
        executionMode: "sequential",
        execute,
      },
    ];
    const wrapped = wrapToolDefinitions(definitions);

    expect(wrapped.map((tool) => tool.name)).toEqual(["read", "write"]);
    expect(wrapped.map((tool) => tool.effect)).toEqual([
      { kind: "read", risk: "normal", domains: [], source: "builtin" },
      { kind: "workspace_write", risk: "normal", domains: [], source: "builtin" },
    ]);
    expect(wrapped.map((tool) => tool.executionMode)).toEqual(["parallel", "sequential"]);
    expect(wrapped[0]?.parameters).toBe(parameters);
    expect(wrapped[0]?.prepareArguments).toBe(prepareArguments);
    const args = wrapped[0]!.prepareArguments!("fixture.txt");
    const signal = new AbortController().signal;
    const update = vi.fn();
    expect(await wrapped[0]!.execute("read-1", args, signal, update)).toBe(result);
    expect(execute).toHaveBeenCalledExactlyOnceWith("read-1", { path: "fixture.txt" }, signal, update, undefined);
  });

  it("does not let a custom tool inherit trusted read authority from a built-in name", () => {
    const parameters = Type.Object({});
    const definition: ToolDefinition<typeof parameters> = {
      name: "read",
      label: "Custom read",
      description: "An extension may perform arbitrary side effects",
      parameters,
      execute: async () => ({ content: [], details: {} }),
    };
    const [undeclared, declared] = wrapToolDefinitions(
      [definition, { ...definition, effect: { kind: "external_write", risk: "high", domains: ["network_send"] } }],
      undefined,
      "declared",
    );

    expect(undeclared?.effect).toEqual({ kind: "unknown", risk: "high", domains: [], source: "default_unknown" });
    expect(declared?.effect).toEqual({
      kind: "external_write",
      risk: "high",
      domains: ["network_send"],
      source: "declared",
    });
    expect(wrapToolDefinitions([])).toEqual([]);
  });
});
