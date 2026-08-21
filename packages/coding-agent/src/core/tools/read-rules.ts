import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { readRuleLinks } from "../project-instructions/reader.ts";
import type { ProjectInstructionState } from "../project-instructions/types.ts";

const readRulesSchema = Type.Object({
  links: Type.Array(Type.String({ description: "Relative link from the injected rule catalog" }), {
    minItems: 1,
    maxItems: 32,
  }),
});

export type ReadRulesToolInput = Static<typeof readRulesSchema>;

export interface ReadRulesToolDetails {
  links: string[];
}

export function createReadRulesToolDefinition(
  state: ProjectInstructionState,
): ToolDefinition<typeof readRulesSchema, ReadRulesToolDetails> {
  return {
    name: "read_rules",
    label: "read_rules",
    description:
      "Read exact authoritative project instruction modules using only relative links advertised by the injected rule catalog. Rejects unknown, stale, tampered, absolute, and traversal paths.",
    promptSnippet: "Read exact project instruction modules by catalog link",
    parameters: readRulesSchema,
    async execute(_toolCallId, input: ReadRulesToolInput) {
      return {
        content: [{ type: "text", text: readRuleLinks(state, input.links) }],
        details: { links: input.links },
      };
    },
  };
}
