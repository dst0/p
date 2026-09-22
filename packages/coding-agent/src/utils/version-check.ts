import { compare, valid } from "semver";
import { PACKAGE_NAME } from "../config.ts";
import { stripAnsi } from "./ansi.ts";

/**
 * p is a permanent fork: update checks only trust sources the fork controls.
 * The npm registry entry is authoritative because self-update installs exactly this package from npm.
 */
const LATEST_VERSION_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2f")}/latest`;
const RELEASE_NOTES_URL_PREFIX = "https://api.github.com/repos/dst0/p/releases/tags/v";
const VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPiRelease {
  version: string;
  /** GitHub release body for `version`; only fetched when that version is newer than the running one. */
  note?: string;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
  const left = valid(leftVersion.trim());
  const right = valid(rightVersion.trim());
  if (!left || !right) {
    return undefined;
  }
  return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
  const comparison = comparePackageVersions(candidateVersion, currentVersion);
  if (comparison !== undefined) {
    return comparison > 0;
  }
  return candidateVersion.trim() !== currentVersion.trim();
}

/**
 * Returns the registry's `latest` version, or undefined when checks are disabled, the request is unsuccessful,
 * or the body has no valid semver `version`. Rejects on network, timeout, or JSON parse failures.
 */
export async function getLatestPiVersion(): Promise<string | undefined> {
  if (process.env.P_SKIP_VERSION_CHECK || process.env.P_OFFLINE) return undefined;

  const response = await fetch(LATEST_VERSION_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(VERSION_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;

  const version = ((await response.json()) as { version?: unknown } | null)?.version;
  return typeof version === "string" ? (valid(version.trim()) ?? undefined) : undefined;
}

async function getPiReleaseNote(version: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${RELEASE_NOTES_URL_PREFIX}${encodeURIComponent(version)}`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(VERSION_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const body = ((await response.json()) as { body?: unknown } | null)?.body;
    if (typeof body !== "string") return undefined;
    // Notes are rendered in the terminal: drop escape sequences and other control characters.
    const note = stripAnsi(body.replace(/\r\n?/g, "\n"))
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
      .trim();
    return note || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the latest published release. Release notes are requested only when it is newer than
 * `currentVersion`, so the common up-to-date path makes a single registry request.
 */
export async function getLatestPiRelease(currentVersion: string): Promise<LatestPiRelease | undefined> {
  const version = await getLatestPiVersion();
  if (!version) return undefined;
  if (!isNewerPackageVersion(version, currentVersion)) return { version };
  const note = await getPiReleaseNote(version);
  return note ? { version, note } : { version };
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
  try {
    const latestRelease = await getLatestPiRelease(currentVersion);
    if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
      return latestRelease;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
