import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import {
  certifyReleaseAudit,
  computeReleaseCertificateId,
  inspectReleaseCertificate,
  readReleaseAuditState,
  writeReleaseAuditState,
} from "./release-audit-certificate.js";
import { verifyReleaseReceipt } from "./release-certificate-receipt.js";
import {
  createReleaseFlowFixture,
  git,
  runFixtureRelease,
} from "./release-flow-test-fixture.js";
import { beginRelease, writeReleaseReceipt } from "./release-transaction.js";
import { discoverWorkspacePackagePaths } from "./release-workspaces.js";

const releaseAuditScript = resolve("scripts/release-audit.js");
const versionBumpScript = resolve("scripts/version-bump.js");

function rewriteReceiptAuthorization(fixture, targetVersion, allowMajor) {
  const tagName = `v${targetVersion}`;
  git(fixture.repoRoot, "checkout", "--detach", tagName);
  const path = join(
    fixture.repoRoot,
    `release-certificates/${tagName}.json.br`,
  );
  const receipt = JSON.parse(brotliDecompressSync(readFileSync(path)));
  receipt.allowMajor = allowMajor;
  receipt.certificateId = computeReleaseCertificateId(receipt);
  writeFileSync(
    path,
    brotliCompressSync(Buffer.from(`${JSON.stringify(receipt)}\n`), {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    }),
  );
  git(fixture.repoRoot, "add", path);
  git(fixture.repoRoot, "commit", "--amend", "--no-edit");
  git(fixture.repoRoot, "tag", "--force", tagName, "HEAD");
}

test("requires explicit authorization and binds it into a major-release certificate", () => {
  const fixture = createReleaseFlowFixture();
  try {
    assert.throws(
      () => certifyReleaseAudit(fixture.repoRoot, "5.0.1"),
      /explicit authorization/,
    );
    const certificate = certifyReleaseAudit(fixture.repoRoot, "5.0.1", {
      allowMajor: true,
    });
    assert.equal(certificate.allowMajor, true);
    assert.equal(inspectReleaseCertificate(fixture.repoRoot, "5.0.1").valid, true);

    writeReleaseAuditState(fixture.repoRoot, { ...certificate, allowMajor: false });
    assert.match(
      inspectReleaseCertificate(fixture.repoRoot, "5.0.1").reason,
      /certificate integrity check failed/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("standalone audit CLI requires the explicit major-release flag", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const unauthorized = spawnSync(
      process.execPath,
      [releaseAuditScript, "audit", "5.0.1"],
      { cwd: fixture.repoRoot, encoding: "utf8" },
    );
    assert.notEqual(unauthorized.status, 0);
    assert.match(unauthorized.stderr, /explicit authorization/);

    const authorized = spawnSync(
      process.execPath,
      [releaseAuditScript, "audit", "5.0.1", "--allow-major"],
      { cwd: fixture.repoRoot, encoding: "utf8" },
    );
    assert.equal(authorized.status, 0, `${authorized.stdout}\n${authorized.stderr}`);
    assert.equal(readReleaseAuditState(fixture.repoRoot).allowMajor, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("inspection rejects a self-rehashed certificate with invalid major authorization", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const certificate = certifyReleaseAudit(fixture.repoRoot, "0.5.0");
    const forged = {
      ...certificate,
      targetVersion: "5.0.1",
      allowMajor: false,
    };
    forged.certificateId = computeReleaseCertificateId(forged);
    writeReleaseAuditState(fixture.repoRoot, forged);

    assert.match(
      inspectReleaseCertificate(fixture.repoRoot, "5.0.1").reason,
      /explicit authorization/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("receipt verification rejects self-rehashed authorization contradictions", () => {
  for (const [targetVersion, initialAllowMajor, forgedAllowMajor, expected] of [
    ["0.5.0", false, true, /same-major target/],
    ["5.0.1", true, false, /explicit authorization/],
  ]) {
    const fixture = createReleaseFlowFixture();
    try {
      const result = runFixtureRelease(fixture, targetVersion, {
        allowMajor: initialAllowMajor,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      rewriteReceiptAuthorization(fixture, targetVersion, forgedAllowMajor);
      assert.throws(
        () => verifyReleaseReceipt(fixture.repoRoot, `v${targetVersion}`),
        expected,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("version bump accepts an authorized major target but rejects receipt authorization drift", () => {
  const fixture = createReleaseFlowFixture();
  try {
    certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true });
    const authorization = beginRelease(fixture.repoRoot, "5.0.1");
    const result = spawnSync(process.execPath, [versionBumpScript, "5.0.1"], {
      cwd: fixture.repoRoot,
      encoding: "utf8",
      env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorization.token },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      JSON.parse(readFileSync(join(fixture.repoRoot, "package.json"))).version,
      "5.0.1",
    );
    const versionBumped = readReleaseAuditState(fixture.repoRoot);
    writeReleaseAuditState(fixture.repoRoot, { ...versionBumped, allowMajor: false });
    assert.throws(
      () =>
        writeReleaseReceipt(
          fixture.repoRoot,
          "5.0.1",
          authorization.token,
          "2026-08-21",
        ),
      /authorization|certificate/i,
    );
    assert.equal(
      existsSync(join(fixture.repoRoot, "release-certificates/v5.0.1.json.br")),
      false,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("active token rejects target, certificate, and evidence mutation before writes", () => {
  for (const scenario of [
    {
      requestedTarget: "5.0.1",
      mutate: (state) => ({ ...state, targetVersion: "5.0.1" }),
    },
    {
      requestedTarget: "0.5.0",
      mutate: (state) => ({ ...state, certificateId: "0".repeat(64) }),
    },
    {
      requestedTarget: "0.5.0",
      mutate: (state) => ({
        ...state,
        evidence: { ...state.evidence, unexpected: "mutated after authorization" },
      }),
    },
  ]) {
    const fixture = createReleaseFlowFixture();
    try {
      certifyReleaseAudit(fixture.repoRoot, "0.5.0");
      const authorization = beginRelease(fixture.repoRoot, "0.5.0");
      writeReleaseAuditState(
        fixture.repoRoot,
        scenario.mutate(readReleaseAuditState(fixture.repoRoot)),
      );
      const protectedPaths = [
        "package.json",
        "package-lock.json",
        ...discoverWorkspacePackagePaths(fixture.repoRoot),
      ];
      const before = new Map(
        protectedPaths.map((path) => [
          path,
          readFileSync(join(fixture.repoRoot, path), "utf8"),
        ]),
      );

      const result = spawnSync(process.execPath, [versionBumpScript, scenario.requestedTarget], {
        cwd: fixture.repoRoot,
        encoding: "utf8",
        env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorization.token },
      });
      assert.notEqual(result.status, 0);
      for (const [path, content] of before) {
        assert.equal(readFileSync(join(fixture.repoRoot, path), "utf8"), content, path);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
