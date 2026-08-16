import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LearningEntry, LearningMatch, LearningQueryCriteria } from "./types.ts";

/**
 * Robust, append-only store for project and global agent learnings in JSONL format.
 */
export class LearningsStore {
  private readonly projectFilePath: string;
  private readonly globalFilePath: string;

  constructor(options?: { cwd?: string; globalDir?: string }) {
    const cwd = options?.cwd ?? process.cwd();
    const globalDir = options?.globalDir ?? join(homedir(), ".p");

    this.projectFilePath = join(cwd, ".agents", "learnings.jsonl");
    this.globalFilePath = join(globalDir, "learnings.jsonl");
  }

  getProjectFilePath(): string {
    return this.projectFilePath;
  }

  getGlobalFilePath(): string {
    return this.globalFilePath;
  }

  record(entry: Omit<LearningEntry, "timestamp">, scope: "project" | "global" = "project"): LearningEntry {
    const fullEntry: LearningEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const targetPath = scope === "global" ? this.globalFilePath : this.projectFilePath;
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const line = `${JSON.stringify(fullEntry)}\n`;
    appendFileSync(targetPath, line, "utf8");

    return fullEntry;
  }

  loadAll(scope: "all" | "project" | "global" = "all"): LearningEntry[] {
    const entries: LearningEntry[] = [];
    const seen = new Set<string>();

    if (scope === "all" || scope === "project") {
      this.readEntriesFromFile(this.projectFilePath, entries, seen);
    }
    if (scope === "all" || scope === "global") {
      this.readEntriesFromFile(this.globalFilePath, entries, seen);
    }

    return entries;
  }

  getRecent(limit = 5, scope: "all" | "project" | "global" = "project"): LearningEntry[] {
    const all = this.loadAll(scope);
    if (all.length <= limit) {
      return all;
    }
    return all.slice(all.length - limit);
  }

  query(criteria: LearningQueryCriteria): LearningMatch[] {
    const all = this.loadAll();
    const matches: LearningMatch[] = [];

    const queryTokens = criteria.queryText ? criteria.queryText.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const targetTags = criteria.tags ? criteria.tags.map((t) => t.toLowerCase()) : [];

    for (const entry of all) {
      const match = this.scoreEntry(entry, queryTokens, targetTags);
      if (match.score > 0) {
        matches.push(match);
      }
    }

    matches.sort((a, b) => b.score - a.score);

    if (criteria.limit && criteria.limit > 0) {
      return matches.slice(0, criteria.limit);
    }
    return matches;
  }

  formatForPrompt(limit = 5): string | undefined {
    const projectEntries = this.getRecent(limit, "project");
    if (projectEntries.length === 0) {
      return undefined;
    }

    const lines = projectEntries.map((e) => `- ${e.rule} (Trap: ${e.trap} -> Fix: ${e.fix})`);
    return `Project Learnings:\n${lines.join("\n")}`;
  }

  private scoreEntry(entry: LearningEntry, queryTokens: string[], targetTags: string[]): LearningMatch {
    let score = 0;
    const matchedTags: string[] = [];

    const entryTags = (entry.tags ?? []).map((t) => t.toLowerCase());

    for (const targetTag of targetTags) {
      if (entryTags.includes(targetTag)) {
        score += 30;
        matchedTags.push(targetTag);
      }
    }

    const textToSearch = `${entry.trap} ${entry.fix} ${entry.rule} ${(entry.tags ?? []).join(" ")}`.toLowerCase();

    for (const token of queryTokens) {
      if (textToSearch.includes(token)) {
        score += 15;
      }
    }

    return {
      entry,
      score,
      matchedTags,
    };
  }

  private readEntriesFromFile(filePath: string, outList: LearningEntry[], seenRules: Set<string>): void {
    if (!existsSync(filePath)) return;

    let content = "";
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      return;
    }

    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as LearningEntry;
        if (parsed.rule && !seenRules.has(parsed.rule)) {
          seenRules.add(parsed.rule);
          outList.push(parsed);
        }
      } catch {
        // Resiliently ignore corrupted lines
      }
    }
  }
}
