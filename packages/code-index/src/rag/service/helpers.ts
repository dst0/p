import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EmbeddingError, VectorStoreError } from "../../embed/errors.ts";
import type { RagErrorCode, StoredChunkPayload } from "../types.ts";
import { CodeRagError } from "./coderagerror.ts";

export function normalizeRepositoryPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function normalizePathFilter(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
    throw new CodeRagError("RAG_SECURITY_BLOCK", "Path filter must be repository-relative");
  }
  const clean = path.posix.normalize(normalized);
  if (clean === ".." || clean.startsWith("../")) {
    throw new CodeRagError("RAG_SECURITY_BLOCK", "Path filter cannot escape the repository");
  }
  return clean;
}

export function hashText(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fileIdFor(repoId: string, relativePath: string): string {
  return hashText(`${repoId}\0${relativePath}`);
}

export function chunkPointId(
  repoId: string,
  fileId: string,
  fileHash: string,
  ordinal: number,
  chunkHash: string,
): string {
  const digest = hashText(`${repoId}\0${fileId}\0${fileHash}\0${ordinal}\0${chunkHash}`).slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = "8";
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isTestPath(relativePath: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)/i.test(relativePath) || /\.(test|spec)\.[^/]+$/i.test(relativePath);
}

export function isGeneratedPath(relativePath: string): boolean {
  return (
    /(^|\/)(generated|gen)(\/|$)/i.test(relativePath) || /(^|\.)generated\./i.test(path.posix.basename(relativePath))
  );
}

export function buildRetrievalText(
  path: string,
  language: string,
  symbolName: string,
  symbolType: string,
  code: string,
  maxChars: number,
): string {
  const header = `file: ${path}\nlanguage: ${language}\nsymbol: ${symbolName}\nkind: ${symbolType}\n\n`;
  const headerLen = header.length;
  const maxCodeChars = Math.max(0, maxChars - headerLen);
  const truncatedCode = code.length > maxCodeChars ? code.slice(0, maxCodeChars) : code;
  return header + truncatedCode;
}

export function retrievalTextForPayload(payload: StoredChunkPayload, maxChars: number): string {
  return buildRetrievalText(
    payload.path,
    payload.language,
    payload.symbolName,
    payload.symbolType,
    payload.content,
    maxChars,
  );
}

export function unlinkBestEffort(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Generation cleanup must not mask the indexing failure.
  }
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

export function classifySearchError(error: unknown): { code: RagErrorCode; message: string } {
  if (error instanceof EmbeddingError) {
    if (error.type === "server_down") {
      return { code: "RAG_EMBEDDING_SERVER_DOWN", message: error.message };
    }
    if (error.type === "server_error") {
      return { code: "RAG_EMBEDDING_SERVER_ERROR", message: error.message };
    }
    return { code: "RAG_EMBEDDING_SERVER_ERROR", message: error.message };
  }
  if (error instanceof VectorStoreError) {
    if (error.type === "qdrant_down") {
      return { code: "RAG_QDRANT_DOWN", message: error.message };
    }
    if (error.type === "network") {
      return { code: "RAG_NETWORK_ERROR", message: error.message };
    }
    return { code: "RAG_QDRANT_ERROR", message: error.message };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { code: "RAG_TIMEOUT", message: "Code RAG search timed out" };
  }
  return { code: "RAG_NETWORK_ERROR", message: safeErrorMessage(error) };
}

export function mapOperationError(error: unknown, signal: AbortSignal): CodeRagError {
  if (error instanceof CodeRagError) return error;
  if (signal.aborted) return new CodeRagError("RAG_CANCELLED", "Code RAG refresh was cancelled");
  if (error instanceof Error && error.name === "TimeoutError") {
    return new CodeRagError("RAG_TIMEOUT", "Code RAG operation timed out");
  }
  return new CodeRagError("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
}

export function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CodeRagError("RAG_CANCELLED", "Code RAG operation was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
