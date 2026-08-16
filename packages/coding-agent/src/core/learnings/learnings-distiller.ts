import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningEntry } from "./types.ts";

export interface DistilledCluster {
  tag: string;
  entries: LearningEntry[];
  suggestedSkillName: string;
  suggestedDescription: string;
  rules: string[];
}

export interface PromoteToAgentsMdResult {
  success: boolean;
  filePath: string;
  addedRules: string[];
}

export interface PromoteToSkillResult {
  success: boolean;
  skillFilePath: string;
  rulesCount: number;
}

export class LearningsDistiller {
  /**
   * Clusters learnings by primary tag and distills common rules.
   */
  distillClusters(entries: LearningEntry[], minClusterSize = 2): DistilledCluster[] {
    const tagMap = new Map<string, LearningEntry[]>();
    for (const entry of entries) {
      for (const tag of entry.tags ?? []) {
        const normalized = tag.toLowerCase().trim();
        if (!normalized) continue;
        const list = tagMap.get(normalized) ?? [];
        list.push(entry);
        tagMap.set(normalized, list);
      }
    }

    const clusters: DistilledCluster[] = [];
    for (const [tag, clusterEntries] of tagMap.entries()) {
      if (clusterEntries.length >= minClusterSize) {
        const uniqueRules = Array.from(new Set(clusterEntries.map((e) => e.rule)));
        clusters.push({
          tag,
          entries: clusterEntries,
          suggestedSkillName: `${tag}-best-practices`,
          suggestedDescription: `Distilled rules and pitfall mitigations for ${tag}`,
          rules: uniqueRules,
        });
      }
    }
    return clusters;
  }

  /**
   * Promotes distilled rules into AGENTS.md under a '## Project Learnings' section.
   */
  promoteToAgentsMd(cwd: string, rulesOrEntries: string[] | LearningEntry[]): PromoteToAgentsMdResult {
    const agentsMdPath = join(cwd, "AGENTS.md");
    let content = "";
    if (existsSync(agentsMdPath)) {
      try {
        content = readFileSync(agentsMdPath, "utf8");
      } catch {
        content = "";
      }
    }

    const rulesToAdd: string[] = [];
    for (const item of rulesOrEntries) {
      const ruleText = typeof item === "string" ? item : item.rule;
      const formatted = ruleText.startsWith("- ") ? ruleText : `- ${ruleText}`;
      if (!content.includes(ruleText)) {
        rulesToAdd.push(formatted);
      }
    }

    if (rulesToAdd.length === 0) {
      return { success: true, filePath: agentsMdPath, addedRules: [] };
    }

    const sectionHeader = "## Project Learnings";
    let updatedContent = content;

    if (updatedContent.includes(sectionHeader)) {
      const parts = updatedContent.split(sectionHeader);
      updatedContent = `${parts[0]}${sectionHeader}\n\n${rulesToAdd.join("\n")}\n${parts.slice(1).join(sectionHeader).replace(/^\n*/, "")}`;
    } else {
      updatedContent = updatedContent.trim()
        ? `${updatedContent.trim()}\n\n${sectionHeader}\n\n${rulesToAdd.join("\n")}\n`
        : `# Development Rules\n\n${sectionHeader}\n\n${rulesToAdd.join("\n")}\n`;
    }

    writeFileSync(agentsMdPath, updatedContent, "utf8");
    return { success: true, filePath: agentsMdPath, addedRules: rulesToAdd };
  }

  /**
   * Promotes rules to a skill SKILL.md file in the target directory.
   */
  promoteToSkill(
    skillsDir: string,
    skillName: string,
    description: string,
    rulesOrEntries: string[] | LearningEntry[],
  ): PromoteToSkillResult {
    const skillDir = join(skillsDir, skillName);
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    const skillFilePath = join(skillDir, "SKILL.md");
    const rules = rulesOrEntries.map((item) => {
      if (typeof item === "string") return item;
      return `- **${item.rule}**\n  - Trap: ${item.trap}\n  - Fix: ${item.fix}`;
    });

    const frontmatter = `---\nname: ${skillName}\ndescription: ${description}\n---\n\n`;
    const title = `# ${skillName
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ")}\n\n`;
    const body = `## Rules and Mitigations\n\n${rules.join("\n\n")}\n`;

    writeFileSync(skillFilePath, frontmatter + title + body, "utf8");
    return { success: true, skillFilePath, rulesCount: rules.length };
  }
}
