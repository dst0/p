import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true });
});

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-endpoint-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("Qdrant endpoint ownership", () => {
  it("canonicalizes managed local endpoints", () => {
    const directory = createDirectory();
    const load = (qdrantUrl: string) =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: directory,
        workspaceRoot: directory,
        settings: { qdrantUrl },
      }).qdrantUrl;

    expect(load("http://localhost")).toBe("http://127.0.0.1:6333");
    expect(load("http://127.0.0.1:7444")).toBe("http://127.0.0.1:7444");
    expect(() => load("http://localhost:0")).toThrow("qdrantUrl has an invalid port");
  });

  it("validates external endpoint structure even when remote backends are allowed", () => {
    const directory = createDirectory();
    const load = (qdrantUrl: string) =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: directory,
        workspaceRoot: directory,
        settings: { qdrantUrl, remoteBackendsAllowed: true },
      });

    expect(() => load("httpx://remote.example.test")).toThrow("must be a valid absolute URL");
    for (const qdrantUrl of [
      "http://0.0.0.0:6333",
      "http://user:pass@127.0.0.1:6333",
      "http://127.0.0.1:6333/tenant",
      "http://127.0.0.1:6333/?tenant=one",
    ]) {
      expect(() => load(qdrantUrl)).toThrow("Code RAG qdrantUrl");
    }
  });

  it("never creates a local manager for an external endpoint", () => {
    const directory = createDirectory();
    const service = new WorkspaceCodeRagService({
      workspaceRoot: directory,
      dataDirectory: directory,
      settings: { remoteBackendsAllowed: true, qdrantUrl: "https://qdrant.example.test:6333" },
    });

    expect(service.qdrantServerManager).toBeNull();
  });
});
