import type { SkillEdgeType, SkillGraphEdge, SkillGraphMetadata, SkillGraphNodeData, SkillNodeType } from "./types.ts";

/**
 * Represents a single entity (skill, language, framework, topic, or playbook) in the SkillGraph.
 */
export class SkillGraphNode {
  readonly id: string;
  readonly name: string;
  readonly type: SkillNodeType;
  readonly title: string;
  readonly description: string;
  readonly filePath: string;
  readonly metadata: SkillGraphMetadata;

  private outgoingEdges: SkillGraphEdge[];
  private incomingEdges: SkillGraphEdge[];

  constructor(data: SkillGraphNodeData) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.title = data.title;
    this.description = data.description;
    this.filePath = data.filePath;
    this.metadata = { ...data.metadata };
    this.outgoingEdges = [];
    this.incomingEdges = [];
  }

  addOutgoingEdge(edge: SkillGraphEdge): void {
    if (!this.outgoingEdges.some((e) => e.to === edge.to && e.type === edge.type)) {
      this.outgoingEdges.push(edge);
    }
  }

  addIncomingEdge(edge: SkillGraphEdge): void {
    if (!this.incomingEdges.some((e) => e.from === edge.from && e.type === edge.type)) {
      this.incomingEdges.push(edge);
    }
  }

  getOutgoing(type?: SkillEdgeType): SkillGraphEdge[] {
    if (!type) return [...this.outgoingEdges];
    return this.outgoingEdges.filter((e) => e.type === type);
  }

  getIncoming(type?: SkillEdgeType): SkillGraphEdge[] {
    if (!type) return [...this.incomingEdges];
    return this.incomingEdges.filter((e) => e.type === type);
  }

  toData(): SkillGraphNodeData {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      title: this.title,
      description: this.description,
      filePath: this.filePath,
      metadata: { ...this.metadata },
    };
  }
}
