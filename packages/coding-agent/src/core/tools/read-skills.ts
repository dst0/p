import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { readSkillLinks } from "../project-instructions/reader.ts";
import type { ProjectInstructionState } from "../project-instructions/types.ts";

const readSkillsSchema = Type.Object({
  links: Type.Array(Type.String({ description: "Relative skill or skill-resource link from the injected catalog" }), {
    minItems: 1,
    maxItems: 32,
  }),
});

export type ReadSkillsToolInput = Static<typeof readSkillsSchema>;

export interface ReadSkillsToolDetails {
  links: string[];
}

export function createReadSkillsToolDefinition(
  state: ProjectInstructionState,
): ToolDefinition<typeof readSkillsSchema, ReadSkillsToolDetails> {
  return {
    name: "read_skills",
    label: "read_skills",
    description:
      "Read cataloged skills and their relative resources through traversal-safe virtual links. Rejects unknown, stale, absolute, and escaping paths.",
    promptSnippet: "Read a matching skill or its relative resource by catalog link",
    parameters: readSkillsSchema,
    async execute(_toolCallId, input: ReadSkillsToolInput) {
      return {
        content: [{ type: "text", text: readSkillLinks(state, input.links) }],
        details: { links: input.links },
      };
    },
  };
}
