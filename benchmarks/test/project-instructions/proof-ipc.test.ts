import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createBaseSystemModeProof } from "../../src/project-instructions/probe.ts";
import {
  bindProjectInstructionProofToTurn,
  consumeProjectInstructionProofEnvironment,
  createProjectInstructionProofIpcCapture,
  createProjectInstructionProofReceipt,
  sendProjectInstructionProof,
  validateProjectInstructionProofSequence,
} from "../../src/project-instructions/proof-ipc.ts";

type IpcTarget = NonNullable<Parameters<typeof sendProjectInstructionProof>[2]>;

const hash = (character: string): string => character.repeat(64);

function canonicalProof(): Record<string, unknown> {
  return {
    requestedMode: "compiled",
    requestedTaskVerificationMode: "evidence",
    effectiveTaskVerificationMode: "evidence",
    registeredVerificationTools: ["record_task_verification"],
    activeVerificationTools: ["record_task_verification"],
    verificationToolSurfaceRegistered: true,
    verificationToolSurfaceActive: true,
    sourceSha256: hash("e"),
    systemPromptSha256: hash("f"),
    systemPromptBytes: 100,
    hasLegacyMarker: false,
    hasCompiledMarker: true,
    compiledInstructionsInjected: true,
    sourceLoaded: true,
    legacySourceInjected: false,
    legacyInjectedBlockHashes: [],
    legacyExpectedBlockHashes: [],
  };
}

function envelope(receiptSha256: string, proof: unknown = canonicalProof()) {
  return { schemaVersion: 1, kind: "project-instruction-startup-proof", receiptSha256, proof };
}

test("receipt hash binds runtime, run, task, mode, source, and nonce", () => {
  const identity = {
    runtimeSha256: hash("a"),
    run: 2,
    task: "inventory",
    mode: "compiled",
    taskVerificationMode: "evidence",
    sourceSha256: hash("b"),
  };
  const receipt = createProjectInstructionProofReceipt(identity, hash("c"));
  for (const change of [
    { runtimeSha256: hash("d") },
    { run: 3 },
    { task: "saga" },
    { mode: "legacy" },
    { taskVerificationMode: "audit" },
    { sourceSha256: hash("e") },
  ]) {
    assert.notEqual(createProjectInstructionProofReceipt({ ...identity, ...change }, hash("c")).sha256, receipt.sha256);
  }
  assert.notEqual(createProjectInstructionProofReceipt(identity, hash("d")).sha256, receipt.sha256);
});

test("reserved proof environment is consumed once and fully scrubbed", () => {
  const env = {
    P_BENCHMARK_PROJECT_INSTRUCTION_RECEIPT: hash("1"),
    P_BENCHMARK_PROJECT_INSTRUCTION_MODE: "compiled",
    P_BENCHMARK_PROJECT_INSTRUCTION_TASK_VERIFICATION_MODE: "evidence",
    P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_SHA256: hash("2"),
    P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_PATH: "/workspace/AGENTS.md",
    P_BENCHMARK_PROJECT_INSTRUCTION_UNRECOGNIZED: "must-also-be-removed",
    SAFE: "kept",
  };
  assert.deepEqual(consumeProjectInstructionProofEnvironment(env), {
    receiptSha256: hash("1"),
    requestedMode: "compiled",
    requestedTaskVerificationMode: "evidence",
    sourceSha256: hash("2"),
    sourcePath: "/workspace/AGENTS.md",
  });
  assert.deepEqual(env, { SAFE: "kept" });
});

test("IPC capture accepts exactly one bounded canonical message", () => {
  const receipt = hash("3");
  const capture = createProjectInstructionProofIpcCapture(receipt);
  capture.accept(envelope(receipt));
  assert.deepEqual(capture.finish(), canonicalProof());
  assert.equal(createProjectInstructionProofIpcCapture(receipt).finish(), undefined);
});

test("IPC capture rejects duplicate, malformed, oversized, and replayed messages", () => {
  const receipt = hash("4");
  const messageSets: unknown[][] = [
    [envelope(receipt), envelope(receipt)],
    [{ ...envelope(receipt), extra: true }],
    [envelope(receipt, { ...canonicalProof(), compiledInstructionsSha256: "x".repeat(40_000) })],
    [envelope(hash("5"))],
  ];
  for (const messages of messageSets) {
    const capture = createProjectInstructionProofIpcCapture(receipt);
    messages.forEach((message) => {
      capture.accept(message);
    });
    assert.equal(capture.finish(), undefined);
  }
});

test("IPC capture retains at most one frame after a duplicate", () => {
  const receipt = hash("4");
  const capture = createProjectInstructionProofIpcCapture(receipt);
  capture.accept(envelope(receipt));
  capture.accept(envelope(receipt));
  let laterFrameInspections = 0;
  capture.accept({
    toJSON() {
      laterFrameInspections += 1;
      return envelope(receipt);
    },
  });
  assert.equal(laterFrameInspections, 0);
  assert.equal(capture.finish(), undefined);
});

test("parent binds one proof to the exact turn and captured user event", () => {
  const receipt = hash("8");
  const userTurn = { eventOrdinal: 12, sha256: hash("9"), bytes: 42 };
  assert.deepEqual(bindProjectInstructionProofToTurn({ requestedMode: "compiled" }, receipt, 2, [userTurn]), {
    requestedMode: "compiled",
    receiptSha256: receipt,
    turnOrdinal: 2,
    userEventOrdinal: 12,
    userSha256: hash("9"),
    userBytes: 42,
  });
  assert.equal(bindProjectInstructionProofToTurn({}, receipt, 2, []), undefined);
  assert.equal(bindProjectInstructionProofToTurn({}, receipt, 2, [userTurn, userTurn]), undefined);
});

test("proof sequence rejects missing, replayed, and non-canonical turn order", () => {
  const receipt = hash("a");
  const turns = [
    { eventOrdinal: 10, sha256: hash("b"), bytes: 10 },
    { eventOrdinal: 20, sha256: hash("c"), bytes: 20 },
  ];
  const maybeProofs = turns.map((turn, index) => bindProjectInstructionProofToTurn({}, receipt, index + 1, [turn]));
  const firstProof = maybeProofs[0];
  const secondProof = maybeProofs[1];
  assert.ok(firstProof);
  assert.ok(secondProof);
  const proofs = [firstProof, secondProof];
  assert.equal(validateProjectInstructionProofSequence(proofs, receipt, turns), true);
  assert.equal(validateProjectInstructionProofSequence(proofs.slice(1), receipt, turns), false);
  assert.equal(validateProjectInstructionProofSequence([proofs[1], proofs[0]], receipt, turns), false);
  assert.equal(validateProjectInstructionProofSequence(proofs, hash("d"), turns), false);
});

test("sender confirms one bounded frame before disconnecting and agent work", async () => {
  const calls: Array<["send", unknown] | ["disconnect"]> = [];
  let completeSend: ((error?: Error | null) => void) | undefined;
  const target = {
    connected: true,
    send(message: unknown, callback: (error?: Error | null) => void) {
      calls.push(["send", message]);
      completeSend = callback;
    },
    disconnect() {
      calls.push(["disconnect"]);
    },
  } as unknown as IpcTarget;
  const sent = sendProjectInstructionProof({ receiptSha256: hash("6") }, canonicalProof(), target);
  assert.equal(calls.length, 1);
  assert.ok(completeSend);
  completeSend();
  await sent;
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["send", "disconnect"],
  );
});

test("sender rejects transport failures without treating the proof as delivered", async () => {
  const receipt = { receiptSha256: hash("6") };
  const sendFailure = new Error("channel closed");
  const sendTarget = {
    connected: true,
    send(_message: unknown, callback: (error?: Error | null) => void) {
      callback(sendFailure);
    },
    disconnect() {
      assert.fail("disconnect must not run after a failed send");
    },
  } as unknown as IpcTarget;
  await assert.rejects(sendProjectInstructionProof(receipt, canonicalProof(), sendTarget), {
    message: "Project instruction startup-proof IPC send failed",
    cause: sendFailure,
  });

  const disconnectFailure = new Error("disconnect failed");
  const disconnectTarget = {
    connected: true,
    send(_message: unknown, callback: (error?: Error | null) => void) {
      callback();
    },
    disconnect() {
      throw disconnectFailure;
    },
  } as unknown as IpcTarget;
  await assert.rejects(sendProjectInstructionProof(receipt, canonicalProof(), disconnectTarget), {
    message: "Project instruction startup-proof IPC disconnect failed",
    cause: disconnectFailure,
  });

  const thrownSendTarget = {
    connected: true,
    send() {
      throw sendFailure;
    },
    disconnect() {
      assert.fail("disconnect must not run after a thrown send");
    },
  } as unknown as IpcTarget;
  await assert.rejects(sendProjectInstructionProof(receipt, canonicalProof(), thrownSendTarget), {
    message: "Project instruction startup-proof IPC send failed",
    cause: sendFailure,
  });
});

test("legacy proof rejects a hash-identical fallback source path", () => {
  const content = "# Rules\nAlways verify.\n";
  const fallbackPath = "/fallback/AGENTS.md";
  const proof = createBaseSystemModeProof(
    {
      systemPrompt: `<project_instructions path="${fallbackPath}">\n${content}\n</project_instructions>`,
      systemPromptOptions: { contextFiles: [{ path: fallbackPath, content }] },
    },
    "legacy",
    createHash("sha256").update(content).digest("hex"),
    "/workspace/AGENTS.md",
  );
  assert.equal(proof.sourceLoaded, false);
  assert.equal(proof.legacySourceInjected, false);
});
