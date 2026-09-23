import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getIndexedReposPath } from "../src/core/indexed-repos.ts";
import { IndexingService } from "../src/core/indexing-service.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type IndexingPromptContext = {
  sessionManager: { getCwd: () => string };
  indexingService: IndexingService;
  showExtensionSelector: (title: string, options: string[]) => Promise<string | undefined>;
  showStatus: (message: string) => void;
};

type InteractiveModePrototype = {
  promptForCodeIndexingIfNeeded(this: IndexingPromptContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRealRepo(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "a@b.com");
  git(repo, "config", "user.name", "a");
  fs.writeFileSync(path.join(repo, "f.txt"), "x\n");
  git(repo, "add", "f.txt");
  git(repo, "commit", "-qm", "init");
}

function makeContext(
  indexingService: IndexingService,
  cwd: string,
): IndexingPromptContext & { showExtensionSelector: ReturnType<typeof vi.fn> } {
  return {
    sessionManager: { getCwd: () => cwd },
    indexingService,
    showExtensionSelector: vi.fn(async () => undefined),
    showStatus: vi.fn(),
  };
}

describe("indexing decision inheritance for linked git worktrees", () => {
  beforeAll(() => initTheme("dark"));

  it("inherits an enabled decision from the main worktree without prompting, and requests background indexing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-worktree-enabled-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const mainRepo = path.join(root, "main");
    createRealRepo(mainRepo);
    const worktree = path.join(root, "feature");
    git(mainRepo, "worktree", "add", "-q", worktree, "-b", "feature");

    const indexingService = new IndexingService(agentDir);
    indexingService.enableIndexing(mainRepo);
    const context = makeContext(indexingService, worktree);

    await interactiveModePrototype.promptForCodeIndexingIfNeeded.call(context);

    expect(context.showExtensionSelector).not.toHaveBeenCalled();
    expect(indexingService.getDecision(worktree)).toBe("enabled");
    const stored = JSON.parse(fs.readFileSync(getIndexedReposPath(agentDir), "utf8")) as {
      repos: Array<{ path: string; decision: string }>;
    };
    // A persisted "enabled" entry for the worktree's own path is what makes the indexing
    // daemon pick it up and start indexing it in the background (see status-monitoring.ts).
    expect(stored.repos).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: fs.realpathSync(worktree), decision: "enabled" })]),
    );
  });

  it("inherits a disabled decision from the main worktree without prompting or indexing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-worktree-disabled-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const mainRepo = path.join(root, "main");
    createRealRepo(mainRepo);
    const worktree = path.join(root, "feature");
    git(mainRepo, "worktree", "add", "-q", worktree, "-b", "feature");

    const indexingService = new IndexingService(agentDir);
    indexingService.disableIndexing(mainRepo);
    const context = makeContext(indexingService, worktree);

    await interactiveModePrototype.promptForCodeIndexingIfNeeded.call(context);

    expect(context.showExtensionSelector).not.toHaveBeenCalled();
    expect(indexingService.getDecision(worktree)).toBe("disabled");
  });

  it("still prompts for a repository that is not a linked worktree", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-non-worktree-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const mainRepo = path.join(root, "main");
    createRealRepo(mainRepo);

    const indexingService = new IndexingService(agentDir);
    const context = makeContext(indexingService, mainRepo);

    await interactiveModePrototype.promptForCodeIndexingIfNeeded.call(context);

    expect(context.showExtensionSelector).toHaveBeenCalledOnce();
  });

  it("falls back to prompting when the linked worktree's main checkout is a bare repository", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-bare-main-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const bareRepo = path.join(root, "repo.git");
    fs.mkdirSync(bareRepo, { recursive: true });
    git(bareRepo, "init", "-q", "--bare");
    // A bare repo has no working tree to commit against directly; seed it through a
    // throwaway worktree so the real linked worktree below has a commit to check out.
    const seed = path.join(root, "seed");
    git(bareRepo, "worktree", "add", "-q", seed, "-b", "main");
    git(seed, "config", "user.email", "a@b.com");
    git(seed, "config", "user.name", "a");
    fs.writeFileSync(path.join(seed, "f.txt"), "x\n");
    git(seed, "add", "f.txt");
    git(seed, "commit", "-qm", "init");
    const worktree = path.join(root, "feature");
    git(bareRepo, "worktree", "add", "-q", worktree, "-b", "feature");

    const indexingService = new IndexingService(agentDir);
    const context = makeContext(indexingService, worktree);

    await interactiveModePrototype.promptForCodeIndexingIfNeeded.call(context);

    expect(context.showExtensionSelector).toHaveBeenCalledOnce();
  });
});
