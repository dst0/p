import { createHash } from "node:crypto";

const HISTORICAL_RELEASE_FRAGMENT_EXCEPTIONS = Object.freeze([
  Object.freeze({
    commit: "56eeb58cf67bd906677e9ba335ff97fef6352374",
    pathCount: 1,
    changedPathsHash: "a54ff182c7e8acf56acfd6e4b9c3ff41e2c41a31c9b211b2deb9df75d9a478f9",
    affectedPackages: Object.freeze(["coding-agent"]),
    allowedMissingPackages: Object.freeze(["coding-agent"]),
    reason: "Governance-only AGENTS.md adoption has no runtime or published-package change.",
  }),
  Object.freeze({
    commit: "4c6bc0af26ddb2da25bf246bb8748c239833b543",
    pathCount: 33,
    changedPathsHash: "261329f0e668422500d69324b83582a2c0a6d45bf09b22bbed6cd9bafd1c5e2b",
    affectedPackages: Object.freeze(["coding-agent"]),
    allowedMissingPackages: Object.freeze(["coding-agent"]),
    reason: "Governance-only learning-record migration has no runtime or published-package change.",
  }),
  Object.freeze({
    commit: "bbecf92062a08f9aeb50fe127fba93bc92d9ef2b",
    pathCount: 2,
    changedPathsHash: "10336b76ed29dc536bf467224544a74ece811b41ac576c2e60cd19ad3a8aad10",
    affectedPackages: Object.freeze(["coding-agent"]),
    allowedMissingPackages: Object.freeze(["coding-agent"]),
    reason: "Governance-only AGY worktree-identity guidance has no runtime or published-package change.",
  }),
  Object.freeze({
    commit: "ec4aa24e67aaf610b198753331dffc907ca76577",
    pathCount: 388,
    changedPathsHash: "cb0203adfda7a169ed53b8be7099303f2faed818db6b51b19c4adac9b779cdf0",
    affectedPackages: Object.freeze(["agent", "ai", "coding-agent"]),
    legacyFragment: Object.freeze({
      path: ".changes/project-instructions-benchmark-evidence.json",
      contentHash: "9cad0ee3055b59f0f9bcac677c294e119eaf191e548d569afb7ccfd489205e96",
      previousContentHash: "5f9a0a43e9366ce1655691988590f6177d93aa3adc6cfde1993126ecc1ec25bb",
    }),
    reason: "Policy-introduction commit updates one pre-policy benchmark fragment; other material paths retain normal coverage.",
  }),
  Object.freeze({
    commit: "4f99a97c755281e0e85ad06ddc611631501e9888",
    pathCount: 12,
    changedPathsHash: "df987f2fa4ec1a1b37f787df87f241c0216c9fb71df498702825983be7b67117",
    affectedPackages: Object.freeze(["coding-agent"]),
    legacyFragment: Object.freeze({
      path: ".changes/project-instructions-benchmark-evidence.json",
      contentHash: "5f9a0a43e9366ce1655691988590f6177d93aa3adc6cfde1993126ecc1ec25bb",
      previousContentHash: "9cad0ee3055b59f0f9bcac677c294e119eaf191e548d569afb7ccfd489205e96",
    }),
    reason: "Recovery commit restores the exact pre-policy benchmark fragment while preserving its historical evidence.",
  }),
  Object.freeze({
    commit: "5cf86d4d9441ceff1f15e6129d7110bca2d3f462",
    pathCount: 51,
    changedPathsHash: "f4eb494d662c062a4cb280953ed56047e3e5f8c26e8ca20c40fd6c6abd1fb84f",
    affectedPackages: Object.freeze(["agent", "coding-agent"]),
    allowedMissingPackages: Object.freeze(["agent"]),
    reason: "The agent-only delta adds model-call preparation tests; coding-agent runtime changes retain fragment coverage.",
  }),
  Object.freeze({
    commit: "2db67221fabc077df03b1412b93375f177dc42f4",
    pathCount: 2,
    changedPathsHash: "15e115be999df094e2c9ecceb6c99b7016a57da520cce2d147ca813b1f88b759",
    affectedPackages: Object.freeze(["coding-agent"]),
    allowedMissingPackages: Object.freeze(["coding-agent"]),
    reason: "A test fixture gains path-independent budget margin with a learning record; runtime behavior is unchanged.",
  }),
]);

function hashChangedPaths(changedPaths) {
  return createHash("sha256").update(changedPaths.join("\0")).digest("hex");
}

export function getHistoricalReleaseFragmentException(commit, changedPaths) {
  const exception = HISTORICAL_RELEASE_FRAGMENT_EXCEPTIONS.find((candidate) => candidate.commit === commit);
  if (!exception || exception.pathCount !== changedPaths.length) {
    return undefined;
  }
  if (exception.changedPathsHash !== hashChangedPaths(changedPaths)) {
    return undefined;
  }
  return {
    commit: exception.commit,
    pathCount: exception.pathCount,
    changedPathsHash: exception.changedPathsHash,
    affectedPackages: [...exception.affectedPackages],
    ...(exception.allowedMissingPackages ? { allowedMissingPackages: [...exception.allowedMissingPackages] } : {}),
    ...(exception.legacyFragment ? { legacyFragment: { ...exception.legacyFragment } } : {}),
    reason: exception.reason,
  };
}

export function matchesHistoricalLegacyFragment(exception, path, contentHash) {
  const fragment = exception?.legacyFragment;
  return fragment !== undefined && fragment.path === path && fragment.contentHash === contentHash;
}

export function getHistoricalReleaseFragmentExceptionCommits() {
  return HISTORICAL_RELEASE_FRAGMENT_EXCEPTIONS.map(({ commit }) => commit);
}
