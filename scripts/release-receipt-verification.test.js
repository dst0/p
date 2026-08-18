import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import {
  computeReleaseCertificateId,
  computeReleaseEvidenceHash,
  stableJson,
} from "./release-audit-certificate.js";
import { verifyReleaseReceipt } from "./release-certificate-receipt.js";
import {
  createReleaseFlowFixture,
  git,
  gitBuffer,
  runFixtureRelease,
} from "./release-flow-test-fixture.js";
import { hashReleaseInputEntries } from "./release-inputs.js";
import { isAllowedReleaseMutationPath } from "./release-path-policy.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function releaseFixture() {
  const fixture = createReleaseFlowFixture();
  const result = runFixtureRelease(fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  git(fixture.repoRoot, "checkout", "--detach", "v0.5.0");
  return fixture;
}

function receiptPath(fixture) {
  return join(fixture.repoRoot, "release-certificates/v0.5.0.json.br");
}

function readReceipt(fixture) {
  return JSON.parse(brotliDecompressSync(readFileSync(receiptPath(fixture))));
}

function writeReceipt(fixture, receipt) {
  writeFileSync(
    receiptPath(fixture),
    brotliCompressSync(Buffer.from(`${stableJson(receipt)}\n`), {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    }),
  );
}

function amendReleaseTag(fixture, paths) {
  git(fixture.repoRoot, "add", "--", ...paths);
  git(fixture.repoRoot, "commit", "--amend", "--no-edit");
  git(fixture.repoRoot, "tag", "-f", "v0.5.0", "HEAD");
  git(fixture.repoRoot, "push", "--force", "origin", "HEAD:refs/heads/main");
}

function amendJson(fixture, path, mutate) {
  const absolutePath = join(fixture.repoRoot, path);
  const value = JSON.parse(readFileSync(absolutePath, "utf8"));
  mutate(value);
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
  amendReleaseTag(fixture, [path]);
}

test("rejects a self-consistent receipt that omits canonical workspace inputs", () => {
  const fixture = releaseFixture();
  try {
    const receipt = readReceipt(fixture);
    receipt.inputPaths = receipt.inputPaths.filter((path) => path !== "packages/agent/package.json");
    receipt.inputHash = hashReleaseInputEntries(
      receipt.inputPaths.map((path) => ({
        path,
        content: gitBuffer(fixture.repoRoot, "show", `${receipt.baseSha}:${path}`),
      })),
    );
    receipt.certificateId = computeReleaseCertificateId(receipt);
    writeReceipt(fixture, receipt);
    amendReleaseTag(fixture, ["release-certificates/v0.5.0.json.br"]);

    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /input paths do not match the canonical base scope/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects self-consistent evidence that was not produced from the certified base", () => {
  const fixture = releaseFixture();
  try {
    const receipt = readReceipt(fixture);
    receipt.evidence.changeFragments.commits = [];
    receipt.evidenceHash = computeReleaseEvidenceHash(receipt.evidence);
    receipt.certificateId = computeReleaseCertificateId(receipt);
    writeReceipt(fixture, receipt);
    amendReleaseTag(fixture, ["release-certificates/v0.5.0.json.br"]);

    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /evidence does not match a deterministic audit/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects released changelog content that differs from the certified preview", () => {
  const fixture = releaseFixture();
  try {
    const path = "packages/agent/CHANGELOG.md";
    const absolutePath = join(fixture.repoRoot, path);
    writeFileSync(absolutePath, readFileSync(absolutePath, "utf8").replace("- Added value.", "- Tampered value."));
    amendReleaseTag(fixture, [path]);

    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /released content does not match the certified changelog preview/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a non-version workspace manifest mutation", () => {
  const fixture = releaseFixture();
  try {
    amendJson(fixture, "packages/agent/package.json", (packageJson) => {
      packageJson.private = true;
    });
    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /packages\/agent\/package\.json.*deterministic version mutation/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a retained current release-note fragment", () => {
  const fixture = releaseFixture();
  try {
    const receipt = readReceipt(fixture);
    writeFileSync(
      join(fixture.repoRoot, ".changes/add-value.json"),
      gitBuffer(fixture.repoRoot, "show", `${receipt.baseSha}:.changes/add-value.json`),
    );
    amendReleaseTag(fixture, [".changes/add-value.json"]);
    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /release-note fragments must be absent from the release tag/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a generated source mutation in the release commit", () => {
  const fixture = releaseFixture();
  try {
    const path = "packages/ai/src/models.generated.ts";
    writeFileSync(join(fixture.repoRoot, path), "export const generatedModels = [\"tampered\"];\n");
    amendReleaseTag(fixture, [path]);
    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /release commit paths do not exactly match certified outputs/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects generated model drift in the local release path policy", () => {
  assert.equal(isAllowedReleaseMutationPath(repositoryRoot, "packages/ai/src/models.generated.ts"), false);
  assert.equal(isAllowedReleaseMutationPath(repositoryRoot, "packages/ai/src/image-models.generated.ts"), false);
});

test("rejects a full lockfile content mismatch", () => {
  const fixture = releaseFixture();
  try {
    amendJson(fixture, "package-lock.json", (lockfile) => {
      lockfile.unexpectedReleaseField = true;
    });
    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /package-lock\.json.*deterministic version mutation/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a deterministically wrong coding-agent shrinkwrap", () => {
  const fixture = releaseFixture();
  try {
    amendJson(fixture, "packages/coding-agent/npm-shrinkwrap.json", (shrinkwrap) => {
      shrinkwrap.unexpectedReleaseField = true;
    });
    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /coding-agent shrinkwrap does not match deterministic regeneration/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects an annotated tag even when it peels to the certified release commit", () => {
  const fixture = releaseFixture();
  try {
    git(fixture.repoRoot, "tag", "--delete", "v0.5.0");
    git(fixture.repoRoot, "tag", "--annotate", "v0.5.0", "--message", "annotated release");
    assert.throws(
      () => verifyReleaseReceipt(fixture.repoRoot, "v0.5.0"),
      /must be lightweight and point directly to a commit/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
