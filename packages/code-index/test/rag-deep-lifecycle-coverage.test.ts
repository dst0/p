import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCliMain } from "../src/cli.ts";
import { discoverFilesWithOptions } from "../src/discover.ts";
import { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";

describe("rag-deep-lifecycle-coverage", () => {
  describe("cli.ts error path handling", () => {
    it("catches fatal CLI errors and exits with code 1", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null | undefined) => {
        throw new Error(`process.exit: ${code}`);
      }) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await expect(runCliMain(["node", "cli.ts", "--unknown-flag"])).rejects.toThrow("process.exit: 1");
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe("discoverFiles binary and whitespace filtering", () => {
    it("filters out binary files, empty/whitespace files, and files exceeding max size", () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-filter-"));
      try {
        const binFile = path.join(tmpRoot, "binary.dat");
        fs.writeFileSync(binFile, Buffer.from([0, 1, 2, 3, 0, 5]));

        const spaceFile = path.join(tmpRoot, "spaces.ts");
        fs.writeFileSync(spaceFile, "   \n\n\t  \n");

        const largeFile = path.join(tmpRoot, "large.ts");
        fs.writeFileSync(largeFile, "a".repeat(2000));

        const goodFile = path.join(tmpRoot, "valid.ts");
        fs.writeFileSync(goodFile, "export const x = 1;\n");

        const discovered = discoverFilesWithOptions(tmpRoot, { maxFileSize: 1000 });
        expect(discovered).toEqual([goodFile]);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });

  describe("WorkspaceCodeRagService lifecycle and edge branches", () => {
    it("handles disabled service and disposed service states", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-lifecycle-"));
      try {
        const service = new WorkspaceCodeRagService({
          workspaceRoot: tmpDir,
          dataDirectory: tmpDir,
          settings: { enabled: false },
        });

        const status = await service.initialize();
        expect(status.state).toBe("disabled");

        const searchRes = await service.search({ query: "test" });
        expect(searchRes.results).toEqual([]);

        const refreshRes = await service.refresh();
        expect(refreshRes.fullRebuild).toBe(false);

        const rebuildRes = await service.rebuild();
        expect(rebuildRes.fullRebuild).toBe(true);

        await service.dispose();
        // Second dispose should be a no-op
        await service.dispose();

        // Initializing a disposed service throws RAG_BACKEND_UNAVAILABLE
        await expect(service.initialize()).rejects.toThrow("Code RAG service has been disposed");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles configuration error states gracefully", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-conf-err-"));
      try {
        const service = new WorkspaceCodeRagService({
          workspaceRoot: tmpDir,
          dataDirectory: tmpDir,
          settings: { embeddingServerUrl: "bad-url-no-protocol" },
        });

        expect(service.configurationError).toBeDefined();
        const status = await service.initialize();
        expect(status.state).toBe("unavailable");

        await expect(service.refresh()).rejects.toThrow("Code RAG embeddingServerUrl must be a valid absolute URL");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
