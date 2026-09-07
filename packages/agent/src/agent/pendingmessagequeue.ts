import type { AgentMessage, QueueMode } from "../types.ts";

export class PendingMessageQueue {
  private groups: AgentMessage[][] = [];
  public mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: AgentMessage): void {
    this.enqueueGroup([message]);
  }

  enqueueGroup(messages: readonly AgentMessage[]): void {
    if (messages.length > 0) this.groups.push([...messages]);
  }

  hasItems(): boolean {
    return this.groups.length > 0;
  }

  drain(): AgentMessage[] {
    if (this.mode === "all") {
      const drained = this.groups.flat();
      this.groups = [];
      return drained;
    }

    const first = this.groups[0];
    if (!first) {
      return [];
    }
    this.groups = this.groups.slice(1);
    return first;
  }

  clear(): void {
    this.groups = [];
  }
}
