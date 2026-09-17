import { vi } from "vitest";
import type { RunBudgetPolicy } from "../src/core/run-budget-policy.ts";

export function createParsed() {
  return {
    apiKey: "runtime-key",
    appendSystemPrompt: undefined,
    models: ["provider/model"],
    noContextFiles: false,
    noExtensions: false,
    noPromptTemplates: false,
    noSkills: false,
    noThemes: false,
    projectTrustOverride: undefined,
    runBudget: undefined as RunBudgetPolicy | undefined,
    systemPrompt: undefined,
    thinking: "high",
    unknownFlags: new Map(),
  };
}

export function createOptions() {
  return {
    agentDir: "/agent",
    appMode: "interactive",
    authStorage: { setRuntimeApiKey: vi.fn() },
    defaultRunBudget: { mode: "limited", unit: "requests", limit: 1 } as const,
    extensionFactories: [],
    parsed: createParsed(),
    resolvedExtensionPaths: ["extension"],
    resolvedPromptTemplatePaths: ["prompt"],
    resolvedSkillPaths: ["skill"],
    resolvedThemePaths: ["theme"],
    startupSettingsManager: { getDefaultProjectTrust: vi.fn(() => "ask") },
    trustPromptMode: "interactive",
    trustStore: { get: vi.fn(() => false) },
  };
}
