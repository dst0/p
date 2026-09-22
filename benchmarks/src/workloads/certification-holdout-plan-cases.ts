import { createHmac } from "node:crypto";
import type { CertifiedTaskId } from "./certified-task-score-policy.ts";

export type SealedHoldoutTaskPlan =
  | { taskId: "typescript-calculator"; domain: "calculator"; input: CalculatorInput; expected: number }
  | { taskId: "monolith-split"; domain: "monolith"; input: MonolithInput; expected: MonolithResult }
  | { taskId: "event-sourced-inventory"; domain: "inventory"; input: InventoryInput; expected: InventoryResult }
  | { taskId: "durable-workflow-saga"; domain: "workflow"; input: WorkflowInput; expected: WorkflowResult };

type CalculatorInput = { expression: string };
type MonolithRecord = {
  id: number;
  title: string;
  status: "todo" | "doing" | "done";
  estimate: number;
  tags: string[];
};
type MonolithInput = { source: string; filter: { tag: string }; limit: number };
type MonolithResult = {
  selectedIds: number[];
  total: number;
  completed: number;
  totalEstimate: number;
  tagCounts: Record<string, number>;
  largestIds: number[];
};
type InventoryInput = {
  sku: string;
  orderId: string;
  received: number;
  reserved: number;
  shipped: number;
  ids: { create: string; receive: string; reserve: string; ship: string };
  batch: {
    skuA: string;
    skuB: string;
    orderId: string;
    receivedA: number;
    receivedB: number;
    reserveA: number;
    reserveB: number;
    invalidReserveB: number;
    ids: { createA: string; createB: string; receiveA: string; receiveB: string; reserveA: string; reserveB: string };
  };
};
type InventoryResult = {
  state: InventoryState;
  retryMatches: boolean;
  restored: InventoryState;
  logMatches: boolean;
  batchRollbackMatches: boolean;
  batchIdsReusable: boolean;
};
type InventoryState = {
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  reservations: Record<string, number>;
  version: number;
};
type WorkflowInput = {
  workflowId: string;
  first: string;
  second: string;
  workerId: string;
  leaseMs: number;
  ids: { start: string; first: string; second: string };
  retry: {
    workflowId: string;
    taskId: string;
    secondWorkerId: string;
    retryDelayMs: number;
    ids: { start: string; stale: string; fail: string; complete: string };
  };
};
type WorkflowResult = {
  claimedIds: [string, string];
  status: string;
  taskStates: Record<string, { status: string; attempt: number; output: { sequence: number } }>;
  logMatches: boolean;
  restoredStatus: string;
  reclaimedAttempt: number;
  staleRejected: boolean;
  backoffBlocked: boolean;
  retryAttempt: number;
  retryStatus: string;
};

export function createSealedHoldoutTaskPlan(taskId: CertifiedTaskId, seed: Uint8Array): SealedHoldoutTaskPlan {
  if (taskId === "typescript-calculator") return calculatorPlan(seed);
  if (taskId === "monolith-split") return monolithPlan(seed);
  if (taskId === "event-sourced-inventory") return inventoryPlan(seed);
  return workflowPlan(seed);
}

function calculatorPlan(seed: Uint8Array): SealedHoldoutTaskPlan {
  const values = ["a", "b", "c", "d", "e"].map((name, index) =>
    deriveNumber(seed, `calculator:${name}`, index === 4 ? 2 : 3, 41),
  );
  const [a, b, c, d, e] = values as [number, number, number, number, number];
  return {
    taskId: "typescript-calculator",
    domain: "calculator",
    input: { expression: `-${a} + ${b} * (${c} - ${d}) / ${e}` },
    expected: -a + (b * (c - d)) / e,
  };
}

function monolithPlan(seed: Uint8Array): SealedHoldoutTaskPlan {
  const tag = `sealed-${deriveHex(seed, "monolith:tag", 6)}`;
  const idBase = deriveNumber(seed, "monolith:id-base", 1, 9_000);
  const records: MonolithRecord[] = ["todo", "doing", "done", "todo", "done"].map((status, index) => ({
    id: 10_000 + idBase * 10 + index,
    title: `Sealed task ${deriveHex(seed, `monolith:title:${index}`, 8)}`,
    status: status as MonolithRecord["status"],
    estimate: deriveNumber(seed, `monolith:estimate:${index}`, 1, 50),
    tags: index % 2 === 0 ? [tag, `group-${index}`] : [`group-${index}`],
  }));
  const selected = records.filter((record) => record.tags.includes(tag));
  const tagCounts: Record<string, number> = {};
  for (const record of selected) for (const entry of record.tags) tagCounts[entry] = (tagCounts[entry] ?? 0) + 1;
  const expected: MonolithResult = {
    selectedIds: selected.map((record) => record.id),
    total: selected.length,
    completed: selected.filter((record) => record.status === "done").length,
    totalEstimate: selected.reduce((total, record) => total + record.estimate, 0),
    tagCounts,
    largestIds: [...selected]
      .sort((left, right) => right.estimate - left.estimate || right.id - left.id)
      .slice(0, 2)
      .map((record) => record.id),
  };
  const source = records
    .map((record) => [record.id, record.title, record.status, record.estimate, record.tags.join(",")].join("|"))
    .join("\n");
  return { taskId: "monolith-split", domain: "monolith", input: { source, filter: { tag }, limit: 2 }, expected };
}

function inventoryPlan(seed: Uint8Array): SealedHoldoutTaskPlan {
  const received = deriveNumber(seed, "inventory:received", 20, 90);
  const reserved = deriveNumber(seed, "inventory:reserved", 2, Math.floor(received / 2));
  const shipped = deriveNumber(seed, "inventory:shipped", 1, reserved - 1);
  const sku = `SKU-${deriveHex(seed, "inventory:sku", 8)}`;
  const orderId = `order-${deriveHex(seed, "inventory:order", 8)}`;
  const receivedA = deriveNumber(seed, "inventory:batch-received-a", 8, 30);
  const receivedB = deriveNumber(seed, "inventory:batch-received-b", 3, 15);
  const batch = {
    skuA: `SKU-A-${deriveHex(seed, "inventory:batch-sku-a", 6)}`,
    skuB: `SKU-B-${deriveHex(seed, "inventory:batch-sku-b", 6)}`,
    orderId: `batch-${deriveHex(seed, "inventory:batch-order", 8)}`,
    receivedA,
    receivedB,
    reserveA: deriveNumber(seed, "inventory:batch-reserve-a", 1, receivedA),
    reserveB: deriveNumber(seed, "inventory:batch-reserve-b", 1, receivedB),
    invalidReserveB: receivedB + deriveNumber(seed, "inventory:batch-invalid", 1, 5),
    ids: {
      createA: `bc-a-${deriveHex(seed, "inventory:batch-create-a", 6)}`,
      createB: `bc-b-${deriveHex(seed, "inventory:batch-create-b", 6)}`,
      receiveA: `br-a-${deriveHex(seed, "inventory:batch-receive-a", 6)}`,
      receiveB: `br-b-${deriveHex(seed, "inventory:batch-receive-b", 6)}`,
      reserveA: `bv-a-${deriveHex(seed, "inventory:batch-reserve-id-a", 6)}`,
      reserveB: `bv-b-${deriveHex(seed, "inventory:batch-reserve-id-b", 6)}`,
    },
  };
  const input: InventoryInput = {
    sku,
    orderId,
    received,
    reserved,
    shipped,
    ids: {
      create: `c-${deriveHex(seed, "inventory:create", 8)}`,
      receive: `r-${deriveHex(seed, "inventory:receive", 8)}`,
      reserve: `v-${deriveHex(seed, "inventory:reserve", 8)}`,
      ship: `s-${deriveHex(seed, "inventory:ship", 8)}`,
    },
    batch,
  };
  const state: InventoryState = {
    sku,
    onHand: received - shipped,
    reserved: reserved - shipped,
    available: received - reserved,
    reservations: { [orderId]: reserved - shipped },
    version: 4,
  };
  return {
    taskId: "event-sourced-inventory",
    domain: "inventory",
    input,
    expected: {
      state,
      retryMatches: true,
      restored: state,
      logMatches: true,
      batchRollbackMatches: true,
      batchIdsReusable: true,
    },
  };
}

function workflowPlan(seed: Uint8Array): SealedHoldoutTaskPlan {
  const first = `a-${deriveHex(seed, "workflow:first", 8)}`;
  const second = `z-${deriveHex(seed, "workflow:second", 8)}`;
  const workflowId = `workflow-${deriveHex(seed, "workflow:id", 8)}`;
  const retry = {
    workflowId: `retry-${deriveHex(seed, "workflow:retry-id", 8)}`,
    taskId: `retry-task-${deriveHex(seed, "workflow:retry-task", 6)}`,
    secondWorkerId: `worker-${deriveHex(seed, "workflow:retry-worker", 6)}`,
    retryDelayMs: deriveNumber(seed, "workflow:retry-delay", 2, 12),
    ids: {
      start: `rs-${deriveHex(seed, "workflow:retry-start", 8)}`,
      stale: `rx-${deriveHex(seed, "workflow:retry-stale", 8)}`,
      fail: `rf-${deriveHex(seed, "workflow:retry-fail", 8)}`,
      complete: `rc-${deriveHex(seed, "workflow:retry-complete", 8)}`,
    },
  };
  const input: WorkflowInput = {
    workflowId,
    first,
    second,
    workerId: `worker-${deriveHex(seed, "workflow:worker", 6)}`,
    leaseMs: deriveNumber(seed, "workflow:lease", 10, 90),
    ids: {
      start: `s-${deriveHex(seed, "workflow:start", 8)}`,
      first: `f-${deriveHex(seed, "workflow:complete-first", 8)}`,
      second: `l-${deriveHex(seed, "workflow:complete-second", 8)}`,
    },
    retry,
  };
  const taskStates = {
    [first]: { status: "succeeded", attempt: 1, output: { sequence: 1 } },
    [second]: { status: "succeeded", attempt: 1, output: { sequence: 2 } },
  };
  return {
    taskId: "durable-workflow-saga",
    domain: "workflow",
    input,
    expected: {
      claimedIds: [first, second],
      status: "succeeded",
      taskStates,
      logMatches: true,
      restoredStatus: "succeeded",
      reclaimedAttempt: 2,
      staleRejected: true,
      backoffBlocked: true,
      retryAttempt: 3,
      retryStatus: "succeeded",
    },
  };
}

function deriveNumber(seed: Uint8Array, label: string, minimum: number, maximum: number): number {
  const value = createHmac("sha256", seed).update(label).digest().readUInt32BE(0);
  return minimum + (value % (maximum - minimum + 1));
}

function deriveHex(seed: Uint8Array, label: string, length: number): string {
  return createHmac("sha256", seed).update(label).digest("hex").slice(0, length);
}
