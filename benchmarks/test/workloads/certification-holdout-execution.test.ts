import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { benchmarkSandboxExecutable } from "../../src/harness/benchmark-isolation.ts";
import { isBenchmarkProcessTerminationUnconfirmedError } from "../../src/harness/process-termination-error.ts";
import { hashSnapshotDirectory } from "../../src/harness/runtime-snapshot.ts";
import type { CertifiedHarnessCoreBinding } from "../../src/workloads/certification-binding.ts";
import { createCertifiedTaskVariants } from "../../src/workloads/certification-holdout.ts";
import { evaluateSealedHoldoutTask } from "../../src/workloads/certification-holdout-execution.ts";
import { createSealedHoldoutPlan } from "../../src/workloads/certification-holdout-plan.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";

test(
  "defective candidate implementations fail their own sealed evaluator domains",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "sealed-holdout-domains-"));
    try {
      const { evaluator, plan } = createPlan(root);
      for (const taskPlan of plan.taskPlans) {
        const workspace = join(root, taskPlan.domain);
        const source = defectiveSource(taskPlan.domain);
        writeCandidateSource(workspace, taskPlan.domain, source);
        assert.equal(await evaluateSealedHoldoutTask(evaluator.path, workspace, taskPlan), false, taskPlan.domain);
        assert.equal(readFileSync(candidatePath(workspace, taskPlan.domain), "utf8"), source);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("sealed evaluator rejects happy-path-only durable engines", { skip: !benchmarkSandboxExecutable() }, async () => {
  const root = mkdtempSync(join(tmpdir(), "sealed-holdout-durable-branches-"));
  try {
    const { evaluator, plan } = createPlan(root);
    for (const domain of ["inventory", "workflow"] as const) {
      const taskPlan = plan.taskPlans.find((entry) => entry.domain === domain);
      assert.ok(taskPlan);
      const workspace = join(root, `happy-path-${domain}`);
      writeCandidateSource(workspace, domain, durableHappyPathSource(domain));
      assert.equal(await evaluateSealedHoldoutTask(evaluator.path, workspace, taskPlan), false, domain);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "sealed evaluator accepts valid public APIs and applies its score only when they pass",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "sealed-holdout-valid-"));
    try {
      const { evaluator, plan, holdoutSha256 } = createPlan(root);
      for (const taskPlan of plan.taskPlans) {
        const workspace = join(root, taskPlan.domain);
        writeCandidateSource(workspace, taskPlan.domain, validSource(taskPlan.domain));
        assert.equal(await evaluateSealedHoldoutTask(evaluator.path, workspace, taskPlan), true, taskPlan.domain);
      }
      const calculator = plan.taskPlans.find((entry) => entry.domain === "calculator");
      assert.ok(calculator && calculator.domain === "calculator");
      const calculatorTask = benchmarkTasks.find((task) => task.id === calculator.taskId);
      assert.ok(calculatorTask);
      const tasks = benchmarkTasks.map((task) =>
        task === calculatorTask
          ? {
              ...task,
              verify: async () => ({ passed: true, score: task.maxScore, maxScore: task.maxScore, checks: [] }),
            }
          : task,
      );
      const variant = createCertifiedTaskVariants(tasks, { plan, holdoutSha256 }).find(
        (task) => task.id === calculator.taskId,
      );
      assert.ok(variant);
      const workspace = join(root, "variant");
      writeCandidateSource(workspace, "calculator", validSource("calculator"));
      const passed = await variant.verify(workspace, {}, "", { evaluator });
      assert.equal(passed.passed, true);
      assert.equal(passed.score, 8);
      assert.deepEqual(passed.checks.at(-1), { name: "sealed evaluator holdout", passed: true, weight: 2 });
      writeCandidateSource(workspace, "calculator", defectiveSource("calculator"));
      const failed = await variant.verify(workspace, {}, "", { evaluator });
      assert.equal(failed.passed, false);
      assert.equal(failed.score, 6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "sealed adapter fails closed on malformed output, overflow, timeout, and attempted writes",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "sealed-holdout-protocol-"));
    try {
      const { evaluator, plan, holdoutSha256 } = createPlan(root);
      const calculator = plan.taskPlans.find((entry) => entry.domain === "calculator");
      assert.ok(calculator && calculator.domain === "calculator");
      for (const [name, source] of Object.entries({
        malformed: 'process.stdout.write("not-json"); export function evaluate() { return 0; }\n',
        overflow: 'process.stdout.write("x".repeat(20000)); export function evaluate() { return 0; }\n',
        validPrefixOverflow:
          'process.stdout.write(JSON.stringify({ value: 0 }) + "x".repeat(20000)); export function evaluate() { return 0; }\n',
        stderrOverflow: 'process.stderr.write("x".repeat(5000)); export function evaluate() { return 0; }\n',
        timeout: "await new Promise(() => {}); export function evaluate() { return 0; }\n",
        write:
          'import { writeFileSync } from "node:fs"; writeFileSync("escape.txt", "x"); export function evaluate() { return 0; }\n',
      })) {
        const workspace = join(root, name);
        writeCandidateSource(workspace, "calculator", source);
        assert.equal(await evaluateSealedHoldoutTask(evaluator.path, workspace, calculator), false, name);
        assert.equal(existsSync(join(workspace, "escape.txt")), false, name);
      }
      const nearTimeout = join(root, "near-timeout");
      writeCandidateSource(
        nearTimeout,
        "calculator",
        'await new Promise((resolve) => setTimeout(resolve, 40)); export function evaluate(expression) { return Function("return (" + expression + ")")(); }\n',
      );
      assert.equal(await evaluateSealedHoldoutTask(evaluator.path, nearTimeout, calculator, { timeoutMs: 10 }), false);
      const unconfirmed = join(root, "unconfirmed");
      writeCandidateSource(
        unconfirmed,
        "calculator",
        'process.stdout.write("not-json"); export function evaluate() { return 0; }\n',
      );
      await assert.rejects(
        evaluateSealedHoldoutTask(evaluator.path, unconfirmed, calculator, { terminateProcessTree: async () => false }),
        isBenchmarkProcessTerminationUnconfirmedError,
      );
      const calculatorTask = benchmarkTasks.find((task) => task.id === calculator.taskId);
      assert.ok(calculatorTask);
      const tasks = benchmarkTasks.map((task) =>
        task === calculatorTask
          ? {
              ...task,
              verify: async () => ({ passed: true, score: task.maxScore, maxScore: task.maxScore, checks: [] }),
            }
          : task,
      );
      const unsafeVariant = createCertifiedTaskVariants(tasks, {
        plan,
        holdoutSha256,
        executionControl: { terminateProcessTree: async () => false },
      }).find((task) => task.id === calculator.taskId);
      assert.ok(unsafeVariant);
      const unsafeWorkspace = join(root, "unconfirmed-variant");
      writeCandidateSource(unsafeWorkspace, "calculator", validSource("calculator"));
      await assert.rejects(
        async () => unsafeVariant.verify(unsafeWorkspace, {}, "", { evaluator }),
        isBenchmarkProcessTerminationUnconfirmedError,
      );
      const forkAttempt = join(root, "fork-attempt");
      writeCandidateSource(
        forkAttempt,
        "calculator",
        'import { spawnSync } from "node:child_process"; const result = spawnSync("/usr/bin/true"); if (!result.error) throw new Error("fork unexpectedly allowed"); export function evaluate(expression) { return Function("return (" + expression + ")")(); }\n',
      );
      assert.equal(await evaluateSealedHoldoutTask(evaluator.path, forkAttempt, calculator), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

function createPlan(root: string) {
  const evaluatorPath = join(root, "evaluator");
  mkdirSync(evaluatorPath, { mode: 0o700 });
  chmodSync(evaluatorPath, 0o700);
  const evaluator = { path: evaluatorPath, sha256: hashSnapshotDirectory(evaluatorPath), dispose: () => {} };
  const holdout = createSealedHoldoutPlan(core(), evaluator, Buffer.alloc(32, 3));
  return { evaluator, plan: holdout.plan, holdoutSha256: holdout.holdoutSha256 };
}

function core(): CertifiedHarnessCoreBinding {
  return {
    node: { path: "/node", version: "1", sha256: "1".repeat(64) },
    pSnapshot: { path: "/candidate", version: "1", sha256: "2".repeat(64) },
    pi: { path: "/pi", version: "1", sha256: "3".repeat(64) },
    kilo: { path: "/kilo", version: "1", sha256: "4".repeat(64) },
    modelConfiguration: { sha256: "5".repeat(64) },
    projectInstructions: { path: "/AGENTS.md", sha256: "6".repeat(64) },
  };
}

function writeCandidateSource(workspace: string, domain: string, source: string): void {
  const path = candidatePath(workspace, domain);
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(path, source);
}

function candidatePath(workspace: string, domain: string): string {
  if (domain === "calculator") return join(workspace, "src", "calculator.ts");
  if (domain === "monolith") return join(workspace, "src", "monolith.ts");
  return join(workspace, "src", "index.ts");
}

function defectiveSource(domain: string): string {
  if (domain === "calculator") return "export function evaluate() { return 0; }\n";
  if (domain === "monolith") {
    return "export function parseTaskFile() { return []; } export function filterTasks() { return []; } export function summarizeTasks() { return { total: 0, completed: 0, totalEstimate: 0, tagCounts: {} }; } export function selectLargest() { return []; }\n";
  }
  if (domain === "inventory") return "export class InventoryEngine {}\n";
  return "export class WorkflowEngine {}\n";
}

function validSource(domain: string): string {
  if (domain === "calculator")
    return 'export function evaluate(expression) { return Function("return (" + expression + ")")(); }\n';
  if (domain === "monolith")
    return 'export function parseTaskFile(source) { return source.split("\\n").map((line) => { const [id, title, status, estimate, tags] = line.split("|"); return { id: Number(id), title, status, estimate: Number(estimate), tags: tags.split(",") }; }); } export function filterTasks(tasks, filter) { return tasks.filter((task) => task.tags.includes(filter.tag)); } export function summarizeTasks(tasks) { const tagCounts = {}; for (const task of tasks) for (const tag of task.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1; return { total: tasks.length, completed: tasks.filter((task) => task.status === "done").length, totalEstimate: tasks.reduce((total, task) => total + task.estimate, 0), tagCounts }; } export function selectLargest(tasks, limit) { return [...tasks].sort((left, right) => right.estimate - left.estimate || right.id - left.id).slice(0, limit); }\n';
  if (domain === "inventory")
    return 'const clone = (value) => JSON.parse(JSON.stringify(value)); export class InventoryEngine { constructor(data = {}, commands = []) { this.data = data; this.commands = new Map(commands); } execute(command, options) { if (this.commands.has(options.commandId)) return clone(this.commands.get(options.commandId)); let state = this.data[command.sku]; if (command.type === "create-sku") state = { sku: command.sku, onHand: 0, reserved: 0, available: 0, reservations: {}, version: 1 }; else { if (!state || state.version !== options.expectedVersion) throw new Error("version"); if (command.type === "reserve" && command.quantity > state.available) throw new Error("available"); state = { ...state, reservations: { ...state.reservations }, version: state.version + 1 }; if (command.type === "receive") state.onHand += command.quantity; if (command.type === "reserve") { state.reserved += command.quantity; state.reservations[command.orderId] = (state.reservations[command.orderId] ?? 0) + command.quantity; } if (command.type === "ship") { state.onHand -= command.quantity; state.reserved -= command.quantity; state.reservations[command.orderId] -= command.quantity; } state.available = state.onHand - state.reserved; } this.data[command.sku] = state; const result = clone(state); this.commands.set(options.commandId, result); return clone(result); } executeBatch(items) { const data = clone(this.data); const commands = clone([...this.commands]); try { return items.map((item) => this.execute(item.command, item)); } catch (error) { this.data = data; this.commands = new Map(commands); throw error; } } state(sku) { return clone(this.data[sku]); } exportLog() { return JSON.stringify({ data: this.data, commands: [...this.commands] }); } static fromLog(log) { const parsed = JSON.parse(log); return new InventoryEngine(parsed.data, parsed.commands); } }\n';
  return 'const clone = (value) => JSON.parse(JSON.stringify(value)); export class WorkflowEngine { constructor(data = {}, nextToken = 0) { this.data = data; this.nextToken = nextToken; } start(workflow) { this.data[workflow.workflowId] = { workflowId: workflow.workflowId, status: "running", tasks: Object.fromEntries(workflow.tasks.map((task) => [task.id, { ...task, maxAttempts: task.maxAttempts ?? 1, retryDelayMs: task.retryDelayMs ?? 0, status: "pending", attempt: 0, availableAt: 0 }])) }; } claim(workerId, now, leaseMs) { for (const workflow of Object.values(this.data)) for (const task of Object.values(workflow.tasks)) { if (task.status === "running" && now >= task.leaseExpiresAt) task.status = "pending"; if (task.status === "pending" && now >= task.availableAt && (!task.dependsOn || task.dependsOn.every((id) => workflow.tasks[id].status === "succeeded"))) { task.status = "running"; task.attempt += 1; task.workerId = workerId; task.leaseToken = "token-" + ++this.nextToken; task.leaseExpiresAt = now + leaseMs; return clone({ workflowId: workflow.workflowId, taskId: task.id, mode: "execute", attempt: task.attempt, workerId, leaseToken: task.leaseToken, leaseExpiresAt: task.leaseExpiresAt }); } } return undefined; } assertClaim(claim, now) { const task = this.data[claim.workflowId]?.tasks[claim.taskId]; if (!task || task.status !== "running" || task.workerId !== claim.workerId || task.leaseToken !== claim.leaseToken || now >= task.leaseExpiresAt) throw new Error("stale claim"); return task; } complete(claim, output, options) { const task = this.assertClaim(claim, options.now); task.status = "succeeded"; task.output = clone(output); const workflow = this.data[claim.workflowId]; if (Object.values(workflow.tasks).every((entry) => entry.status === "succeeded")) workflow.status = "succeeded"; return { workflowId: claim.workflowId, taskId: claim.taskId, output: clone(output) }; } fail(claim, _error, options) { const task = this.assertClaim(claim, options.now); if (task.attempt >= task.maxAttempts) { task.status = "failed"; this.data[claim.workflowId].status = "failed"; } else { task.status = "pending"; task.availableAt = options.now + task.retryDelayMs * 2 ** (task.attempt - 1); } } state(id) { return clone(this.data[id]); } exportLog() { return JSON.stringify({ data: this.data, nextToken: this.nextToken }); } static fromLog(log) { const parsed = JSON.parse(log); return new WorkflowEngine(parsed.data, parsed.nextToken); } }\n';
}

function durableHappyPathSource(domain: "inventory" | "workflow"): string {
  if (domain === "inventory")
    return 'export class InventoryEngine { constructor(data = {}) { this.data = data; this.commands = new Map(); } execute(command, options) { if (this.commands.has(options.commandId)) return this.commands.get(options.commandId); let state = this.data[command.sku]; if (command.type === "create-sku") state = { sku: command.sku, onHand: 0, reserved: 0, available: 0, reservations: {}, version: 1 }; else { state = { ...state, reservations: { ...state.reservations }, version: state.version + 1 }; if (command.type === "receive") state.onHand += command.quantity; if (command.type === "reserve") { state.reserved += command.quantity; state.reservations[command.orderId] = (state.reservations[command.orderId] ?? 0) + command.quantity; } if (command.type === "ship") { state.onHand -= command.quantity; state.reserved -= command.quantity; state.reservations[command.orderId] -= command.quantity; } state.available = state.onHand - state.reserved; } this.data[command.sku] = state; const result = JSON.parse(JSON.stringify(state)); this.commands.set(options.commandId, result); return result; } state(sku) { return JSON.parse(JSON.stringify(this.data[sku])); } exportLog() { return JSON.stringify({ data: this.data, commands: [...this.commands] }); } static fromLog(log) { const parsed = JSON.parse(log); const engine = new InventoryEngine(parsed.data); engine.commands = new Map(parsed.commands); return engine; } }\n';
  return 'export class WorkflowEngine { constructor(data = {}) { this.data = data; } start(workflow) { this.data[workflow.workflowId] = { workflowId: workflow.workflowId, status: "running", tasks: Object.fromEntries(workflow.tasks.map((task) => [task.id, { ...task, status: "pending", attempt: 0 }])) }; } claim(_worker, _now, _lease) { for (const workflow of Object.values(this.data)) for (const task of Object.values(workflow.tasks)) if (task.status === "pending" && (!task.dependsOn || task.dependsOn.every((id) => workflow.tasks[id].status === "succeeded"))) { task.status = "running"; task.attempt += 1; return { workflowId: workflow.workflowId, taskId: task.id }; } return undefined; } complete(claim, output) { const workflow = this.data[claim.workflowId]; const task = workflow.tasks[claim.taskId]; task.status = "succeeded"; task.output = output; if (Object.values(workflow.tasks).every((entry) => entry.status === "succeeded")) workflow.status = "succeeded"; } state(id) { return JSON.parse(JSON.stringify(this.data[id])); } exportLog() { return JSON.stringify(this.data); } static fromLog(log) { return new WorkflowEngine(JSON.parse(log)); } }\n';
}
