import type { Skill } from "../types.ts";
import { SkillGraphBuilder } from "./skill-graph-builder.ts";
import { SkillGraphQuery } from "./skill-graph-query.ts";
import type { SkillGraphNode } from "./skill-node.ts";
import type { SkillGraphMatch, SkillGraphNodeData, SkillQueryCriteria } from "./types.ts";

/**
 * Main in-memory graph index coordinating multi-tiered skill discovery and routing.
 */
export class SkillGraph {
  private nodes: Map<string, SkillGraphNode>;
  private builder: SkillGraphBuilder;
  private queryEngine: SkillGraphQuery;

  constructor() {
    this.nodes = new Map();
    this.builder = new SkillGraphBuilder();
    this.queryEngine = new SkillGraphQuery(this.nodes);
  }

  build(skills: Skill[]): void {
    this.nodes = this.builder.buildFromSkills(skills);
    this.queryEngine = new SkillGraphQuery(this.nodes);
  }

  getNode(id: string): SkillGraphNodeData | undefined {
    return this.nodes.get(id)?.toData();
  }

  getAllNodes(): SkillGraphNodeData[] {
    return Array.from(this.nodes.values()).map((n) => n.toData());
  }

  size(): number {
    return this.nodes.size;
  }

  query(criteria: SkillQueryCriteria): SkillGraphMatch[] {
    return this.queryEngine.query(criteria);
  }

  findBestPlaybook(context: { language?: string; framework?: string; topic?: string }): SkillGraphNodeData | undefined {
    const matches = this.queryEngine.query({
      language: context.language,
      framework: context.framework,
      queryText: context.topic,
      limit: 1,
    });
    return matches[0]?.node;
  }

  toMermaid(): string {
    const lines: string[] = ["graph TD"];
    for (const node of this.nodes.values()) {
      const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`  ${safeId}["${node.title} (${node.type})"]`);
      for (const edge of node.getOutgoing()) {
        const safeTo = edge.to.replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`  ${safeId} -->|${edge.type}| ${safeTo}`);
      }
    }
    return lines.join("\n");
  }
}
