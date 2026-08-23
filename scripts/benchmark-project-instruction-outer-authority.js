import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_AUTHORITY_MESSAGE_BYTES = 65_536;
const MAX_TURNS = 6;

export function hashProjectInstructionResult(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function canonicalAuthority(authority) {
  return (
    authority &&
    typeof authority === "object" &&
    !Array.isArray(authority) &&
    Object.keys(authority).length === 4 &&
    Number.isSafeInteger(authority.expectedTurnCount) &&
    authority.expectedTurnCount >= 1 &&
    authority.expectedTurnCount <= MAX_TURNS &&
    Array.isArray(authority.baseSystemModeProofs) &&
    authority.baseSystemModeProofs.length === authority.expectedTurnCount &&
    Array.isArray(authority.userTurns) &&
    authority.userTurns.length === authority.expectedTurnCount &&
    HASH_PATTERN.test(authority.resultSha256)
  );
}

function exactEnvelope(message, expectedCellReceiptSha256) {
  return (
    message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    Object.keys(message).length === 4 &&
    message.schemaVersion === 1 &&
    message.kind === "project-instruction-outer-authority" &&
    message.cellReceiptSha256 === expectedCellReceiptSha256 &&
    canonicalAuthority(message.authority)
  );
}

export function createProjectInstructionOuterAuthorityEnvelope(
  cellReceiptSha256,
  authority,
  resultSha256,
) {
  const envelope = {
    schemaVersion: 1,
    kind: "project-instruction-outer-authority",
    cellReceiptSha256,
    authority: {
      expectedTurnCount: authority?.expectedTurnCount,
      baseSystemModeProofs: authority?.baseSystemModeProofs,
      userTurns: authority?.userTurns,
      resultSha256,
    },
  };
  if (!HASH_PATTERN.test(cellReceiptSha256) || !exactEnvelope(envelope, cellReceiptSha256)) {
    throw new Error("Project instruction outer authority envelope is invalid");
  }
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_AUTHORITY_MESSAGE_BYTES) {
    throw new Error("Project instruction outer authority envelope is oversized");
  }
  return envelope;
}

export function createProjectInstructionOuterAuthorityCapture(expectedCellReceiptSha256) {
  let authority;
  let messageCount = 0;
  let invalid = !HASH_PATTERN.test(expectedCellReceiptSha256);
  return {
    accept(message) {
      messageCount += 1;
      if (messageCount > 1) {
        authority = undefined;
        invalid = true;
        return;
      }
      try {
        if (
          Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_AUTHORITY_MESSAGE_BYTES ||
          !exactEnvelope(message, expectedCellReceiptSha256)
        ) {
          invalid = true;
          return;
        }
        authority = message.authority;
      } catch {
        invalid = true;
      }
    },
    finish() {
      return !invalid && messageCount === 1 ? authority : undefined;
    },
  };
}

export function sendProjectInstructionOuterAuthority(envelope, target = process) {
  if (!exactEnvelope(envelope, envelope?.cellReceiptSha256)) {
    throw new Error("Project instruction outer authority envelope is invalid");
  }
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_AUTHORITY_MESSAGE_BYTES) {
    throw new Error("Project instruction outer authority envelope is oversized");
  }
  if (typeof target.send !== "function" || target.connected !== true) {
    throw new Error("Project instruction outer authority IPC is unavailable");
  }
  return new Promise((resolve, reject) => {
    try {
      target.send(envelope, (error) => {
        if (error) {
          reject(new Error("Project instruction outer authority IPC send failed", { cause: error }));
          return;
        }
        try {
          target.disconnect();
          resolve();
        } catch (disconnectError) {
          reject(new Error("Project instruction outer authority IPC disconnect failed", { cause: disconnectError }));
        }
      });
    } catch (error) {
      reject(new Error("Project instruction outer authority IPC send failed", { cause: error }));
    }
  });
}

export function applyProjectInstructionOuterAuthority(evidence, authority, actualResultSha256) {
  if (!canonicalAuthority(authority) || authority.resultSha256 !== actualResultSha256) {
    throw new Error("Project instruction outer result commitment is invalid");
  }
  if (
    evidence?.proofExpectedTurnCount !== authority.expectedTurnCount ||
    !isDeepStrictEqual(evidence?.baseSystemModeProofs, authority.baseSystemModeProofs) ||
    !isDeepStrictEqual(evidence?.userTurns, authority.userTurns)
  ) {
    throw new Error("Project instruction outer proof evidence does not match the child publication");
  }
  return {
    ...evidence,
    proofExpectedTurnCount: authority.expectedTurnCount,
    baseSystemModeProofs: authority.baseSystemModeProofs,
    userTurns: authority.userTurns,
  };
}

export function writeExclusiveProjectInstructionResult(path, contents) {
  try {
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new Error("Project instruction result publication must be exclusive", { cause: error });
  }
}

export function writeProjectInstructionResultPublication(path, document, projectInstructions) {
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (!projectInstructions) {
    writeFileSync(path, contents, "utf8");
    return undefined;
  }
  const evidence = document?.results?.length === 1 ? document.results[0]?.projectInstructionEvidence : undefined;
  const authority = {
    expectedTurnCount: evidence?.proofExpectedTurnCount,
    baseSystemModeProofs: evidence?.baseSystemModeProofs,
    userTurns: evidence?.userTurns,
  };
  const envelope = createProjectInstructionOuterAuthorityEnvelope(
    "a".repeat(64),
    authority,
    hashProjectInstructionResult(contents),
  );
  writeExclusiveProjectInstructionResult(path, contents);
  return envelope.authority;
}

export async function sendCommittedProjectInstructionOuterAuthority(cellReceiptSha256, authority, target = process) {
  const envelope = createProjectInstructionOuterAuthorityEnvelope(
    cellReceiptSha256,
    authority,
    authority?.resultSha256,
  );
  await sendProjectInstructionOuterAuthority(envelope, target);
}
