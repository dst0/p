import { createHash, randomBytes } from "node:crypto";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RESERVED_PREFIX = "P_BENCHMARK_PROJECT_INSTRUCTION_";
const MAX_PROOF_MESSAGE_BYTES = 32_768;
const PROOF_KEYS = new Set([
  "requestedMode", "sourceSha256", "systemPromptSha256", "systemPromptBytes", "hasLegacyMarker", "hasCompiledMarker",
  "compiledAgentsHash", "compiledInputHash", "compiledArtifactMode", "compiledInstructionsSha256",
  "compiledInstructionsInjected", "sourceLoaded", "legacySourceInjected", "legacyInjectedBlockHashes",
  "legacyExpectedBlockHashes",
]);
const REQUIRED_PROOF_KEYS = [
  "requestedMode", "sourceSha256", "systemPromptSha256", "systemPromptBytes", "hasLegacyMarker", "hasCompiledMarker",
  "compiledInstructionsInjected", "sourceLoaded", "legacySourceInjected", "legacyInjectedBlockHashes",
  "legacyExpectedBlockHashes",
];

function stableIdentity(identity) {
  return JSON.stringify({
    runtimeSha256: identity.runtimeSha256,
    run: identity.run,
    task: identity.task,
    mode: identity.mode,
    sourceSha256: identity.sourceSha256,
    nonce: identity.nonce,
  });
}

export function createProjectInstructionProofReceipt(identity, nonce = randomBytes(32).toString("hex")) {
  const receipt = { ...identity, nonce };
  if (
    !HASH_PATTERN.test(receipt.runtimeSha256) ||
    !Number.isSafeInteger(receipt.run) ||
    receipt.run < 1 ||
    typeof receipt.task !== "string" ||
    receipt.task.length === 0 ||
    !["compiled", "legacy", "off"].includes(receipt.mode) ||
    !HASH_PATTERN.test(receipt.sourceSha256) ||
    !HASH_PATTERN.test(receipt.nonce)
  ) {
    throw new Error("Project instruction startup-proof receipt identity is invalid");
  }
  return { ...receipt, sha256: createHash("sha256").update(stableIdentity(receipt)).digest("hex") };
}

export function consumeProjectInstructionProofEnvironment(env) {
  const receiptSha256 = env.P_BENCHMARK_PROJECT_INSTRUCTION_RECEIPT;
  const requestedMode = env.P_BENCHMARK_PROJECT_INSTRUCTION_MODE;
  const sourceSha256 = env.P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_SHA256;
  const sourcePath = env.P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_PATH;
  for (const key of Object.keys(env)) {
    if (key.startsWith(RESERVED_PREFIX)) delete env[key];
  }
  if (
    !HASH_PATTERN.test(receiptSha256) ||
    !["compiled", "legacy", "off"].includes(requestedMode) ||
    !HASH_PATTERN.test(sourceSha256) ||
    typeof sourcePath !== "string" ||
    sourcePath.length === 0
  ) {
    return undefined;
  }
  return { receiptSha256, requestedMode, sourceSha256, sourcePath };
}

function exactEnvelope(message, expectedReceiptSha256) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const keys = Object.keys(message);
  if (
    keys.length !== 4 ||
    !keys.every((key) => ["schemaVersion", "kind", "receiptSha256", "proof"].includes(key)) ||
    message.schemaVersion !== 1 ||
    message.kind !== "project-instruction-startup-proof" ||
    message.receiptSha256 !== expectedReceiptSha256 ||
    !canonicalProof(message.proof)
  ) {
    return undefined;
  }
  return message.proof;
}

function canonicalProof(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const keys = Object.keys(proof);
  return keys.every((key) => PROOF_KEYS.has(key)) && REQUIRED_PROOF_KEYS.every((key) => Object.hasOwn(proof, key));
}

export function createProjectInstructionProofIpcCapture(expectedReceiptSha256) {
  const messages = [];
  let invalid = !HASH_PATTERN.test(expectedReceiptSha256);
  return {
    accept(message) {
      if (invalid) return;
      if (messages.length > 0) {
        invalid = true;
        return;
      }
      try {
        const bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
        if (bytes > MAX_PROOF_MESSAGE_BYTES || !exactEnvelope(message, expectedReceiptSha256)) invalid = true;
        else messages.push(message);
      } catch {
        invalid = true;
      }
    },
    finish() {
      return !invalid && messages.length === 1 ? messages[0].proof : undefined;
    },
  };
}

export function bindProjectInstructionProofToTurn(proof, receiptSha256, turnOrdinal, userTurns) {
  const userTurn = Array.isArray(userTurns) && userTurns.length === 1 ? userTurns[0] : undefined;
  if (
    !proof ||
    typeof proof !== "object" ||
    Array.isArray(proof) ||
    !HASH_PATTERN.test(receiptSha256) ||
    !Number.isSafeInteger(turnOrdinal) ||
    turnOrdinal < 1 ||
    !Number.isSafeInteger(userTurn?.eventOrdinal) ||
    !HASH_PATTERN.test(userTurn?.sha256) ||
    !Number.isSafeInteger(userTurn?.bytes) ||
    userTurn.bytes < 0
  ) {
    return undefined;
  }
  return {
    ...proof,
    receiptSha256,
    turnOrdinal,
    userEventOrdinal: userTurn.eventOrdinal,
    userSha256: userTurn.sha256,
    userBytes: userTurn.bytes,
  };
}

export function validateProjectInstructionProofSequence(proofs, receiptSha256, userTurns) {
  if (
    !HASH_PATTERN.test(receiptSha256) ||
    !Array.isArray(proofs) ||
    !Array.isArray(userTurns) ||
    proofs.length === 0 ||
    proofs.length !== userTurns.length
  ) {
    return false;
  }
  return proofs.every((proof, index) => {
    const userTurn = userTurns[index];
    return (
      proof?.receiptSha256 === receiptSha256 &&
      proof.turnOrdinal === index + 1 &&
      proof.userEventOrdinal === userTurn?.eventOrdinal &&
      proof.userSha256 === userTurn?.sha256 &&
      proof.userBytes === userTurn?.bytes
    );
  });
}

export function sendProjectInstructionProof(config, proof, target = process) {
  if (!HASH_PATTERN.test(config.receiptSha256) || !canonicalProof(proof)) {
    throw new Error("Project instruction startup-proof IPC frame is invalid");
  }
  if (typeof target.send !== "function" || target.connected !== true) {
    throw new Error("Project instruction startup-proof IPC is unavailable");
  }
  const message = {
    schemaVersion: 1,
    kind: "project-instruction-startup-proof",
    receiptSha256: config.receiptSha256,
    proof,
  };
  if (Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_PROOF_MESSAGE_BYTES) {
    throw new Error("Project instruction startup-proof IPC frame is oversized");
  }
  return new Promise((resolve, reject) => {
    try {
      target.send(message, (error) => {
        if (error) {
          reject(new Error("Project instruction startup-proof IPC send failed", { cause: error }));
          return;
        }
        try {
          target.disconnect();
          resolve();
        } catch (disconnectError) {
          reject(new Error("Project instruction startup-proof IPC disconnect failed", { cause: disconnectError }));
        }
      });
    } catch (error) {
      reject(new Error("Project instruction startup-proof IPC send failed", { cause: error }));
    }
  });
}
