import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";

describe("workspace code RAG config validation and resolution", () => {
  it("throws on invalid protocol or remote URL without remoteBackendsAllowed", () => {
    expect(() => {
      loadWorkspaceCodeRagSettings({
        workspaceRoot: "/tmp",
        dataDirectory: "/tmp/data",
        settings: { embeddingServerUrl: "ftp://localhost:8080" },
      });
    }).toThrow("Code RAG embeddingServerUrl must be a valid absolute URL");

    expect(() => {
      loadWorkspaceCodeRagSettings({
        workspaceRoot: "/tmp",
        dataDirectory: "/tmp/data",
        settings: { embeddingServerUrl: "http://example.com:8080", remoteBackendsAllowed: false },
      });
    }).toThrow("must be local unless remoteBackendsAllowed is explicitly enabled");
  });

  it("handles malformed config JSON files gracefully with clear error", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-conf-err-"));
    try {
      const confFile = path.join(tmpDir, "bad.json");
      fs.writeFileSync(confFile, "{ broken json");
      expect(() => {
        loadWorkspaceCodeRagSettings({
          workspaceRoot: "/tmp",
          dataDirectory: "/tmp/data",
          userConfigPath: confFile,
        });
      }).toThrow("Invalid code RAG config");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when numeric settings are zero or negative", () => {
    expect(() => {
      loadWorkspaceCodeRagSettings({
        workspaceRoot: "/tmp",
        dataDirectory: "/tmp",
        settings: { encodeBatchSize: 0 },
      });
    }).toThrow("Code RAG numeric settings must be positive");
  });
});
