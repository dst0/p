import { describe, expect, it } from "vitest";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import {
  resolveProjectInstructionCompilerModel,
  resolveSessionProjectInstructionCompilerModel,
} from "../src/core/project-instructions/compiler-model.ts";
import type { SessionManager } from "../src/core/session-manager.ts";

describe("project instruction compiler model resolution", () => {
  it("rejects an explicit compiler model outside compiled delivery mode before registry access", () => {
    expect(() =>
      resolveSessionProjectInstructionCompilerModel({
        reference: "provider/compiler",
        mode: "legacy",
        modelRegistry: {} as ModelRegistry,
        sessionManager: {} as SessionManager,
      }),
    ).toThrow(/requires compiled project-instruction mode/iu);
  });

  it.each(["provider", "/compiler", "provider/"])("rejects malformed exact model reference %s", (reference) => {
    expect(() => resolveProjectInstructionCompilerModel(reference, {} as ModelRegistry)).toThrow(
      /provider\/id syntax/iu,
    );
  });
});
