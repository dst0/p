import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";

const mocks = vi.hoisted(() => {
  return {
    createAgentSessionRuntime: vi.fn(async () => {
      throw new Error("metadata command created a full agent session");
    }),
    createAgentSessionFromServices: vi.fn(),
    listModels: vi.fn(async (_modelRegistry: ModelRegistry, _searchPattern?: string) => undefined),
    printHelp: vi.fn(),
  };
});

vi.mock("../src/core/agent-session-runtime.ts", () => ({
  createAgentSessionRuntime: mocks.createAgentSessionRuntime,
}));
vi.mock("../src/core/agent-session-services.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/agent-session-services.ts")>()),
  createAgentSessionFromServices: mocks.createAgentSessionFromServices,
}));
vi.mock("../src/cli/args.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/args.ts")>()),
  printHelp: mocks.printHelp,
}));
vi.mock("../src/cli/list-models.ts", () => ({ listModels: mocks.listModels }));
vi.mock("../src/core/http-dispatcher.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/http-dispatcher.ts")>()),
  configureHttpDispatcher: vi.fn(),
}));
vi.mock("../src/migrations.ts", () => ({
  runMigrations: vi.fn(() => ({ deprecationWarnings: [], migratedAuthProviders: [] })),
  showDeprecationWarnings: vi.fn(),
}));

import { main } from "../src/main/command-dispatch.ts";

let originalAgentDir: string | undefined;
let originalCwd: string;
let tempDir: string;

const metadataExtension: ExtensionFactory = (pi) => {
  pi.registerFlag("extension-flag", {
    description: "Metadata-only extension flag",
    type: "boolean",
  });
  pi.registerProvider("metadata-provider", {
    api: "openai-completions",
    apiKey: "test-key",
    baseUrl: "https://metadata-provider.test/v1",
    models: [
      {
        id: "metadata-model",
        name: "Metadata Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_000,
        maxTokens: 4_096,
      },
    ],
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  originalAgentDir = process.env[ENV_AGENT_DIR];
  originalCwd = process.cwd();
  tempDir = mkdtempSync(join(tmpdir(), "p-runtime-metadata-"));
  const agentDir = join(tempDir, "agent");
  process.env[ENV_AGENT_DIR] = agentDir;
  mkdirSync(agentDir, { recursive: true });
  process.chdir(tempDir);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
  else process.env[ENV_AGENT_DIR] = originalAgentDir;
  rmSync(tempDir, { force: true, recursive: true });
  vi.restoreAllMocks();
});

describe("runtime metadata commands", () => {
  it("prints help with extension flags without creating an agent session", async () => {
    await expect(main(["--help"], { extensionFactories: [metadataExtension] })).resolves.toBeUndefined();

    expect(mocks.createAgentSessionFromServices).not.toHaveBeenCalled();
    expect(mocks.createAgentSessionRuntime).not.toHaveBeenCalled();
    expect(mocks.printHelp).toHaveBeenCalledWith([
      expect.objectContaining({ name: "extension-flag", type: "boolean" }),
    ]);
  });

  it("lists extension-registered models without creating an agent session", async () => {
    await expect(main(["--list-models"], { extensionFactories: [metadataExtension] })).resolves.toBeUndefined();

    expect(mocks.createAgentSessionFromServices).not.toHaveBeenCalled();
    expect(mocks.createAgentSessionRuntime).not.toHaveBeenCalled();
    const modelRegistry = mocks.listModels.mock.calls[0]?.[0];
    expect(modelRegistry?.getAvailable()).toContainEqual(
      expect.objectContaining({ id: "metadata-model", provider: "metadata-provider" }),
    );
    expect(mocks.listModels).toHaveBeenCalledWith(modelRegistry, undefined);
  });
});
