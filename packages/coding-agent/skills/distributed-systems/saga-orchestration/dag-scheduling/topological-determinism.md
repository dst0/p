# DAG Scheduling & Topological Determinism

A Directed Acyclic Graph (DAG) defines dependencies between saga execution steps.

---

## 1. Topological Sorting & Cycle Detection

Before executing a DAG workflow:
1. Run Kahn's algorithm or Tarjan's strongly connected components algorithm to detect circular dependencies.
2. Formulate execution stages where all independent nodes in a topological rank run concurrently via `Promise.all()`.

```typescript
export function getTopologicalExecutionPlan<T extends { id: string; deps: string[] }>(
  tasks: T[]
): T[][] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.id, t.deps.length);
    for (const dep of t.deps) {
      if (!adj.has(dep)) adj.set(dep, []);
      adj.get(dep)!.push(t.id);
    }
  }

  const stages: T[][] = [];
  let currentStage = tasks.filter((t) => inDegree.get(t.id) === 0);

  while (currentStage.length > 0) {
    stages.push(currentStage);
    const nextStageIds: string[] = [];

    for (const t of currentStage) {
      for (const neighbor of adj.get(t.id) ?? []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          nextStageIds.push(neighbor);
        }
      }
    }

    currentStage = tasks.filter((t) => nextStageIds.includes(t.id));
  }

  return stages;
}
```
