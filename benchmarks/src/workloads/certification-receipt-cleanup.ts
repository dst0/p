import { type Dirent, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import { replacePrivateBrotliText } from "../harness/private-brotli.ts";

const REDACTION = "<REDACTED_PARITY_RECEIPT>";
const MUTABLE_ARTIFACT_ROOTS = new Set(["config", "preflight", "workspaces"]);

export interface CertifiedReceiptCleanupOptions {
  mutableArtifactsSafe?: boolean;
}

export function redactReceiptFromBrotliFile(recordingPath: string, receiptValue: string): void {
  if (!existsSync(recordingPath) || !receiptValue) return;
  try {
    const raw = brotliDecompressSync(readFileSync(recordingPath)).toString("utf8");
    if (raw.includes(receiptValue)) {
      replacePrivateBrotliText(recordingPath, raw.replaceAll(receiptValue, REDACTION));
    }
  } catch (error) {
    throw new Error(`Unable to redact certified receipt from ${recordingPath}`, { cause: error });
  }
}

export function sanitizeCertifiedReceiptArtifacts(
  output: string,
  receiptValue: string,
  options: CertifiedReceiptCleanupOptions = {},
): void {
  if (!receiptValue || !existsSync(output)) return;
  assertCertifiedOutputWritePath(output, true);
  const errors: unknown[] = [];
  try {
    rmSync(join(output, "instructions"), { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  const mutableArtifactsSafe = options.mutableArtifactsSafe ?? true;
  scrubTree(output, output, receiptValue, errors, mutableArtifactsSafe);
  verifyTree(output, output, receiptValue, errors, mutableArtifactsSafe);
  if (errors.length > 0) {
    throw new AggregateError(errors, "Unable to sanitize certified receipt artifacts");
  }
}

function scrubTree(
  root: string,
  current: string,
  receiptValue: string,
  errors: unknown[],
  mutableArtifactsSafe: boolean,
): void {
  for (const entry of readDirectory(current, errors)) {
    const path = join(current, entry.name);
    try {
      if (!mutableArtifactsSafe && current === root && MUTABLE_ARTIFACT_ROOTS.has(entry.name)) continue;
      if (entry.name.includes(receiptValue)) {
        assertCertifiedOutputWritePath(current);
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      if (entry.isSymbolicLink()) {
        assertCertifiedOutputWritePath(current);
        rmSync(path, { force: true });
        continue;
      }
      assertCertifiedOutputWritePath(path);
      if (isCertifiedWorkspaceMetadata(root, path)) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      if (entry.isDirectory()) {
        scrubTree(root, path, receiptValue, errors, mutableArtifactsSafe);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isGeneratedBrotli(root, path)) redactReceiptFromBrotliFile(path, receiptValue);
      else redactReceiptBytes(path, receiptValue);
    } catch (error) {
      errors.push(error);
    }
  }
}

function verifyTree(
  root: string,
  current: string,
  receiptValue: string,
  errors: unknown[],
  mutableArtifactsSafe: boolean,
): void {
  for (const entry of readDirectory(current, errors)) {
    const path = join(current, entry.name);
    try {
      if (!mutableArtifactsSafe && current === root && MUTABLE_ARTIFACT_ROOTS.has(entry.name)) continue;
      if (entry.name.includes(receiptValue)) throw new Error(`Certified receipt remains in artifact path: ${path}`);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        verifyTree(root, path, receiptValue, errors, mutableArtifactsSafe);
        continue;
      }
      if (!entry.isFile()) continue;
      const contents = isGeneratedBrotli(root, path) ? brotliDecompressSync(readFileSync(path)) : readFileSync(path);
      if (contents.includes(Buffer.from(receiptValue))) {
        throw new Error(`Certified receipt remains in artifact file: ${path}`);
      }
    } catch (error) {
      errors.push(error);
    }
  }
}

function readDirectory(path: string, errors: unknown[]): Dirent<string>[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch (error) {
    errors.push(error);
    return [];
  }
}

function isCertifiedWorkspaceMetadata(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath.startsWith(`workspaces${sep}`) && (basename(path) === ".git" || basename(path) === "AGENTS.md");
}

function isGeneratedBrotli(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    path.endsWith(".br") && (relativePath.startsWith(`recordings${sep}`) || relativePath.startsWith(`stderr${sep}`))
  );
}

function redactReceiptBytes(path: string, receiptValue: string): void {
  const source = readFileSync(path);
  const needle = Buffer.from(receiptValue);
  if (!source.includes(needle)) return;
  const replacement = Buffer.from(REDACTION);
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(needle, offset);
    if (index === -1) {
      chunks.push(source.subarray(offset));
      break;
    }
    chunks.push(source.subarray(offset, index), replacement);
    offset = index + needle.length;
  }
  assertCertifiedOutputWritePath(path);
  writeFileSync(path, Buffer.concat(chunks));
}
