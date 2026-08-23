import { TOOL_SEARCH_TOOL_NAME } from "./agent-session/constants.ts";
import type { ProjectInstructionDeliveryMode } from "./project-instructions/index.ts";

interface SdkToolPolicyOptions {
  projectInstructionMode: ProjectInstructionDeliveryMode;
  tools?: string[];
  noTools?: "all" | "builtin";
  excludeTools?: string[];
  userInputTools?: boolean;
}

interface SdkToolPolicy {
  allowedToolNames: string[] | undefined;
  excludedToolNames: string[] | undefined;
  initialActiveToolNames: string[];
  explicitlyToolless: boolean;
}

const READ_ONLY_EXPLICIT_TOOLS = new Set([
  "ask_user",
  "confirm_user",
  "find",
  "grep",
  "list_skills",
  "ls",
  "read",
  "read_rules",
  "read_skills",
  "semantic_search",
  "session_recall",
  TOOL_SEARCH_TOOL_NAME,
]);

export function resolveSdkToolPolicy(options: SdkToolPolicyOptions): SdkToolPolicy {
  const defaultActiveToolNames = [
    "read",
    "bash",
    "process",
    "edit",
    "write",
    "sleep",
    "semantic_search",
    "update_session_state",
    "session_recall",
    "keep_context",
    TOOL_SEARCH_TOOL_NAME,
  ];
  if (options.projectInstructionMode === "compiled") {
    defaultActiveToolNames.push("list_skills", "read_rules", "read_skills");
  }
  if (options.userInputTools) defaultActiveToolNames.push("ask_user", "confirm_user");

  const excludedToolNames = options.excludeTools;
  const excludedToolNameSet = excludedToolNames ? new Set(excludedToolNames) : undefined;
  const requestedToolNames = options.tools ? [...options.tools] : undefined;
  const explicitToolsMayMutate = requestedToolNames?.some((name) => !READ_ONLY_EXPLICIT_TOOLS.has(name)) ?? false;
  const defaultToolsMayMutate = !requestedToolNames && options.noTools === undefined;
  if (
    options.projectInstructionMode === "compiled" &&
    (explicitToolsMayMutate || defaultToolsMayMutate) &&
    excludedToolNameSet?.has("read_rules")
  ) {
    throw new Error("Compiled project instructions require read_rules when mutating tools are enabled");
  }
  if (options.projectInstructionMode === "compiled" && explicitToolsMayMutate) {
    if (!requestedToolNames?.includes("read_rules")) requestedToolNames?.push("read_rules");
  }

  const allowedToolNames = requestedToolNames ?? (options.noTools === "all" ? [] : undefined);
  const initialActiveToolNames = (requestedToolNames ?? (options.noTools ? [] : defaultActiveToolNames)).filter(
    (name) => !excludedToolNameSet?.has(name),
  );
  return {
    allowedToolNames,
    excludedToolNames,
    initialActiveToolNames,
    explicitlyToolless: (options.tools !== undefined && options.tools.length === 0) || options.noTools === "all",
  };
}
