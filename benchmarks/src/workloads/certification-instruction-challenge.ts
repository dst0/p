import { createHash, randomBytes } from "node:crypto";

const slots = ["head", "middle", "tail"] as const;

export interface CertifiedInstructionChallenge {
  augmentedContent: string;
  receiptValue: string;
}

export function createCertifiedInstructionChallenge(source: string, seed?: string): CertifiedInstructionChallenge {
  const tokens = slots.map((slot) => `certified-parity-${slot}-${tokenEntropy(slot, seed)}`);
  const lines = source.trimEnd().split("\n");
  const midpoint = Math.floor(lines.length / 2);
  const head = directive("head", tokens[0]);
  const middle = directive("middle", tokens[1]);
  const tail = directive("tail", tokens[2], true);
  return {
    augmentedContent: [head, lines.slice(0, midpoint).join("\n"), middle, lines.slice(midpoint).join("\n"), tail]
      .filter(Boolean)
      .join("\n\n")
      .concat("\n"),
    receiptValue: tokens.join("|"),
  };
}

function tokenEntropy(slot: (typeof slots)[number], seed?: string): string {
  if (seed === undefined) return randomBytes(16).toString("hex");
  return createHash("sha256").update(`${seed}:${slot}`).digest("hex").slice(0, 32);
}

function directive(slot: (typeof slots)[number], token: string, final = false): string {
  const lines = [
    `<!-- certified-instruction-parity-${slot} -->`,
    `Certified parity ${slot} material: ${token}`,
    "Retain this automatically loaded material without reading project files or using tools.",
  ];
  if (final) lines.push("When asked, respond with the head, middle, and tail materials joined by | and nothing else.");
  return lines.join("\n");
}
