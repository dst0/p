import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { Tool, ToolCall } from "../src/types.ts";
import { validateToolArguments, validateToolCall } from "../src/utils/validation.ts";

describe("validation utility unit tests", () => {
  const SampleSchema = Type.Object({
    str: Type.String(),
    num: Type.Number(),
    int: Type.Integer(),
    bool: Type.Boolean(),
    arr: Type.Array(Type.String()),
    opt: Type.Optional(Type.String()),
  });

  const sampleTool: Tool = {
    name: "sample_tool",
    description: "A sample tool for testing validation",
    parameters: SampleSchema,
  };

  it("validates correct tool call arguments", () => {
    const call: ToolCall = {
      type: "toolCall",
      id: "call-1",
      name: "sample_tool",
      arguments: {
        str: "hello",
        num: 3.14,
        int: 42,
        bool: true,
        arr: ["a", "b"],
      },
    };

    const result = validateToolCall([sampleTool], call);
    expect(result).toEqual(call.arguments);
  });

  it("throws error if tool is not found in registry", () => {
    const call: ToolCall = {
      type: "toolCall",
      id: "call-2",
      name: "unknown_tool",
      arguments: {},
    };

    expect(() => validateToolCall([sampleTool], call)).toThrow('Tool "unknown_tool" not found');
  });

  it("throws informative error on validation failure", () => {
    const call: ToolCall = {
      type: "toolCall",
      id: "call-3",
      name: "sample_tool",
      arguments: {
        str: 12345, // invalid
        num: "not a number", // invalid
        int: 12.34, // invalid integer
        bool: "not bool",
        arr: "not array",
      },
    };

    expect(() => validateToolArguments(sampleTool, call)).toThrow("Validation failed for tool");
  });

  it("coerces raw JSON schema arguments (non-TypeBox metadata)", () => {
    const rawJsonSchemaTool: Tool = {
      name: "raw_tool",
      description: "Raw JSON schema tool",
      parameters: {
        type: "object",
        properties: {
          count: { type: "integer" },
          enabled: { type: "boolean" },
          label: { type: "string" },
          items: {
            type: "array",
            items: { type: "number" },
          },
        },
        required: ["count", "enabled"],
      } as any,
    };

    const call: ToolCall = {
      type: "toolCall",
      id: "call-4",
      name: "raw_tool",
      arguments: {
        count: "100", // coerced to 100
        enabled: "true", // coerced to true
        label: 999, // coerced to "999"
        items: ["1.5", "2.5"], // coerced to [1.5, 2.5]
      },
    };

    const validated = validateToolArguments(rawJsonSchemaTool, call);
    expect(validated).toEqual({
      count: 100,
      enabled: true,
      label: "999",
      items: [1.5, 2.5],
    });
  });

  it("handles allOf, anyOf, oneOf in JSON schema coercion", () => {
    const unionTool: Tool = {
      name: "union_tool",
      description: "Union tool",
      parameters: {
        type: "object",
        properties: {
          val: {
            anyOf: [{ type: "number" }, { type: "string" }],
          },
        },
      } as any,
    };

    const call: ToolCall = {
      type: "toolCall",
      id: "call-5",
      name: "union_tool",
      arguments: {
        val: 42,
      },
    };

    const validated = validateToolArguments(unionTool, call) as { val: number };
    expect(validated.val).toBe(42);
  });

  it("formats required property error paths correctly", () => {
    const requiredTool: Tool = {
      name: "req_tool",
      description: "Required tool",
      parameters: {
        type: "object",
        properties: {
          sub: {
            type: "object",
            properties: {
              field: { type: "string" },
            },
            required: ["field"],
          },
        },
        required: ["sub"],
      } as any,
    };

    const callMissingRoot: ToolCall = {
      type: "toolCall",
      id: "c1",
      name: "req_tool",
      arguments: {},
    };

    expect(() => validateToolArguments(requiredTool, callMissingRoot)).toThrow("sub");

    const callMissingSub: ToolCall = {
      type: "toolCall",
      id: "c2",
      name: "req_tool",
      arguments: { sub: {} },
    };

    expect(() => validateToolArguments(requiredTool, callMissingSub)).toThrow("sub.field");
  });
});
