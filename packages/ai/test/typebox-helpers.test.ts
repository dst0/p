import { describe, expect, it } from "vitest";
import { StringEnum } from "../src/utils/typebox-helpers.ts";

describe("StringEnum typebox helper", () => {
  it("creates a basic string enum schema", () => {
    const schema = StringEnum(["red", "green", "blue"]);
    expect(schema).toEqual({
      type: "string",
      enum: ["red", "green", "blue"],
    });
  });

  it("supports description and default options", () => {
    const schema = StringEnum(["low", "medium", "high"], {
      description: "Priority level",
      default: "medium",
    });
    expect(schema).toEqual({
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Priority level",
      default: "medium",
    });
  });
});
