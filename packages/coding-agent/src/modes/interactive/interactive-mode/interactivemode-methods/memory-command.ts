import * as path from "node:path";
import { Spacer, Text } from "@dst0/p-tui";
import { findIndexWorkspaceRoot } from "../../../../core/indexed-repos.ts";
import { LearningsStore } from "../../../../core/learnings/learnings-store.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_handleMemoryCommand(self: InteractiveMode, text: string): void {
  const args = text.replace(/^\/memory\s*/, "").trim();
  const spaceIndex = args.indexOf(" ");
  const command = (spaceIndex === -1 ? args : args.slice(0, spaceIndex)) || "status";
  const rest = spaceIndex === -1 ? "" : args.slice(spaceIndex + 1).trim();

  try {
    let info = `${theme.bold("Project Memory")}\n\n`;
    switch (command) {
      case "status":
      case "init": {
        const result = self.session.initProjectMemory();
        info += `${theme.fg("dim", "Root:")} ${result.root}\n`;
        info += `${theme.fg("dim", "Created:")} ${result.created.length}\n`;
        info += `${theme.fg("dim", "Existing:")} ${result.existing.length}`;
        break;
      }
      case "search": {
        if (!rest) {
          info += "Usage: /memory search <query>";
          break;
        }
        const result = self.session.searchProjectMemory(rest);
        info += `${theme.fg("dim", "Query:")} ${result.query}\n`;
        info += result.hits.length
          ? result.hits.map((hit) => `- ${hit.path}:${hit.line} ${hit.excerpt}`).join("\n")
          : "No matches.";
        break;
      }
      case "pin": {
        const result = self.session.pinProjectMemory(rest);
        info += `${theme.fg("dim", "Pinned:")} ${result.id}\n`;
        info += `${theme.fg("dim", "File:")} ${result.path}`;
        break;
      }
      case "forget": {
        const result = self.session.forgetProjectMemory(rest);
        info += `${theme.fg("dim", "Forgot:")} ${result.id}\n`;
        info += `${theme.fg("dim", "Removed:")} ${result.removed}\n`;
        info += `${theme.fg("dim", "Files:")} ${result.files.join(", ") || "(none)"}`;
        break;
      }
      default:
        info += "Usage: /memory [status|init|search <query>|pin <text>|forget <id>]";
    }

    self.chatContainer.addChild(new Spacer(1));
    self.chatContainer.addChild(new Text(info, 1, 0));
    self.ui.requestRender();
  } catch (error) {
    self.showError(error instanceof Error ? error.message : String(error));
  }
}

export function do_handleRulesCommand(self: InteractiveMode, text: string): void {
  const args = text.replace(/^\/rules\s*/, "").trim();
  const spaceIndex = args.indexOf(" ");
  const command = (spaceIndex === -1 ? args : args.slice(0, spaceIndex)) || "lint";
  const rest = spaceIndex === -1 ? "" : args.slice(spaceIndex + 1).trim();

  try {
    let info = `${theme.bold("Project Rules")}\n\n`;
    switch (command) {
      case "lint": {
        const result = self.session.lintProjectRules();
        const showAll = rest === "--all";
        const maxVisibleIssues = showAll ? result.issues.length : 20;
        const visibleIssues = result.issues.slice(0, maxVisibleIssues);
        info += `${theme.fg("dim", "Files:")} ${result.index.files.length}\n`;
        info += `${theme.fg("dim", "Snippets:")} ${result.index.snippets.length}\n`;
        info += `${theme.fg("dim", "Issues:")} ${result.issues.length}\n`;
        info += visibleIssues.length
          ? visibleIssues
              .map((issue) => {
                const location = issue.path
                  ? `${path.relative(self.sessionManager.getCwd(), issue.path)}${issue.line ? `:${issue.line}` : ""} `
                  : "";
                return `- [${issue.severity}] ${issue.code}: ${location}${issue.message}`;
              })
              .join("\n")
          : "No rule issues detected.";
        if (visibleIssues.length < result.issues.length) {
          info += `\n... ${result.issues.length - visibleIssues.length} more issue(s). Run /rules lint --all for the full list.`;
        }
        break;
      }
      case "explain": {
        if (!rest) {
          info += "Usage: /rules explain <query>";
          break;
        }
        const result = self.session.explainProjectRules(rest);
        info += `${theme.fg("dim", "Query:")} ${result.query}\n`;
        info += result.content;
        break;
      }
      default:
        info += "Usage: /rules [lint [--all]|explain <query>]";
    }

    self.chatContainer.addChild(new Spacer(1));
    self.chatContainer.addChild(new Text(info, 1, 0));
    self.ui.requestRender();
  } catch (error) {
    self.showError(error instanceof Error ? error.message : String(error));
  }
}

export async function do_handleIndexCommand(self: InteractiveMode, text?: string): Promise<void> {
  const args = (text ?? "").replace(/^\/index\s*/, "").trim();
  const workspaceRoot = findIndexWorkspaceRoot(self.sessionManager.getCwd());
  const info = await self.buildIndexStatusText(workspaceRoot, args);

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Text(info, 1, 0));
  self.ui.requestRender();
}

export function do_handleLearnCommand(self: InteractiveMode, text: string): void {
  const args = text.replace(/^\/learn\s*/, "").trim();

  try {
    let info = `${theme.bold("Continuous Learnings")}\n\n`;

    if (!args || args === "help") {
      info += "Usage: /learn <trap> -> <fix> [tags: tag1, tag2]\n";
      info += "       /learn list\n";
      info += "       /learn query <search terms>";
    } else if (args === "list") {
      const store = new LearningsStore({ cwd: self.sessionManager.getCwd() });
      const entries = store.loadAll();
      info += `${theme.fg("dim", "Total:")} ${entries.length}\n`;
      info += entries.length
        ? entries.map((e, i) => `${i + 1}. Rule: ${e.rule}\n   Trap: ${e.trap} -> Fix: ${e.fix}`).join("\n\n")
        : "No recorded learnings yet.";
    } else if (args.startsWith("query ") || args.startsWith("search ")) {
      const queryText = args.replace(/^(query|search)\s+/, "").trim();
      const store = new LearningsStore({ cwd: self.sessionManager.getCwd() });
      const matches = store.query({ queryText });
      info += `${theme.fg("dim", "Query:")} ${queryText}\n`;
      info += matches.length
        ? matches
            .map(
              (m, i) =>
                `${i + 1}. ${m.entry.rule} (score: ${m.score})\n   Trap: ${m.entry.trap} -> Fix: ${m.entry.fix}`,
            )
            .join("\n\n")
        : "No matching learnings.";
    } else {
      let trap = "";
      let fix = "";
      let rule = "";
      let tags: string[] = [];

      if (args.includes("->")) {
        const parts = args.split("->");
        trap = parts[0].trim();
        let rest = parts[1].trim();

        const tagsMatch = rest.match(/\[(.*?)\]/) || rest.match(/(?:tags?:\s*)([^\n]+)$/i);
        if (tagsMatch) {
          tags = tagsMatch[1]
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          rest = rest.replace(tagsMatch[0], "").trim();
        }
        fix = rest;
        rule = `${fix} (Avoid: ${trap})`;
      } else {
        rule = args;
        trap = args;
        fix = args;
      }

      const store = new LearningsStore({ cwd: self.sessionManager.getCwd() });
      const entry = store.record({
        trap,
        fix,
        rule,
        tags,
        cwd: self.sessionManager.getCwd(),
      });

      info += `${theme.fg("dim", "Recorded:")}\n`;
      info += `- Rule: ${entry.rule}\n`;
      info += `- Trap: ${entry.trap}\n`;
      info += `- Fix: ${entry.fix}\n`;
      info += `- Tags: ${(entry.tags ?? []).join(", ") || "(none)"}\n`;
      info += `${theme.fg("dim", "Saved to:")} ${store.getProjectFilePath()}`;
    }

    self.chatContainer.addChild(new Spacer(1));
    self.chatContainer.addChild(new Text(info, 1, 0));
    self.ui.requestRender();
  } catch (error) {
    self.showError(error instanceof Error ? error.message : String(error));
  }
}
