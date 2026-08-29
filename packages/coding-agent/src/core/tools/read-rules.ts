import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { readRuleLinks } from "../project-instructions/reader.ts";
import type { ProjectInstructionState } from "../project-instructions/types.ts";

const readRulesSchema = Type.Object({
  links: Type.Array(Type.String({ description: "Cataloged rules/* virtual link", pattern: "^rules/.+$" }), {
    minItems: 1,
    maxItems: 3,
  }),
});

export type ReadRulesToolInput = Static<typeof readRulesSchema>;

export interface ReadRulesToolDetails {
  links: string[];
}

export function createReadRulesToolDefinition(
  state: ProjectInstructionState,
  onValidatedRead?: (links: readonly string[]) => void,
): ToolDefinition<typeof readRulesSchema, ReadRulesToolDetails> {
  return {
    name: "read_rules",
    label: "read_rules",
    description:
      "Read 1-3 exact authoritative project instruction modules plus their bounded transitive prerequisites using relative catalog links. Rejects invalid catalogs, unknown, stale, tampered, absolute, and traversal paths.",
    promptSnippet: "Read exact project instruction modules by catalog link",
    executionMode: "sequential",
    parameters: readRulesSchema,
    async execute(_toolCallId, input: ReadRulesToolInput) {
      const text = readRuleLinks(state, input.links);
      onValidatedRead?.(input.links);
      return {
        content: [{ type: "text", text }],
        details: { links: input.links },
      };
    },
  };
}
