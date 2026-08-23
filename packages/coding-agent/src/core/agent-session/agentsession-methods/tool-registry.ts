import type { AgentTool } from "@dst0/p-agent-core";
import { wrapRegisteredTools } from "../../extensions/index.ts";
import { createSyntheticSourceInfo } from "../../source-info.ts";
import type { AgentSession } from "../agentsession.ts";
import type { ToolDefinitionEntry } from "../session-types.ts";

export function do__refreshToolRegistry(
  self: AgentSession,
  options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean },
): void {
  const previousActiveToolNames = self.getActiveToolNames();
  const allowedToolNames = self._allowedToolNames;
  const excludedToolNames = self._excludedToolNames;
  const isAllowedTool = (name: string): boolean =>
    (!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);

  const registeredTools = self._extensionRunner.getAllRegisteredTools();
  const allCustomTools = [
    ...registeredTools,
    ...self._customTools.map((definition) => ({
      definition,
      sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, {
        source: "sdk",
      }),
    })),
  ].filter((tool) => isAllowedTool(tool.definition.name));
  const reservedProjectInstructionTool = allCustomTools.find(
    (tool) =>
      ["list_skills", "read_rules", "read_skills"].includes(tool.definition.name) &&
      self._baseToolDefinitions.has(tool.definition.name),
  );
  if (reservedProjectInstructionTool) {
    throw new Error(`${reservedProjectInstructionTool.definition.name} is reserved by compiled project instructions`);
  }
  const definitionRegistry = new Map<string, ToolDefinitionEntry>(
    Array.from(self._baseToolDefinitions.entries())
      .filter(([name]) => isAllowedTool(name))
      .map(([name, definition]) => [
        name,
        {
          definition,
          sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, {
            source: "builtin",
          }),
        },
      ]),
  );
  for (const tool of allCustomTools) {
    definitionRegistry.set(tool.definition.name, {
      definition: tool.definition,
      sourceInfo: tool.sourceInfo,
    });
  }
  self._toolDefinitions = definitionRegistry;
  self._toolPromptSnippets = new Map(
    Array.from(definitionRegistry.values())
      .map(({ definition }) => {
        const snippet = self._normalizePromptSnippet(definition.promptSnippet);
        return snippet ? ([definition.name, snippet] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string] => entry !== undefined),
  );
  self._toolPromptGuidelines = new Map(
    Array.from(definitionRegistry.values())
      .map(({ definition }) => {
        const guidelines = self._normalizePromptGuidelines(definition.promptGuidelines);
        return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string[]] => entry !== undefined),
  );
  const runner = self._extensionRunner;
  const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
  const wrappedBuiltInTools = wrapRegisteredTools(
    Array.from(self._baseToolDefinitions.values())
      .filter((definition) => isAllowedTool(definition.name))
      .map((definition) => ({
        definition,
        sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
      })),
    runner,
  );

  const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
  for (const tool of wrappedExtensionTools as AgentTool[]) {
    toolRegistry.set(tool.name, tool);
  }
  self._toolRegistry = toolRegistry;

  const nextActiveToolNames = (
    options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]
  ).filter((name) => isAllowedTool(name));

  if (allowedToolNames) {
    for (const toolName of self._toolRegistry.keys()) {
      if (allowedToolNames.has(toolName)) {
        nextActiveToolNames.push(toolName);
      }
    }
  } else {
    // Always activate extension tools that have promptSnippet —
    // providing a promptSnippet signals the tool should be visible in the system prompt's tool listing.
    for (const tool of wrappedExtensionTools) {
      if (self._toolPromptSnippets.has(tool.name)) {
        nextActiveToolNames.push(tool.name);
      }
    }
    if (options?.includeAllExtensionTools) {
      for (const tool of wrappedExtensionTools) {
        nextActiveToolNames.push(tool.name);
      }
    }
  }

  const uniqueActiveToolNames = new Set(nextActiveToolNames);
  const activatesCustomTool = Array.from(uniqueActiveToolNames).some(
    (name) => definitionRegistry.get(name)?.sourceInfo.source !== "builtin",
  );
  if (self._projectInstructionMode === "compiled" && activatesCustomTool) {
    if (!toolRegistry.has("read_rules")) {
      throw new Error("Compiled project instructions require read_rules when custom or extension tools are active");
    }
    uniqueActiveToolNames.add("read_rules");
  }

  self.setActiveToolsByName([...uniqueActiveToolNames]);
}
