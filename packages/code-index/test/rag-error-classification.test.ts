import { describe, expect, it } from "vitest";
import { EmbeddingError, VectorStoreError } from "../src/embed/errors.ts";
import { CodeRagError } from "../src/rag/service/coderagerror.ts";
import { classifySearchError, mapOperationError, unlinkBestEffort } from "../src/rag/service/helpers.ts";

describe("RAG error classification and cleanup helpers", () => {
  it("classifies diverse error types to standard RAG error codes", () => {
    const serverDown = new EmbeddingError("server_down", "down");
    expect(classifySearchError(serverDown).code).toBe("RAG_EMBEDDING_SERVER_DOWN");

    const serverErr = new EmbeddingError("server_error", "err");
    expect(classifySearchError(serverErr).code).toBe("RAG_EMBEDDING_SERVER_ERROR");

    const otherEmbed = new EmbeddingError("other" as unknown as "server_error", "other");
    expect(classifySearchError(otherEmbed).code).toBe("RAG_EMBEDDING_SERVER_ERROR");

    const qdrantDown = new VectorStoreError("qdrant_down", "down");
    expect(classifySearchError(qdrantDown).code).toBe("RAG_QDRANT_DOWN");

    const qdrantNet = new VectorStoreError("network", "net");
    expect(classifySearchError(qdrantNet).code).toBe("RAG_NETWORK_ERROR");

    const qdrantStore = new VectorStoreError("qdrant_error", "store");
    expect(classifySearchError(qdrantStore).code).toBe("RAG_QDRANT_ERROR");

    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    expect(classifySearchError(timeout).code).toBe("RAG_TIMEOUT");

    expect(classifySearchError("string failure").code).toBe("RAG_NETWORK_ERROR");
  });

  it("unlinkBestEffort ignores missing files silently", () => {
    expect(() => unlinkBestEffort("/nonexistent/file/path")).not.toThrow();
  });

  it("maps error instances across all RAG operation error types", () => {
    const signal = new AbortController().signal;
    const codeRagErr = new CodeRagError("RAG_EMBEDDING_SERVER_DOWN", "down");
    expect(mapOperationError(codeRagErr, signal)).toBe(codeRagErr);

    const embedErr = new EmbeddingError("server_down", "down");
    expect(mapOperationError(embedErr, signal).code).toBe("RAG_BACKEND_UNAVAILABLE");

    const timeoutErr = new Error("timeout");
    timeoutErr.name = "TimeoutError";
    expect(mapOperationError(timeoutErr, signal).code).toBe("RAG_TIMEOUT");

    const genericErr = new Error("something went wrong");
    expect(mapOperationError(genericErr, signal).code).toBe("RAG_BACKEND_UNAVAILABLE");

    const abortedCtrl = new AbortController();
    abortedCtrl.abort();
    expect(mapOperationError(new Error("aborted"), abortedCtrl.signal).code).toBe("RAG_CANCELLED");
  });
});
