import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

describe("evidence-mode zero-effect completion", () => {
  it("blocks successful completion until the current prompt has one checklist", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "Explain the current behavior clearly.", 100);

      const result = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });

      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("record one completion checklist");
      expect(result?.reason).toContain('verification_scope "response_only"');
      expect(result?.reason).toContain("otherwise perform the requested effect");
    } finally {
      harness.dispose();
    }
  });

  it("allows a current response-only checklist without readiness or a token", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "Explain the current behavior clearly.", 100);
      await recordChecklist(
        harness,
        "response_only",
        "The response explains the current behavior clearly and completely",
      );
      const finishArgs: Record<string, unknown> = { status: "success" };

      const result = await beforeEvidenceTool(harness.agent, "finish_work", finishArgs);

      expect(result?.block).not.toBe(true);
      expect(harness.controller.currentState.mutationRevision).toBe(0);
      expect(harness.controller.currentState.readiness?.status).toBe("pending");
      expect(finishArgs.verification_token).toBeUndefined();
      expect(finishArgs.files_changed).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("converges from a rejected finish through one checklist to a successful retry", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "Explain the current behavior clearly.", 100);
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).toBe(true);

      await recordChecklist(
        harness,
        "response_only",
        "The response explains the current behavior clearly and completely",
      );

      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("requires and retains an independent declaration for an unclassified response language", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "¿Puedes explicar cómo funciona?", 100);
      await recordChecklist(harness, "response_only", "La respuesta explica claramente cómo funciona");

      const firstFinish = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });
      expect(firstFinish?.block).toBe(true);
      expect(firstFinish?.reason).toContain('"action":"declare_task"');

      expect(
        await callEvidenceVerification(harness.controller, {
          action: "declare_task",
          task_kind: "investigation",
          task_summary: "Explicar cómo funciona en la respuesta visible",
        }),
      ).toContain("Task intent declared");
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "declare_task",
          task_kind: "feature",
          task_summary: "Replace the response-only classification",
        }),
      ).toContain("Cannot replace the same-prompt task intent declaration");
      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("rejects an intent declaration without a substantive user prompt", async () => {
    const harness = createHarness();
    try {
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "declare_task",
          task_kind: "investigation",
          task_summary: "Answer the user",
        }),
      ).toContain("requires a current substantive user prompt");
    } finally {
      harness.dispose();
    }
  });

  it("does not let an earlier response-only prompt mask a later unclassified effect", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "Explain the current behavior clearly.", 100);
      await recordChecklist(harness, "response_only", "The response explains the current behavior");
      await sendPrompt(harness, "Crea GUIDE.md con la explicación solicitada.", 101);
      await recordChecklist(harness, "response_only", "GUIDE.md contains the requested explanation");

      const finish = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });
      expect(finish?.block).toBe(true);
      expect(finish?.reason).toContain('"action":"declare_task"');
      expect(harness.controller.currentState.taskKind).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });

  it("clears an earlier unknown-language declaration after a substantive prompt", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "¿Puedes explicar cómo funciona?", 100);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "declare_task",
          task_kind: "investigation",
          task_summary: "Explicar cómo funciona",
        }),
      ).toContain("Task intent declared");
      expect(harness.controller.currentState.taskKind).toBe("investigation");

      await sendPrompt(harness, "この仕組みを説明してください。", 101);

      expect(harness.controller.currentState.taskKind).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });

  it.each([
    ["Spanish create", "Crea GUIDE.md con la explicación solicitada."],
    ["Spanish send", "Envía el mensaje de aprobación solicitado."],
    ["Japanese create", "GUIDE.mdを作成してください。"],
    ["Japanese send", "承認メッセージを送信してください。"],
    ["Ukrainian create", "Створи GUIDE.md із поясненням."],
    ["Ukrainian send", "Надішли повідомлення про схвалення."],
    [
      "response with trailing send",
      "Write a two-bullet note in your response once you have sent the approval message.",
    ],
    ["response after passive send", "Write the answer in your response after the approval message is sent."],
  ])("does not let a response-only checklist finish an unclassified %s request", async (_label, prompt) => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, prompt, 100);
      await recordChecklist(harness, "response_only", "The requested operation completes successfully");

      expect((await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" }))?.block).toBe(true);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "declare_task",
          task_kind: "feature",
          task_summary: "Complete the requested workspace or external effect",
        }),
      ).toContain("Task intent declared");
      const finalFinish = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });
      expect(finalFinish?.block).toBe(true);
      expect(finalFinish?.reason).toContain("requires at least one successful effect");
    } finally {
      harness.dispose();
    }
  });

  it.each([
    [
      "workspace artifact mislabeled as response-only",
      "Create GUIDE.md with the requested explanation.",
      "response_only",
    ],
    ["runtime task mislabeled as response-only", "Implement the requested runtime behavior.", "response_only"],
    ["external task mislabeled as response-only", "Send the requested approval message.", "response_only"],
    ["runtime task", "Implement the requested runtime behavior.", "runtime_behavior"],
    ["external task", "Send the requested approval message.", "external_operation"],
  ] as const)("requires a real effect for a %s checklist", async (_label, prompt, scope) => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, prompt, 100);
      await recordChecklist(harness, scope, "The requested operation completes successfully");

      const result = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });

      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("requires at least one successful effect");
    } finally {
      harness.dispose();
    }
  });

  it("blocks a checklist made stale by a later substantive prompt", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "Explain the current behavior clearly.", 100);
      await recordChecklist(
        harness,
        "response_only",
        "The response explains the current behavior clearly and completely",
      );
      await sendPrompt(harness, "Also compare it with the previous behavior.", 101);

      const result = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });

      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("record one completion checklist");
    } finally {
      harness.dispose();
    }
  });

  it("keeps the effect-backed readiness path unchanged", async () => {
    const harness = createHarness();
    try {
      await sendPrompt(harness, "Create result.txt containing the requested result.", 100);
      await recordChecklist(harness, "runtime_behavior", "result.txt contains the requested result line");
      const writeArgs = { path: "result.txt", content: "requested result\n" };
      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(harness.cwd, "result.txt"), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote result.txt", writeCall);
      const evidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "read", { path: "result.txt" }, writeArgs.content),
      );
      const ready = await callEvidenceVerification(harness.controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[evidence]],
        unresolved_failures: [],
      });
      expect(ready).toContain("verification_token:");

      const result = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });

      expect(result?.block).not.toBe(true);
    } finally {
      harness.dispose();
    }
  });
});

function createHarness() {
  const cwd = mkdtempSync(join(tmpdir(), "p-zero-effect-completion-"));
  mkdirSync(join(cwd, "src"));
  const harness = createEvidenceHarness(cwd);
  return { ...harness, cwd, dispose: () => rmSync(cwd, { recursive: true, force: true }) };
}

async function sendPrompt(harness: ReturnType<typeof createHarness>, content: string, timestamp: number) {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}

async function recordChecklist(
  harness: ReturnType<typeof createHarness>,
  verificationScope: "runtime_behavior" | "non_runtime_content" | "external_operation" | "response_only",
  criterion: string,
) {
  expect(
    await callEvidenceVerification(harness.controller, {
      action: "record_completion_checklist",
      completion_checklist: [criterion],
      verification_scope: verificationScope,
    }),
  ).toContain("Completion checklist recorded");
}
