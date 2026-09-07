import { describe, expect, it } from "vitest";
import {
  classifyProjectInstructionCompilerError,
  renderProjectInstructionCompilerDiagnosticError,
  sanitizeProjectInstructionCompilerError,
} from "../src/core/project-instructions/compiler-diagnostics.ts";

describe("project instruction compiler diagnostics", () => {
  it("maps failures to allowlisted public categories", () => {
    expect(classifyProjectInstructionCompilerError(new Error("provider input exceeds context window"))).toBe(
      "project instruction compiler model context capacity was insufficient",
    );
    expect(classifyProjectInstructionCompilerError(new Error("maximum context length exceeded"))).toBe(
      "project instruction compiler model context capacity was insufficient",
    );
    expect(classifyProjectInstructionCompilerError(new Error("model does not support thinking off"))).toBe(
      "project instruction compiler model does not support thinking off",
    );
    expect(classifyProjectInstructionCompilerError(new Error("lacks explicit thinking-disable compatibility"))).toBe(
      "project instruction compiler model lacks explicit thinking-disable compatibility",
    );
    expect(
      classifyProjectInstructionCompilerError(
        new Error("Complete project instruction sources exceed the 512000-byte compiler source limit"),
      ),
    ).toBe("project instruction compiler source size limit was exceeded");
    expect(
      classifyProjectInstructionCompilerError(new Error("Instruction compiler source size limit was exceeded")),
    ).toBe("project instruction compiler source size limit was exceeded");
    expect(classifyProjectInstructionCompilerError(new Error("provider stopped with error"))).toBe(
      "project instruction compiler provider call failed",
    );
    expect(classifyProjectInstructionCompilerError(new Error("private internal detail"))).toBe(
      "project instruction compiler failed",
    );
  });

  it("keeps arbitrary compiler details out of the public category", () => {
    const privateToken = "sensitive_token_value_with_more_than_32_characters";
    expect(sanitizeProjectInstructionCompilerError(new Error(`failure ${privateToken}`))).not.toContain(privateToken);
    expect(classifyProjectInstructionCompilerError(new Error(`failure ${privateToken}`))).toBe(
      "project instruction compiler failed",
    );
  });

  it("renders only the fixed diagnostic category as a cache-safe error", () => {
    expect(renderProjectInstructionCompilerDiagnosticError("project instruction compiler failed")).toBe(
      "Error: Instruction compiler failed",
    );
    expect(
      renderProjectInstructionCompilerDiagnosticError(
        "project instruction compiler model context capacity was insufficient",
      ),
    ).toBe("Error: Instruction compiler model context capacity was insufficient");
  });
});
