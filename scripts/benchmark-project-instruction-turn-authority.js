import { createHash } from "node:crypto";
import { bindProjectInstructionProofToTurn } from "./benchmark-project-instruction-proof-ipc.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function challengeIdentity(cellReceiptSha256, turnOrdinal, promptSha256, promptBytes) {
  return JSON.stringify({ cellReceiptSha256, turnOrdinal, promptSha256, promptBytes });
}

export function createProjectInstructionTurnChallenge(cellReceiptSha256, turnOrdinal, prompt) {
  if (
    !HASH_PATTERN.test(cellReceiptSha256) ||
    !Number.isSafeInteger(turnOrdinal) ||
    turnOrdinal < 1 ||
    typeof prompt !== "string"
  ) {
    throw new Error("Project instruction turn challenge identity is invalid");
  }
  const promptSha256 = hashText(prompt);
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  const receiptSha256 = hashText(challengeIdentity(cellReceiptSha256, turnOrdinal, promptSha256, promptBytes));
  return { cellReceiptSha256, turnOrdinal, promptSha256, promptBytes, receiptSha256 };
}

export function bindProjectInstructionTurnAuthority(proof, challenge, userTurns) {
  const userTurn = Array.isArray(userTurns) && userTurns.length === 1 ? userTurns[0] : undefined;
  if (
    !challenge ||
    !HASH_PATTERN.test(challenge.receiptSha256) ||
    userTurn?.sha256 !== challenge.promptSha256 ||
    userTurn?.bytes !== challenge.promptBytes
  ) {
    return undefined;
  }
  const bound = bindProjectInstructionProofToTurn(
    proof,
    challenge.receiptSha256,
    challenge.turnOrdinal,
    userTurns,
  );
  if (!bound) return undefined;
  return {
    ...bound,
    expectedPromptSha256: challenge.promptSha256,
    expectedPromptBytes: challenge.promptBytes,
  };
}

export function validateProjectInstructionTurnAuthoritySequence(
  proofs,
  cellReceiptSha256,
  expectedTurnCount,
  userTurns,
) {
  if (
    !HASH_PATTERN.test(cellReceiptSha256) ||
    !Number.isSafeInteger(expectedTurnCount) ||
    expectedTurnCount < 1 ||
    !Array.isArray(proofs) ||
    !Array.isArray(userTurns) ||
    proofs.length !== expectedTurnCount ||
    userTurns.length !== expectedTurnCount
  ) {
    return false;
  }
  return proofs.every((proof, index) => {
    const turnOrdinal = index + 1;
    const userTurn = userTurns[index];
    if (
      !HASH_PATTERN.test(proof?.expectedPromptSha256) ||
      !Number.isSafeInteger(proof.expectedPromptBytes) ||
      proof.expectedPromptBytes < 0
    ) {
      return false;
    }
    const challenge = createProjectInstructionTurnChallenge(
      cellReceiptSha256,
      turnOrdinal,
      "",
    );
    const expectedReceiptSha256 = hashText(
      challengeIdentity(
        cellReceiptSha256,
        turnOrdinal,
        proof.expectedPromptSha256,
        proof.expectedPromptBytes,
      ),
    );
    return (
      proof.receiptSha256 === expectedReceiptSha256 &&
      proof.turnOrdinal === turnOrdinal &&
      proof.userEventOrdinal === userTurn?.eventOrdinal &&
      proof.userSha256 === userTurn?.sha256 &&
      proof.userBytes === userTurn?.bytes &&
      proof.expectedPromptSha256 === userTurn?.sha256 &&
      proof.expectedPromptBytes === userTurn?.bytes
    );
  });
}
