import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AfterToolCallContext, BeforeToolCallContext } from "@dst0/p-agent-core";
import { vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/index.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type { createAgentSession } from "../src/core/sdk.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];
const extensionContext = {} as ExtensionContext;
let toolCallSequence = 0;

export const ACTION_ROUTING_BOUNDARY_TOKEN = "b".repeat(500);

export function createProjectInstructionModeWorkspace(options: { additionalInstructions?: string[] } = {}): {
  root: string;
  agentsPath: string;
  resourceLoader: ResourceLoader;
  compiler: ProjectInstructionCompiler;
} {
  const root = mkdtempSync(join(tmpdir(), "p-project-mode-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = [
    "## Security changes\n\nAlways protect credentials before edits.\n",
    "## Credential handling\n\nNever expose credential values in logs.\n",
    "## Testing\n\nNever run npm test unless requested.\n",
    "## Deployment\n\nNever deploy production unless explicitly requested.\n",
    "## Formatting\n\nNever run Biome format unless requested.\n",
    "## Migration\n\nNever run a database migration unless requested.\n",
    "## Code checks\n\nAfter code changes, run npm run check.\n",
    ...(options.additionalInstructions ?? []),
    `## Boundary routing\n\nNever run ${ACTION_ROUTING_BOUNDARY_TOKEN} unless requested.\n`,
    ...Array.from(
      { length: 35 },
      (_, index) => `## Topic ${index}\n\nPreserve topic ${index}. ${"detail ".repeat(12)}\n`,
    ),
  ].join("");
  writeFileSync(agentsPath, content);
  const runtime = createExtensionRuntime();
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [{ path: agentsPath, content: readFileSync(agentsPath, "utf8") }] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const compiler: ProjectInstructionCompiler = vi.fn(async (request: Parameters<ProjectInstructionCompiler>[0]) => {
    const compilation = createProjectInstructionCompilation(
      request,
      Object.fromEntries(
        request.modules.map((module) => [
          module.id,
          module.title === "Testing"
            ? "npm test execution"
            : module.title === "Deployment"
              ? "production deployment"
              : module.title === "Formatting"
                ? "biome format execution"
                : module.title === "Migration"
                  ? "database migration execution"
                  : module.title === "Code checks"
                    ? "file modification code changes npm run check"
                    : module.title === "Boundary routing"
                      ? ACTION_ROUTING_BOUNDARY_TOKEN
                      : `Work involving ${module.title}`,
        ]),
      ),
    );
    const boundaryModule = request.modules.find((module) => module.title === "Boundary routing");
    if (boundaryModule) compilation.triggers[boundaryModule.id] = ACTION_ROUTING_BOUNDARY_TOKEN;
    return compilation;
  });
  return { root, agentsPath, resourceLoader, compiler };
}

export function cleanupProjectInstructionModeWorkspaces(): void {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
}

export function projectInstructionToolHookInput(name: string, args: Record<string, unknown>): BeforeToolCallContext {
  return {
    toolCall: { type: "toolCall" as const, id: `call-${name}-${++toolCallSequence}`, name, arguments: args },
    args,
    assistantMessage: {} as BeforeToolCallContext["assistantMessage"],
    context: {} as BeforeToolCallContext["context"],
  };
}

export async function executeProjectInstructionReadRules(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
  links: string[],
): Promise<void> {
  await executeProjectInstructionReader(session, "read_rules", links);
}

export async function executeProjectInstructionReadSkills(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
  links: string[],
): Promise<void> {
  await executeProjectInstructionReader(session, "read_skills", links);
}

async function executeProjectInstructionReader(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
  toolName: "read_rules" | "read_skills",
  links: string[],
): Promise<void> {
  const args = { links };
  const call = projectInstructionToolHookInput(toolName, args);
  const blocked = await session.agent.beforeToolCall?.(call);
  if (blocked?.block) throw new Error(blocked.reason ?? `${toolName} was unexpectedly blocked`);
  const reader = session.getToolDefinition(toolName);
  if (!reader) throw new Error(`${toolName} is unavailable`);
  const result = await reader.execute(call.toolCall.id, args, undefined, undefined, extensionContext);
  await session.agent.afterToolCall?.({
    ...call,
    result,
    isError: false,
    context: { messages: [] },
  } as unknown as AfterToolCallContext);
}

export function pendingProjectInstructionRuleBatches(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
): string[][] {
  return (session._projectRuleGate?.batches ?? []).filter((batch) => !batch.satisfied).map((batch) => [...batch.links]);
}
