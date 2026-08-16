import type { SkillGraphNode } from "./skill-node.ts";
import type { SkillGraphMatch, SkillQueryCriteria } from "./types.ts";

/**
 * Handles fast graph querying, scoring, and context resolution over SkillGraphNodes.
 */
export class SkillGraphQuery {
  private nodes: Map<string, SkillGraphNode>;

  constructor(nodes: Map<string, SkillGraphNode>) {
    this.nodes = nodes;
  }

  query(criteria: SkillQueryCriteria): SkillGraphMatch[] {
    const matches: SkillGraphMatch[] = [];

    for (const node of this.nodes.values()) {
      const match = this.evaluateNode(node, criteria);
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

  private evaluateNode(node: SkillGraphNode, criteria: SkillQueryCriteria): SkillGraphMatch {
    let score = 0;
    const reasons: string[] = [];

    if (criteria.types && criteria.types.length > 0) {
      if (!criteria.types.includes(node.type)) {
        return { node: node.toData(), score: 0, matchedReasons: [] };
      }
    }

    if (criteria.language) {
      const nodeLang = node.metadata.language?.toLowerCase();
      const targetLang = criteria.language.toLowerCase();
      if (nodeLang === targetLang) {
        score += 30;
        reasons.push(`matches language: ${criteria.language}`);
      } else if (nodeLang && nodeLang !== targetLang) {
        score -= 20;
      }
    }

    if (criteria.framework) {
      const nodeFw = node.metadata.framework?.toLowerCase();
      const targetFw = criteria.framework.toLowerCase();
      if (nodeFw === targetFw) {
        score += 40;
        reasons.push(`matches framework: ${criteria.framework}`);
      }
    }

    if (criteria.version) {
      const nodeVer = node.metadata.version?.toLowerCase();
      const targetVer = criteria.version.toLowerCase();
      if (nodeVer === targetVer) {
        score += 25;
        reasons.push(`matches version: ${criteria.version}`);
      } else if (node.metadata.isDefaultVersion) {
        score += 10;
        reasons.push("is default/modern version fallback");
      }
    }

    if (criteria.queryText) {
      const q = criteria.queryText.toLowerCase();
      const titleLower = node.title.toLowerCase();
      const descLower = node.description.toLowerCase();
      const idLower = node.id.toLowerCase();

      if (titleLower.includes(q)) {
        score += 30;
        reasons.push("title matches query");
      } else if (descLower.includes(q)) {
        score += 15;
        reasons.push("description matches query");
      } else if (idLower.includes(q)) {
        score += 20;
        reasons.push("id matches query");
      }
    }

    if (criteria.topics && criteria.topics.length > 0) {
      for (const topic of criteria.topics) {
        const t = topic.toLowerCase();
        if (node.metadata.tags?.some((tag) => tag.toLowerCase().includes(t))) {
          score += 15;
          reasons.push(`matches topic tag: ${topic}`);
        }
      }
    }

    return {
      node: node.toData(),
      score: Math.max(0, score),
      matchedReasons: reasons,
    };
  }

  traverse(startNodeId: string, maxDepth: number = 2): SkillGraphNode[] {
    const visited = new Set<string>();
    const result: SkillGraphNode[] = [];

    const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;
      result.push(node);

      if (depth < maxDepth) {
        for (const edge of node.getOutgoing()) {
          if (!visited.has(edge.to)) {
            queue.push({ id: edge.to, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }
}
