import { pathToFileURL } from "node:url";

const [modulePath, domain] = process.argv.slice(1);
if (!modulePath || !domain) throw new Error("Missing sealed holdout adapter target");

const source = await readStandardInput();
const input = JSON.parse(source);
const candidate = await import(pathToFileURL(modulePath).href);
const value = executeDomain(candidate, domain, input);
process.stdout.write(`${JSON.stringify({ value })}\n`);

function readStandardInput() {
  return new Promise((resolve, reject) => {
    let source = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      source += chunk;
      if (source.length > 16_384) reject(new Error("Sealed holdout input exceeds bound"));
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(source));
  });
}

function executeDomain(candidate, domain, input) {
  if (domain === "calculator") return candidate.evaluate(input.expression);
  if (domain === "monolith") return evaluateMonolith(candidate, input);
  if (domain === "inventory") return evaluateInventory(candidate, input);
  if (domain === "workflow") return evaluateWorkflow(candidate, input);
  throw new Error("Unknown sealed holdout domain");
}

function evaluateMonolith(candidate, input) {
  const tasks = candidate.parseTaskFile(input.source);
  const selected = candidate.filterTasks(tasks, input.filter);
  const summary = candidate.summarizeTasks(selected);
  const largest = candidate.selectLargest(selected, input.limit);
  return {
    selectedIds: selected.map((task) => task.id),
    total: summary.total,
    completed: summary.completed,
    totalEstimate: summary.totalEstimate,
    tagCounts: summary.tagCounts,
    largestIds: largest.map((task) => task.id),
  };
}

function evaluateInventory(candidate, input) {
  const engine = new candidate.InventoryEngine();
  engine.execute({ type: "create-sku", sku: input.sku }, { commandId: input.ids.create, expectedVersion: 0 });
  engine.execute(
    { type: "receive", sku: input.sku, quantity: input.received },
    { commandId: input.ids.receive, expectedVersion: 1 },
  );
  const reserved = engine.execute(
    { type: "reserve", sku: input.sku, orderId: input.orderId, quantity: input.reserved },
    { commandId: input.ids.reserve, expectedVersion: 2 },
  );
  const retried = engine.execute(
    { type: "reserve", sku: input.sku, orderId: input.orderId, quantity: input.reserved },
    { commandId: input.ids.reserve, expectedVersion: 2 },
  );
  engine.execute(
    { type: "ship", sku: input.sku, orderId: input.orderId, quantity: input.shipped },
    { commandId: input.ids.ship, expectedVersion: 3 },
  );
  const log = engine.exportLog();
  const restored = candidate.InventoryEngine.fromLog(log);
  const batch = evaluateInventoryBatch(candidate, input.batch);
  return {
    state: engine.state(input.sku),
    retryMatches: JSON.stringify(reserved) === JSON.stringify(retried),
    restored: restored.state(input.sku),
    logMatches: restored.exportLog() === log,
    ...batch,
  };
}

function evaluateInventoryBatch(candidate, input) {
  const engine = new candidate.InventoryEngine();
  engine.execute({ type: "create-sku", sku: input.skuA }, { commandId: input.ids.createA, expectedVersion: 0 });
  engine.execute({ type: "create-sku", sku: input.skuB }, { commandId: input.ids.createB, expectedVersion: 0 });
  engine.execute(
    { type: "receive", sku: input.skuA, quantity: input.receivedA },
    { commandId: input.ids.receiveA, expectedVersion: 1 },
  );
  engine.execute(
    { type: "receive", sku: input.skuB, quantity: input.receivedB },
    { commandId: input.ids.receiveB, expectedVersion: 1 },
  );
  const before = JSON.stringify({ a: engine.state(input.skuA), b: engine.state(input.skuB), log: engine.exportLog() });
  let failed = false;
  try {
    engine.executeBatch(batchItems(input, input.invalidReserveB));
  } catch {
    failed = true;
  }
  const after = JSON.stringify({ a: engine.state(input.skuA), b: engine.state(input.skuB), log: engine.exportLog() });
  let batchIdsReusable = false;
  try {
    batchIdsReusable = engine.executeBatch(batchItems(input, input.reserveB)).length === 2;
  } catch {}
  return { batchRollbackMatches: failed && before === after, batchIdsReusable };
}

function batchItems(input, reserveB) {
  return [
    {
      command: { type: "reserve", sku: input.skuA, orderId: input.orderId, quantity: input.reserveA },
      commandId: input.ids.reserveA,
      expectedVersion: 2,
    },
    {
      command: { type: "reserve", sku: input.skuB, orderId: input.orderId, quantity: reserveB },
      commandId: input.ids.reserveB,
      expectedVersion: 2,
    },
  ];
}

function evaluateWorkflow(candidate, input) {
  const engine = new candidate.WorkflowEngine();
  engine.start(
    { workflowId: input.workflowId, tasks: [{ id: input.first }, { id: input.second, dependsOn: [input.first] }] },
    { commandId: input.ids.start, now: 0 },
  );
  const first = engine.claim(input.workerId, 0, input.leaseMs);
  engine.complete(first, { sequence: 1 }, { commandId: input.ids.first, now: 1 });
  const second = engine.claim(input.workerId, 1, input.leaseMs);
  engine.complete(second, { sequence: 2 }, { commandId: input.ids.second, now: 2 });
  const log = engine.exportLog();
  const restored = candidate.WorkflowEngine.fromLog(log);
  const state = engine.state(input.workflowId);
  const restoredState = restored.state(input.workflowId);
  const retry = evaluateWorkflowRetry(candidate, input);
  return {
    claimedIds: [first?.taskId, second?.taskId],
    status: state.status,
    taskStates: Object.fromEntries(
      Object.entries(state.tasks).map(([id, task]) => [id, { status: task.status, attempt: task.attempt, output: task.output }]),
    ),
    logMatches: restored.exportLog() === log,
    restoredStatus: restoredState.status,
    ...retry,
  };
}

function evaluateWorkflowRetry(candidate, input) {
  const engine = new candidate.WorkflowEngine();
  engine.start(
    {
      workflowId: input.retry.workflowId,
      tasks: [{ id: input.retry.taskId, maxAttempts: 3, retryDelayMs: input.retry.retryDelayMs }],
    },
    { commandId: input.retry.ids.start, now: 0 },
  );
  const stale = engine.claim(input.workerId, 0, input.leaseMs);
  const reclaimed = engine.claim(input.retry.secondWorkerId, input.leaseMs, input.leaseMs);
  let staleRejected = false;
  try {
    engine.complete(stale, { stale: true }, { commandId: input.retry.ids.stale, now: input.leaseMs });
  } catch {
    staleRejected = true;
  }
  const failedAt = input.leaseMs + 1;
  engine.fail(reclaimed, "retry", { commandId: input.retry.ids.fail, now: failedAt });
  const readyAt = failedAt + input.retry.retryDelayMs * 2;
  const backoffBlocked = engine.claim(input.retry.secondWorkerId, readyAt - 1, input.leaseMs) == null;
  const retried = engine.claim(input.retry.secondWorkerId, readyAt, input.leaseMs);
  engine.complete(retried, { retried: true }, { commandId: input.retry.ids.complete, now: readyAt + 1 });
  return {
    reclaimedAttempt: reclaimed?.attempt,
    staleRejected,
    backoffBlocked,
    retryAttempt: retried?.attempt,
    retryStatus: engine.state(input.retry.workflowId).status,
  };
}
