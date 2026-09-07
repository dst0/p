/**
 * Local test harness for the new coding-agent test suite.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool, CompletionMode } from "@dst0/p-agent-core";
import { Agent, resolveToolEffect } from "@dst0/p-agent-core";
import type { FauxModelDefinition, FauxProviderRegistration, FauxResponseStep, Model } from "@dst0/p-ai";
import { registerFauxProvider } from "@dst0/p-ai";
import { AgentSession, type AgentSessionEvent } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import type { ExtensionRunner } from "../../src/core/extensions/index.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import type { TaskVerificationMode } from "../../src/core/task-verification/mode.ts";
import {
  installTaskVerificationRuntime,
  prepareTaskVerificationRuntime,
} from "../../src/core/task-verification-session-runtime.ts";
import type { ExtensionFactory, ResourceLoader } from "../../src/index.ts";
import {
  type CreateTestExtensionsResultInput,
  createTestExtensionsResult,
  createTestResourceLoader,
} from "../utilities.ts";

type MessageTextPart = { type: "text"; text: string };

export function getMessageText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message)) {
    return "";
  }
  const content = (message as { content?: string | Array<{ type: string; text?: string }> }).content;
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is MessageTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function getUserTexts(harness: Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "user")
    .map((message) => getMessageText(message));
}

export function getAssistantTexts(harness: Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "assistant")
    .map((message) => getMessageText(message));
}

export interface HarnessOptions {
  tempRoot?: string;
  onTempDirCreated?: (tempDir: string) => void;
  models?: FauxModelDefinition[];
  settings?: Partial<Settings>;
  systemPrompt?: string;
  tools?: AgentTool[];
  initialActiveToolNames?: string[];
  allowedToolNames?: string[];
  excludedToolNames?: string[];
  resourceLoader?: ResourceLoader;
  extensionFactories?: Array<ExtensionFactory | CreateTestExtensionsResultInput>;
  withConfiguredAuth?: boolean;
  completionMode?: CompletionMode;
  taskVerificationMode?: TaskVerificationMode;
}

export interface Harness {
  session: AgentSession;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  authStorage: AuthStorage;
  faux: FauxProviderRegistration;
  models: [Model<string>, ...Model<string>[]];
  getModel(): Model<string>;
  getModel(modelId: string): Model<string> | undefined;
  setResponses: (responses: FauxResponseStep[]) => void;
  appendResponses: (responses: FauxResponseStep[]) => void;
  getPendingResponseCount: () => number;
  events: AgentSessionEvent[];
  eventsOfType<T extends AgentSessionEvent["type"]>(type: T): Extract<AgentSessionEvent, { type: T }>[];
  tempDir: string;
  cleanup: () => void;
}

interface HarnessConstruction {
  fauxProvider?: FauxProviderRegistration;
  session?: AgentSession;
}

function createTempDir(tempRoot: string = tmpdir()): string {
  return mkdtempSync(join(tempRoot, "pi-suite-"));
}

function collectHarnessCleanupFailures(construction: HarnessConstruction, tempDir: string): unknown[] {
  const failures: unknown[] = [];
  const cleanupSteps = [
    () => construction.session?.dispose(),
    () => construction.fauxProvider?.unregister(),
    () => {
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    },
  ];
  for (const cleanup of cleanupSteps) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function attachHarnessCleanupFailures(error: unknown, failures: unknown[]): void {
  if (!(error instanceof Error) || failures.length === 0) return;
  const causeDescriptor = Object.getOwnPropertyDescriptor(error, "cause");
  if ((!causeDescriptor && !Object.isExtensible(error)) || causeDescriptor?.configurable === false) return;
  const cleanupCause = new AggregateError(failures, "Harness rollback cleanup failed");
  Object.defineProperty(error, "cause", {
    configurable: true,
    value: error.cause === undefined ? cleanupCause : new AggregateError([error.cause, cleanupCause]),
  });
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const tempDir = createTempDir(options.tempRoot);
  const construction: HarnessConstruction = {};
  try {
    options.onTempDirCreated?.(tempDir);
    return await buildHarness(options, tempDir, construction);
  } catch (error) {
    attachHarnessCleanupFailures(error, collectHarnessCleanupFailures(construction, tempDir));
    throw error;
  }
}

async function buildHarness(
  options: HarnessOptions,
  tempDir: string,
  construction: HarnessConstruction,
): Promise<Harness> {
  const completionMode = options.completionMode ?? "explicit_finish";
  const fauxProvider: FauxProviderRegistration = registerFauxProvider({
    models: options.models,
    registerImmediately: false,
    preserveOnReset: true,
  });
  construction.fauxProvider = fauxProvider;
  fauxProvider.setResponses([]);
  const model = fauxProvider.getModel();
  const toolMap = options.tools ? Object.fromEntries(options.tools.map((tool) => [tool.name, tool])) : undefined;
  const withConfiguredAuth = options.withConfiguredAuth ?? true;
  const extensionRunnerRef: { current?: ExtensionRunner } = {};

  const sessionManager = SessionManager.inMemory(options.taskVerificationMode ? tempDir : undefined);
  const settingsManager = SettingsManager.inMemory(options.settings);
  const taskVerificationRuntime = options.taskVerificationMode
    ? prepareTaskVerificationRuntime(
        {
          taskVerificationMode: options.taskVerificationMode,
          completionMode,
          activeToolEffects: [resolveToolEffect({ kind: "workspace_write", risk: "normal" }, "builtin")],
        },
        sessionManager,
        settingsManager,
      )
    : undefined;

  const authStorage = AuthStorage.inMemory();
  if (withConfiguredAuth) {
    authStorage.setRuntimeApiKey(model.provider, "faux-key");
  }
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  if (withConfiguredAuth) {
    modelRegistry.registerProvider(model.provider, {
      baseUrl: model.baseUrl,
      apiKey: "faux-key",
      api: fauxProvider.api,
      models: fauxProvider.models.map((registeredModel) => ({
        id: registeredModel.id,
        name: registeredModel.name,
        api: registeredModel.api,
        reasoning: registeredModel.reasoning,
        input: registeredModel.input,
        cost: registeredModel.cost,
        contextWindow: registeredModel.contextWindow,
        maxTokens: registeredModel.maxTokens,
        baseUrl: registeredModel.baseUrl,
      })),
    });
  }

  const agent = new Agent({
    getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
    initialState: {
      model,
      systemPrompt: options.systemPrompt ?? "You are a test assistant.",
      tools: [],
    },
    convertToLlm,
    completionMode,
    onPayload: async (payload) => {
      const runner = extensionRunnerRef.current;
      if (!runner?.hasHandlers("before_provider_request")) {
        return payload;
      }
      return runner.emitBeforeProviderRequest(payload);
    },
    onResponse: async (response) => {
      const runner = extensionRunnerRef.current;
      if (!runner?.hasHandlers("after_provider_response")) {
        return;
      }
      await runner.emit({
        type: "after_provider_response",
        status: response.status,
        headers: response.headers,
      });
    },
    transformContext: async (messages: AgentMessage[]) => {
      const runner = extensionRunnerRef.current;
      if (!runner) return messages;
      return runner.emitContext(messages);
    },
  });
  const extensionsResult = options.extensionFactories
    ? await createTestExtensionsResult(options.extensionFactories, tempDir)
    : undefined;
  const resourceLoader =
    options.resourceLoader ?? createTestResourceLoader(extensionsResult ? { extensionsResult } : undefined);

  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd: tempDir,
    modelRegistry,
    resourceLoader,
    customTools: taskVerificationRuntime?.customTools,
    baseToolsOverride: toolMap,
    initialActiveToolNames: options.initialActiveToolNames,
    allowedToolNames: options.allowedToolNames,
    excludedToolNames: options.excludedToolNames,
    extensionRunnerRef,
    completionMode,
    taskVerificationMode: taskVerificationRuntime?.effectiveMode,
  });
  construction.session = session;
  if (taskVerificationRuntime) installTaskVerificationRuntime(session, taskVerificationRuntime);

  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });
  fauxProvider.register();

  return {
    session,
    sessionManager,
    settingsManager,
    authStorage,
    faux: fauxProvider,
    models: fauxProvider.models,
    getModel: fauxProvider.getModel,
    setResponses: fauxProvider.setResponses,
    appendResponses: fauxProvider.appendResponses,
    getPendingResponseCount: fauxProvider.getPendingResponseCount,
    events,
    eventsOfType<T extends AgentSessionEvent["type"]>(type: T) {
      return events.filter((event): event is Extract<AgentSessionEvent, { type: T }> => event.type === type);
    },
    tempDir,
    cleanup() {
      const failures = collectHarnessCleanupFailures(construction, tempDir);
      if (failures.length > 0) throw new AggregateError(failures, "Harness cleanup failed");
    },
  };
}
