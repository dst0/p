import { createHash } from "node:crypto";

const FRAGMENT_TYPES = new Set(["Added", "Changed", "Fixed", "Removed", "Breaking Changes", "None"]);

export function parseReleaseChangeFragment(path, content, allowLegacyNoneSummary = false) {
  let fragment;
  try {
    fragment = JSON.parse(content);
  } catch {
    throw new Error(`${path}: release-note fragment must be valid JSON`);
  }
  if (fragment.schemaVersion !== 1) {
    throw new Error(`${path}: unsupported release-note fragment schema`);
  }
  if (!Array.isArray(fragment.packages) || fragment.packages.length === 0) {
    throw new Error(`${path}: release-note fragment must name at least one package`);
  }
  const packages = [...new Set(fragment.packages)];
  if (packages.some((name) => !["agent", "ai", "coding-agent", "tui"].includes(name))) {
    throw new Error(`${path}: release-note fragment names an unknown changelog package`);
  }
  if (!FRAGMENT_TYPES.has(fragment.type)) {
    throw new Error(`${path}: release-note fragment type is invalid`);
  }
  if (fragment.type === "None") {
    const justification = fragment.reason ?? (allowLegacyNoneSummary ? fragment.summary : undefined);
    if (typeof justification !== "string" || justification.trim().length < 10) {
      throw new Error(`${path}: None fragments require a specific reason`);
    }
    if (/[\u0000-\u001f\u007f]/.test(justification)) {
      throw new Error(`${path}: None fragment reason must be single-line text`);
    }
  } else if (typeof fragment.summary !== "string" || fragment.summary.trim().length < 10) {
    throw new Error(`${path}: release-note fragment requires a specific summary`);
  } else if (/[\u0000-\u001f\u007f]/.test(fragment.summary)) {
    throw new Error(`${path}: release-note fragment requires a single-line summary`);
  }
  return {
    path,
    id: path.slice(".changes/".length, -".json".length),
    packages: packages.sort(),
    type: fragment.type,
    summary: fragment.summary?.trim(),
    reason: fragment.reason?.trim(),
    // Match historical Git reads; the release-input hash separately binds raw file bytes.
    contentHash: createHash("sha256").update(content.trim()).digest("hex"),
  };
}
