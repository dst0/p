import type { BinaryLike } from "node:crypto";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_AUTHORITY_MESSAGE_BYTES = 65_536;
const MAX_TURNS = 6;

export type ProjectInstructionAuthority = {
  expectedTurnCount: number;
  baseSystemModeProofs: unknown[];
  userTurns: unknown[];
  resultSha256: string;
};

type AuthorityInput = {
  expectedTurnCount?: number;
  baseSystemModeProofs?: unknown[];
  userTurns?: unknown[];
  resultSha256?: string;
};

type AuthorityEnvelope = {
  schemaVersion: 1;
  kind: "project-instruction-outer-authority";
  cellReceiptSha256: string;
  authority: ProjectInstructionAuthority;
};

type AuthorityEvidence = {
  proofExpectedTurnCount?: number;
  baseSystemModeProofs?: unknown[];
  userTurns?: unknown[];
};

type ResultDocument = {
  results?: Array<{ projectInstructionEvidence?: AuthorityEvidence }>;
};

type IpcTarget = Pick<NodeJS.Process, "connected" | "disconnect" | "send">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hashProjectInstructionResult(contents: BinaryLike): string {
  return createHash("sha256").update(contents).digest("hex");
}

function canonicalAuthority(authority: unknown): authority is ProjectInstructionAuthority {
  return (
    isRecord(authority) &&
    Object.keys(authority).length === 4 &&
    typeof authority.expectedTurnCount === "number" &&
    Number.isSafeInteger(authority.expectedTurnCount) &&
    authority.expectedTurnCount >= 1 &&
    authority.expectedTurnCount <= MAX_TURNS &&
    Array.isArray(authority.baseSystemModeProofs) &&
    authority.baseSystemModeProofs.length === authority.expectedTurnCount &&
    Array.isArray(authority.userTurns) &&
    authority.userTurns.length === authority.expectedTurnCount &&
    typeof authority.resultSha256 === "string" &&
    HASH_PATTERN.test(authority.resultSha256)
  );
}

function exactEnvelope(message: unknown, expectedCellReceiptSha256: string): message is AuthorityEnvelope {
  return (
    isRecord(message) &&
    Object.keys(message).length === 4 &&
    message.schemaVersion === 1 &&
    message.kind === "project-instruction-outer-authority" &&
    message.cellReceiptSha256 === expectedCellReceiptSha256 &&
    canonicalAuthority(message.authority)
  );
}

export function createProjectInstructionOuterAuthorityEnvelope(
  cellReceiptSha256: string,
  authority: AuthorityInput,
  resultSha256: string,
): AuthorityEnvelope {
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

export function createProjectInstructionOuterAuthorityCapture(expectedCellReceiptSha256: string): {
  accept(message: unknown): void;
  finish(): ProjectInstructionAuthority | undefined;
} {
  let authority: ProjectInstructionAuthority | undefined;
  let messageCount = 0;
  let invalid = !HASH_PATTERN.test(expectedCellReceiptSha256);
  return {
    accept(message: unknown) {
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

export function sendProjectInstructionOuterAuthority(
  envelope: AuthorityEnvelope,
  target: IpcTarget = process,
): Promise<void> {
  if (!exactEnvelope(envelope, envelope?.cellReceiptSha256)) {
    throw new Error("Project instruction outer authority envelope is invalid");
  }
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_AUTHORITY_MESSAGE_BYTES) {
    throw new Error("Project instruction outer authority envelope is oversized");
  }
  if (typeof target.send !== "function" || target.connected !== true) {
    throw new Error("Project instruction outer authority IPC is unavailable");
  }
  const send = target.send;
  return new Promise<void>((resolve, reject) => {
    try {
      send.call(target, envelope, (error) => {
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

export function applyProjectInstructionOuterAuthority<T extends AuthorityEvidence>(
  evidence: T,
  authority: unknown,
  actualResultSha256: string,
): T & Required<Pick<AuthorityEvidence, "proofExpectedTurnCount" | "baseSystemModeProofs" | "userTurns">> {
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
  } as T & Required<Pick<AuthorityEvidence, "proofExpectedTurnCount" | "baseSystemModeProofs" | "userTurns">>;
}

export function writeExclusiveProjectInstructionResult(path: string, contents: string): void {
  try {
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new Error("Project instruction result publication must be exclusive", { cause: error });
  }
}

export function writeProjectInstructionResultPublication(
  path: string,
  document: ResultDocument,
  projectInstructions: unknown,
): ProjectInstructionAuthority | undefined {
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

export async function sendCommittedProjectInstructionOuterAuthority(
  cellReceiptSha256: string,
  authority: ProjectInstructionAuthority,
  target: IpcTarget = process,
): Promise<void> {
  const envelope = createProjectInstructionOuterAuthorityEnvelope(
    cellReceiptSha256,
    authority,
    authority?.resultSha256,
  );
  await sendProjectInstructionOuterAuthority(envelope, target);
}
