import { createHash } from "node:crypto";
import { bindProjectInstructionProofToTurn } from "./proof-ipc.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

type UserTurn = { bytes?: number; eventOrdinal?: number; sha256?: string };

type TurnChallenge = {
  cellReceiptSha256: string;
  promptBytes: number;
  promptSha256: string;
  receiptSha256: string;
  turnOrdinal: number;
};

type BoundProof = Record<string, unknown> & {
  expectedPromptBytes?: number;
  expectedPromptSha256?: string;
  receiptSha256?: string;
  turnOrdinal?: number;
  userBytes?: number;
  userEventOrdinal?: number;
  userSha256?: string;
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function challengeIdentity(
  cellReceiptSha256: string,
  turnOrdinal: number,
  promptSha256: string,
  promptBytes: number,
): string {
  return JSON.stringify({ cellReceiptSha256, turnOrdinal, promptSha256, promptBytes });
}

export function createProjectInstructionTurnChallenge(
  cellReceiptSha256: string,
  turnOrdinal: number,
  prompt: string,
): TurnChallenge {
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

export function bindProjectInstructionTurnAuthority(
  proof: unknown,
  challenge: TurnChallenge | undefined,
  userTurns: UserTurn[],
): BoundProof | undefined {
  const userTurn = Array.isArray(userTurns) && userTurns.length === 1 ? userTurns[0] : undefined;
  if (
    !challenge ||
    !HASH_PATTERN.test(challenge.receiptSha256) ||
    userTurn?.sha256 !== challenge.promptSha256 ||
    userTurn?.bytes !== challenge.promptBytes
  ) {
    return undefined;
  }
  const bound = bindProjectInstructionProofToTurn(proof, challenge.receiptSha256, challenge.turnOrdinal, userTurns);
  if (!bound) return undefined;
  return {
    ...bound,
    expectedPromptSha256: challenge.promptSha256,
    expectedPromptBytes: challenge.promptBytes,
  };
}

export function validateProjectInstructionTurnAuthoritySequence(
  proofs: BoundProof[],
  cellReceiptSha256: string,
  expectedTurnCount: number,
  userTurns: UserTurn[],
): boolean {
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
      typeof proof?.expectedPromptSha256 !== "string" ||
      !HASH_PATTERN.test(proof.expectedPromptSha256) ||
      typeof proof.expectedPromptBytes !== "number" ||
      !Number.isSafeInteger(proof.expectedPromptBytes) ||
      proof.expectedPromptBytes < 0
    ) {
      return false;
    }
    const expectedReceiptSha256 = hashText(
      challengeIdentity(cellReceiptSha256, turnOrdinal, proof.expectedPromptSha256, proof.expectedPromptBytes),
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
