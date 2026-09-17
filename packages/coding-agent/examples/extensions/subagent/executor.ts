import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@dst0/p";
import type { AgentScope } from "./agents.ts";
import { discoverAgents } from "./agents.ts";
import {
  getFinalOutput,
  getResultOutput,
  isFailedResult,
  mapWithConcurrencyLimit,
  type SingleResult,
  type SubagentDetails,
  truncateParallelOutput,
} from "./formatters.ts";
import type { SubagentToolDefinition } from "./parameters.ts";
import { type OnUpdateCallback, runSingleAgent } from "./runner.ts";
import { formatParentModel } from "./runtime-settings.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" || (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

export function createSubagentExecutor(p: ExtensionAPI): SubagentToolDefinition["execute"] {
  return async (_toolCallId, params, signal, onUpdate, ctx) => {
    const agentScope: AgentScope = params.agentScope ?? "user";
    const discovery = discoverAgents(ctx.cwd, agentScope);
    const agents = discovery.agents;
    const hasChain = (params.chain?.length ?? 0) > 0;
    const hasTasks = (params.tasks?.length ?? 0) > 0;
    const hasSingle = Boolean(params.agent && params.task);
    const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
    const makeDetails =
      (mode: "single" | "parallel" | "chain") =>
      (results: SingleResult[]): SubagentDetails => ({
        mode,
        agentScope,
        projectAgentsDir: discovery.projectAgentsDir,
        results,
      });

    if (modeCount !== 1) {
      const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
      return {
        content: [
          { type: "text", text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}` },
        ],
        details: makeDetails("single")([]),
      };
    }

    if (ctx.runBudgetPolicy.mode !== "unlimited") {
      throw new Error(
        "Subagent blocked: limited parent budgets cannot be safely shared with child processes. Select an unlimited parent budget or run the work directly.",
      );
    }

    const validatedProjectCwds = new Map<object, string>();
    if (agentScope === "project" || agentScope === "both") {
      const requestedInvocations = params.chain
        ? params.chain.map((step) => ({ key: step, name: step.agent, cwd: step.cwd }))
        : params.tasks
          ? params.tasks.map((task) => ({ key: task, name: task.agent, cwd: task.cwd }))
          : params.agent
            ? [{ key: params, name: params.agent, cwd: params.cwd }]
            : [];
      const requestedProjectInvocations = requestedInvocations.filter(
        (invocation) => agents.find((agent) => agent.name === invocation.name)?.source === "project",
      );
      if (requestedProjectInvocations.length > 0) {
        const names = Array.from(new Set(requestedProjectInvocations.map((invocation) => invocation.name))).join(", ");
        const directory = discovery.projectAgentsDir ?? "(unknown)";
        if (!discovery.projectAgentsDir) {
          throw new Error(`Canceled: project-local agent source could not be verified. Agents: ${names}.`);
        }
        const projectRoot = canonicalPath(dirname(dirname(discovery.projectAgentsDir)));
        for (const invocation of requestedProjectInvocations) {
          const childCwd = canonicalPath(resolve(ctx.cwd, invocation.cwd ?? ctx.cwd));
          if (!isWithin(projectRoot, childCwd)) {
            throw new Error(
              `Canceled: project-local agent working directory must stay inside its trusted project root. Agent: ${invocation.name}. Project root: ${projectRoot}.`,
            );
          }
          validatedProjectCwds.set(invocation.key, childCwd);
        }
        if (!ctx.hasUI) {
          if (!ctx.isProjectTrusted()) {
            throw new Error(
              `Canceled: project-local agents require explicit trusted authorization in headless mode. Agents: ${names}. Source: ${directory}`,
            );
          }
        } else {
          const approved = await ctx.ui.confirm(
            "Run project-local agents?",
            `Agents: ${names}\nSource: ${directory}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
          );
          if (!approved) {
            return {
              content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
              details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
            };
          }
        }
      }
    }

    const parentModel = formatParentModel(ctx.model);
    const parentThinking = p.getThinkingLevel();
    if (params.chain && params.chain.length > 0) {
      const results: SingleResult[] = [];
      let previousOutput = "";
      for (let index = 0; index < params.chain.length; index++) {
        const step = params.chain[index];
        const task = step.task.replace(/\{previous\}/g, previousOutput);
        const chainUpdate: OnUpdateCallback | undefined = onUpdate
          ? (partial) => {
              const current = partial.details?.results[0];
              if (current) onUpdate({ content: partial.content, details: makeDetails("chain")([...results, current]) });
            }
          : undefined;
        const result = await runSingleAgent(
          ctx.cwd,
          agents,
          step.agent,
          task,
          validatedProjectCwds.get(step) ?? step.cwd,
          index + 1,
          signal,
          chainUpdate,
          makeDetails("chain"),
          parentModel,
          parentThinking,
          "unlimited",
        );
        results.push(result);
        if (isFailedResult(result)) {
          throw new Error(`Chain stopped at step ${index + 1} (${step.agent}): ${getResultOutput(result)}`);
        }
        previousOutput = getFinalOutput(result.messages);
      }
      return {
        content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
        details: makeDetails("chain")(results),
      };
    }

    if (params.tasks && params.tasks.length > 0) {
      if (params.tasks.length > MAX_PARALLEL_TASKS) {
        return {
          content: [
            { type: "text", text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` },
          ],
          details: makeDetails("parallel")([]),
        };
      }
      const allResults: SingleResult[] = params.tasks.map((task) => ({
        agent: task.agent,
        agentSource: "unknown",
        task: task.task,
        exitCode: -1,
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      }));
      const emitParallelUpdate = (): void => {
        if (!onUpdate) return;
        const running = allResults.filter((result) => result.exitCode === -1).length;
        const done = allResults.length - running;
        onUpdate({
          content: [{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
          details: makeDetails("parallel")([...allResults]),
        });
      };
      const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (task, index) => {
        const result = await runSingleAgent(
          ctx.cwd,
          agents,
          task.agent,
          task.task,
          validatedProjectCwds.get(task) ?? task.cwd,
          undefined,
          signal,
          (partial) => {
            if (partial.details?.results[0]) {
              allResults[index] = partial.details.results[0];
              emitParallelUpdate();
            }
          },
          makeDetails("parallel"),
          parentModel,
          parentThinking,
          "unlimited",
        );
        allResults[index] = result;
        emitParallelUpdate();
        return result;
      });
      const successCount = results.filter((result) => !isFailedResult(result)).length;
      const summaries = results.map((result) => {
        const output = truncateParallelOutput(getResultOutput(result));
        const status = isFailedResult(result)
          ? `failed${result.stopReason && result.stopReason !== "end" ? ` (${result.stopReason})` : ""}`
          : "completed";
        return `### [${result.agent}] ${status}\n\n${output}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
          },
        ],
        details: makeDetails("parallel")(results),
      };
    }

    if (params.agent && params.task) {
      const result = await runSingleAgent(
        ctx.cwd,
        agents,
        params.agent,
        params.task,
        validatedProjectCwds.get(params) ?? params.cwd,
        undefined,
        signal,
        onUpdate,
        makeDetails("single"),
        parentModel,
        parentThinking,
        "unlimited",
      );
      if (isFailedResult(result)) {
        throw new Error(`Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}`);
      }
      return {
        content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
        details: makeDetails("single")([result]),
      };
    }

    const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
    return {
      content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
      details: makeDetails("single")([]),
    };
  };
}
