import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inferProjectInstructionActionPhases,
  isProjectInstructionVerificationControlPlaneAction,
} from "../src/core/agent-session/project-instruction-action-phases.ts";
import { renderRulesCatalog } from "../src/core/project-instructions/prompt.ts";
import { selectProjectInstructionRuleLinks } from "../src/core/project-instructions/routing.ts";
import type { ProjectInstructionRuleRecord } from "../src/core/project-instructions/types.ts";
import {
  inferProjectInstructionPhases,
  inferProjectInstructionRulePhases,
} from "../src/core/project-instructions/work-phases.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
  executeProjectInstructionReadSkills,
  pendingProjectInstructionRuleBatches,
  projectInstructionToolHookInput,
} from "./project-instruction-delivery-fixture.ts";

afterEach(() => {
  cleanupProjectInstructionModeWorkspaces();
});

describe("project instruction lifecycle phases", () => {
  it("infers every applicable phase instead of forcing one phase per request", () => {
    expect(
      inferProjectInstructionPhases(
        "Resume the task, inspect the parser, design a fix, implement it, run tests, verify the binary, release, then summarize and clean up.",
      ),
    ).toEqual(["intake", "discovery", "planning", "implementation", "testing", "verification", "delivery", "closure"]);
    expect(inferProjectInstructionPhases("Answer the conceptual question without repository work.")).toEqual([]);
  });

  it("categorizes rules additively while leaving unmatched rules available to semantic routing", () => {
    expect(
      inferProjectInstructionRulePhases({
        title: "Testing and release",
        trigger: "Run focused tests, verify the installed artifact, then publish the release",
      }),
    ).toEqual(["testing", "verification", "delivery"]);
    expect(
      inferProjectInstructionRulePhases({ title: "Domain invariant", trigger: "Handle frobnicator state" }),
    ).toEqual([]);
  });

  it("derives authoritative action phases from concrete tools instead of another model call", () => {
    expect(inferProjectInstructionActionPhases("read", { path: "src/app.ts" })).toEqual(["discovery"]);
    expect(inferProjectInstructionActionPhases("edit", { path: "src/app.ts" })).toEqual(["implementation"]);
    expect(inferProjectInstructionActionPhases("bash", { command: "npm run test:unit && npm run check" })).toEqual([
      "testing",
      "verification",
    ]);
    expect(inferProjectInstructionActionPhases("bash", { command: "git status && git push origin main" })).toEqual([
      "discovery",
      "delivery",
    ]);
    expect(inferProjectInstructionActionPhases("finish_work", { status: "success" })).toEqual(["closure"]);
    expect(inferProjectInstructionActionPhases("read_rules", { links: ["rules/a.md"] })).toEqual([]);
  });

  it("identifies only runtime-safe verification control-plane actions", () => {
    expect(isProjectInstructionVerificationControlPlaneAction("record_requirement_audit", { action: "define" })).toBe(
      true,
    );
    expect(isProjectInstructionVerificationControlPlaneAction("record_task_verification", { action: "status" })).toBe(
      true,
    );
    expect(
      isProjectInstructionVerificationControlPlaneAction("record_task_verification", { action: "ready_to_finish" }),
    ).toBe(false);
    expect(
      isProjectInstructionVerificationControlPlaneAction(
        "record_task_verification",
        Object.assign([], { action: "status" }),
      ),
    ).toBe(false);
    expect(isProjectInstructionVerificationControlPlaneAction("extension_tool", { action: "status" })).toBe(false);
  });

  it("uses a phase match only when no stronger lexical route exists", () => {
    const discovery = rule("discovery", "Repository inspection", "Read source files before diagnosis");
    const implementation = rule("implementation", "Code changes", "Modify source files carefully");
    const credentials = rule("credentials", "Credential handling", "Protect credential values");

    expect(selectProjectInstructionRuleLinks([discovery, implementation], "diagnose frobnicator state")).toEqual([
      discovery.link,
    ]);
    expect(selectProjectInstructionRuleLinks([implementation, credentials], "edit credential values")).toEqual([
      credentials.link,
    ]);
    const catalog = renderRulesCatalog([discovery, implementation, credentials]).root;
    expect(catalog).toContain("Phases: discovery");
    expect(catalog).toContain("Phases: implementation");
    expect(catalog).toContain("Phases: semantic-only");
  });

  it("uses phase relevance only as a tie-break between equally strong title matches", () => {
    const implementation = rule("implementation", "Credential changes", "Edit source files carefully");
    const credentials = rule("credentials", "Credential policy", "Protect secrets");

    expect(selectProjectInstructionRuleLinks([implementation, credentials], "edit credential")).toEqual([
      implementation.link,
      credentials.link,
    ]);
  });

  it("does not let conjunctions in unrelated titles suppress phase routing", () => {
    const discovery = rule("discovery", "Repository inspection", "Read source before diagnosis");
    const unrelated = rule("dependency", "Dependency and install security", "Package integrity");

    expect(selectProjectInstructionRuleLinks([discovery, unrelated], "inspect parser and diagnose failure")).toEqual([
      discovery.link,
    ]);
  });

  it("normalizes PR and pull-request aliases before lexical precedence", () => {
    const projectPr = rule("project-pr", "Issues and PRs", "Project review checklist");
    const baseline = rule("baseline", "Git pull requests", "Generic delivery guidance");

    const selected = selectProjectInstructionRuleLinks([projectPr, baseline], "create_pull_request");
    expect(selected).toHaveLength(2);
    expect(selected).toEqual(expect.arrayContaining([projectPr.link, baseline.link]));
  });

  it("keeps read-only discovery, closure, and skill readers outside the mutation gate", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: [
        "## Discovery\n\nInspect relevant source and project context before diagnosis.\n",
        "## Closure\n\nReport verification status before finishing work.\n",
      ],
    });
    const { session } = await createAgentSession({
      cwd: workspace.root,
      agentDir: join(workspace.root, ".agent-phase-gate"),
      resourceLoader: workspace.resourceLoader,
      sessionManager: SessionManager.inMemory(workspace.root),
      projectInstructionMode: "compiled",
      projectInstructionCompiler: workspace.compiler,
    });
    try {
      const rules = session._projectInstructions.state.current?.manifest.rules ?? [];
      const discoveryLink = rules.find((rule) => rule.title === "Discovery")?.link;
      const closureLink = rules.find((rule) => rule.title === "Closure")?.link;
      expect(discoveryLink).toBeDefined();
      expect(closureLink).toBeDefined();

      const discoveryTurn = session._createRuntimeContextPrompts("hello there", session.systemPrompt);
      expect(discoveryTurn.projectRuleLinks).toBeUndefined();
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("read", { path: "src/app.ts" })),
      ).resolves.toBeUndefined();
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);

      await executeProjectInstructionReadSkills(session, ["skills/catalog.md"]);
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
      await expect(
        session.agent.beforeToolCall?.(projectInstructionToolHookInput("read", { path: "src/app.ts" })),
      ).resolves.toBeUndefined();

      const closureTurn = session._createRuntimeContextPrompts("hello again", session.systemPrompt);
      expect(closureTurn.projectRuleLinks).toBeUndefined();
      await expect(
        session.agent.beforeToolCall?.(
          projectInstructionToolHookInput("finish_work", { status: "partial", summary: "Done" }),
        ),
      ).resolves.toBeUndefined();
      expect(pendingProjectInstructionRuleBatches(session)).toEqual([]);
    } finally {
      session.dispose();
    }
  });
});

function rule(id: string, title: string, trigger: string): ProjectInstructionRuleRecord {
  return {
    id,
    link: `rules/${id}.md`,
    file: `rules/${id}.md`,
    title,
    trigger,
    routable: true,
    sourcePath: "/workspace/AGENTS.md",
    contentHash: "0".repeat(64),
  };
}
