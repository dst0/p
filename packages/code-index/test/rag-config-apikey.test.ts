import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

const temporaryDirectories: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-apikey-test-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.P_QDRANT_API_KEY;
  delete process.env.QDRANT_API_KEY;
});

describe("loadWorkspaceCodeRagSettings qdrantApiKey resolution", () => {
  it("resolves qdrantApiKey from explicit settings option", () => {
    const dir = createTempDir();
    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      settings: { qdrantApiKey: "explicit-key-1" },
    });
    expect(settings.qdrantApiKey).toBe("explicit-key-1");
  });

  it("resolves qdrantApiKey from code-rag.json file", () => {
    const dir = createTempDir();
    const configPath = path.join(dir, "code-rag.json");
    fs.writeFileSync(configPath, JSON.stringify({ qdrantApiKey: "file-key-2" }));

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      userConfigPath: configPath,
    });
    expect(settings.qdrantApiKey).toBe("file-key-2");
  });

  it("resolves qdrantApiKey from environment variable", () => {
    const dir = createTempDir();
    process.env.P_QDRANT_API_KEY = "env-key-3";

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
    });
    expect(settings.qdrantApiKey).toBe("env-key-3");
  });

  it("resolves qdrantApiKey from qdrant.key in qdrantDataDirectory", () => {
    const dir = createTempDir();
    const qdrantDir = path.join(dir, "qdrant");
    fs.mkdirSync(qdrantDir, { recursive: true });
    fs.writeFileSync(path.join(qdrantDir, "qdrant.key"), "stored-disk-key-4\n");

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      settings: { qdrantDataDirectory: qdrantDir },
    });
    expect(settings.qdrantApiKey).toBe("stored-disk-key-4");
  });

  it("prioritizes P_QDRANT_API_KEY over QDRANT_API_KEY", () => {
    const dir = createTempDir();
    process.env.P_QDRANT_API_KEY = "priority-p-key";
    process.env.QDRANT_API_KEY = "fallback-key";

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
    });
    expect(settings.qdrantApiKey).toBe("priority-p-key");
  });

  it("falls back to QDRANT_API_KEY when P_QDRANT_API_KEY is unset", () => {
    const dir = createTempDir();
    delete process.env.P_QDRANT_API_KEY;
    process.env.QDRANT_API_KEY = "fallback-qdrant-key";

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
    });
    expect(settings.qdrantApiKey).toBe("fallback-qdrant-key");
  });

  it("prioritizes config file over environment variables and qdrant.key", () => {
    const dir = createTempDir();
    const configPath = path.join(dir, "code-rag.json");
    fs.writeFileSync(configPath, JSON.stringify({ qdrantApiKey: "config-file-wins" }));
    process.env.P_QDRANT_API_KEY = "env-loses";

    const qdrantDir = path.join(dir, "qdrant");
    fs.mkdirSync(qdrantDir, { recursive: true });
    fs.writeFileSync(path.join(qdrantDir, "qdrant.key"), "disk-loses\n");

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      userConfigPath: configPath,
      settings: { qdrantDataDirectory: qdrantDir },
    });
    expect(settings.qdrantApiKey).toBe("config-file-wins");
  });

  it("ignores whitespace-only env var and falls back to qdrant.key", () => {
    const dir = createTempDir();
    process.env.P_QDRANT_API_KEY = "   ";
    process.env.QDRANT_API_KEY = "";

    const qdrantDir = path.join(dir, "qdrant");
    fs.mkdirSync(qdrantDir, { recursive: true });
    fs.writeFileSync(path.join(qdrantDir, "qdrant.key"), "valid-disk-key\n");

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      settings: { qdrantDataDirectory: qdrantDir },
    });
    expect(settings.qdrantApiKey).toBe("valid-disk-key");
  });
});

describe("QdrantVectorStore apiKey header", () => {
  it("attaches api-key header when apiKey option is provided", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const mockFetch = (async (_url: string | URL | Request, options?: RequestInit) => {
      capturedHeaders = options?.headers as Record<string, string>;
      return new Response(JSON.stringify({ result: { exists: true } }), { status: 200 });
    }) as unknown as typeof fetch;

    const store = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 5000,
      apiKey: "secret-key-12345",
      fetch: mockFetch,
    });

    expect(await store.collectionExists("test-collection")).toBe(true);
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.["api-key"]).toBe("secret-key-12345");
  });

  it("does not attach api-key header when apiKey option is undefined", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const mockFetch = (async (_url: string | URL | Request, options?: RequestInit) => {
      capturedHeaders = options?.headers as Record<string, string>;
      return new Response(JSON.stringify({ result: { exists: true } }), { status: 200 });
    }) as unknown as typeof fetch;

    const store = new QdrantVectorStore({
      url: "http://localhost:6333",
      timeoutMs: 5000,
      apiKey: undefined,
      fetch: mockFetch,
    });

    expect(await store.collectionExists("test-collection")).toBe(true);
    expect(capturedHeaders?.["api-key"]).toBeUndefined();
  });
});
