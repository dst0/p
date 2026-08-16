import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Skill } from "../types.ts";
import { SkillGraphNode } from "./skill-node.ts";
import type { SkillNodeType } from "./types.ts";

/**
 * Builds the SkillGraph by indexing loaded skills and walking their sub-hierarchies.
 */
export class SkillGraphBuilder {
  private nodes: Map<string, SkillGraphNode>;

  constructor() {
    this.nodes = new Map();
  }

  buildFromSkills(skills: Skill[]): Map<string, SkillGraphNode> {
    this.nodes.clear();

    for (const skill of skills) {
      this.indexRootSkill(skill);
      const skillDir = dirname(skill.filePath);
      this.scanDirectoryHierarchy(skill.name, skillDir, skillDir);
    }

    this.resolveCrossReferences();
    return this.nodes;
  }

  private indexRootSkill(skill: Skill): void {
    const node = new SkillGraphNode({
      id: skill.name,
      name: skill.name,
      type: "skill",
      title: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      metadata: {
        triggers: [skill.name],
        tags: [skill.name, skill.sourceInfo.source],
      },
    });
    this.nodes.set(skill.name, node);
  }

  private scanDirectoryHierarchy(rootSkillName: string, currentDir: string, baseDir: string): void {
    if (!existsSync(currentDir)) return;

    let entries: string[] = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          this.scanDirectoryHierarchy(rootSkillName, fullPath, baseDir);
        } else if (stat.isFile() && entry.endsWith(".md") && entry !== "SKILL.md") {
          this.indexDocument(rootSkillName, fullPath, baseDir);
        }
      } catch {}
    }
  }

  private indexDocument(rootSkillName: string, filePath: string, baseDir: string): void {
    const rel = relative(baseDir, filePath).replace(/\\/g, "/");
    const docId = `${rootSkillName}/${rel}`;
    const name = basename(filePath, ".md");

    const content = this.safeReadFile(filePath);
    const { title, description, language, framework, version, isDefaultVersion, tags } = this.extractMetadata(
      name,
      content,
      rel,
    );

    const docType: SkillNodeType = this.inferDocType(rel);

    const node = new SkillGraphNode({
      id: docId,
      name,
      type: docType,
      title,
      description,
      filePath,
      metadata: {
        language,
        framework,
        version,
        isDefaultVersion,
        tags,
      },
    });

    this.nodes.set(docId, node);

    // Link from root skill or parent section to this document
    const rootNode = this.nodes.get(rootSkillName);
    if (rootNode) {
      rootNode.addOutgoingEdge({
        from: rootSkillName,
        to: docId,
        type: "contains",
      });
      node.addIncomingEdge({
        from: rootSkillName,
        to: docId,
        type: "contains",
      });
    }
  }

  private inferDocType(relPath: string): SkillNodeType {
    if (relPath.startsWith("languages/")) return "language";
    if (relPath.startsWith("frameworks/") || relPath.includes("/vitest/") || relPath.includes("/jest/")) {
      return "framework";
    }
    if (relPath.startsWith("protocols/")) return "protocol";
    if (relPath.startsWith("domains/")) return "domain";
    return "reference";
  }

  private safeReadFile(filePath: string): string {
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return "";
    }
  }

  private extractMetadata(
    name: string,
    content: string,
    relPath: string,
  ): {
    title: string;
    description: string;
    language?: string;
    framework?: string;
    version?: string;
    isDefaultVersion?: boolean;
    tags: string[];
  } {
    const lines = content.split("\n");
    let title = name;
    let description = "";
    const tags: string[] = [name];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!title && trimmed.startsWith("# ")) {
        title = trimmed.slice(2).trim();
      } else if (!description && trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
        description = trimmed.slice(0, 200);
      }
      if (title && description) break;
    }

    const lowerPath = relPath.toLowerCase();
    let language: string | undefined;
    if (lowerPath.includes("typescript")) language = "typescript";
    else if (lowerPath.includes("rust")) language = "rust";
    else if (lowerPath.includes("python")) language = "python";
    else if (lowerPath.includes("go")) language = "go";

    let framework: string | undefined;
    if (lowerPath.includes("vitest")) framework = "vitest";
    else if (lowerPath.includes("jest")) framework = "jest";
    else if (lowerPath.includes("node-test")) framework = "node-test";
    else if (lowerPath.includes("pytest")) framework = "pytest";

    let version: string | undefined;
    const versionMatch = lowerPath.match(/v(\d+(\.\d+)?)/);
    if (versionMatch) {
      version = versionMatch[0];
    }
    const isDefaultVersion = lowerPath.includes("default") || lowerPath.includes("modern");

    return {
      title: title || name,
      description: description || title || name,
      language,
      framework,
      version,
      isDefaultVersion,
      tags,
    };
  }

  private resolveCrossReferences(): void {
    for (const node of this.nodes.values()) {
      const content = this.safeReadFile(node.filePath);
      const linkMatches = content.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g);
      for (const match of linkMatches) {
        const linkTarget = match[2];
        for (const [targetId, targetNode] of this.nodes.entries()) {
          if (targetId !== node.id && (targetNode.filePath.endsWith(linkTarget) || targetId.endsWith(linkTarget))) {
            node.addOutgoingEdge({ from: node.id, to: targetId, type: "references" });
            targetNode.addIncomingEdge({ from: node.id, to: targetId, type: "references" });
          }
        }
      }
    }
  }
}
