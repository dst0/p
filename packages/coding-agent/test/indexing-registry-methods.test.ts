import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeIndexingBackendWakeForRepo,
  acknowledgeIndexingPriorityForRepo,
  enableIndexingForRepo,
  loadIndexedRepos,
  prioritizeIndexingForRepo,
  recordIndexingResourceFailureForRepo,
  requestIndexingBackendForRepo,
} from "../src/core/indexed-repos.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("indexing registry helper methods", () => {
  it("covers request, prioritize, acknowledge, and resource failure operations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-reg-helper-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });

    enableIndexingForRepo(repo, agentDir);

    const wakeReq = requestIndexingBackendForRepo(repo, agentDir);
    expect(wakeReq?.backendWakeRequest?.id).toBeTruthy();
    expect(acknowledgeIndexingBackendWakeForRepo(repo, wakeReq!.backendWakeRequest!.id, agentDir)).toBe(true);

    const prioReq = prioritizeIndexingForRepo(repo, agentDir);
    expect(prioReq?.priorityRequest?.id).toBeTruthy();
    expect(acknowledgeIndexingPriorityForRepo(repo, prioReq!.priorityRequest!.id, agentDir)).toBe(true);

    const failure = recordIndexingResourceFailureForRepo(repo, "OOM fatal error", agentDir);
    expect(failure?.resourceFailure?.message).toBe("OOM fatal error");
    expect(loadIndexedRepos(agentDir)[0]?.resourceFailure?.message).toBe("OOM fatal error");

    const rePrio = prioritizeIndexingForRepo(repo, agentDir);
    expect(rePrio?.resourceFailure).toBeUndefined();

    const origDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      requestIndexingBackendForRepo(repo);
      prioritizeIndexingForRepo(repo);
      acknowledgeIndexingPriorityForRepo(repo, "any");
      acknowledgeIndexingBackendWakeForRepo(repo, "any");
      recordIndexingResourceFailureForRepo(repo, "err");
    } finally {
      if (origDir !== undefined) process.env.PI_CODING_AGENT_DIR = origDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});
