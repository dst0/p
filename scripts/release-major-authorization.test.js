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
import { computeBenchmarkCertificationId } from "./release-benchmark-certification.js";
import {
  createReleaseFlowFixture,
  git,
  runFixtureRelease,
  writeFixtureBenchmarkCertification,
} from "./release-flow-test-fixture.js";

const releaseAuditScript = resolve("scripts/release-audit.js");

test("major release audit fails closed without benchmark certification", () => {
  const fixture = createReleaseFlowFixture();
  try {
    assert.throws(
      () => certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true }),
      /benchmark certification/i,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("major release audit rejects stale and future-dated benchmark evidence", () => {
  const fixture = createReleaseFlowFixture();
  try {
    writeFixtureBenchmarkCertification(fixture, "5.0.1", {
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    assert.throws(
      () => certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true }),
      /older than 24 hours/u,
    );

    writeFixtureBenchmarkCertification(fixture, "5.0.1", {
      createdAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    assert.throws(
      () => certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true }),
      /future clock skew/u,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function rewriteReceiptAuthorization(fixture, targetVersion, allowMajor) {
  const tagName = `v${targetVersion}`;
  git(fixture.repoRoot, "checkout", "--detach", tagName);
  const path = join(
    fixture.repoRoot,
    `release-certificates/${tagName}.json.br`,
  );
  const receipt = JSON.parse(brotliDecompressSync(readFileSync(path)));
  receipt.allowMajor = allowMajor;
  if (allowMajor && !receipt.benchmarkCertification) {
    receipt.benchmarkCertification = {};
  } else if (!allowMajor) {
    delete receipt.benchmarkCertification;
  }
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
    const benchmark = writeFixtureBenchmarkCertification(fixture);
    assert.deepEqual(benchmark.matrix.tasks, [
      "typescript-calculator",
      "monolith-split",
      "event-sourced-inventory",
      "durable-workflow-saga",
    ]);
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

test("rejects unbound fields in a self-rehashed benchmark certification", () => {
  const fixture = createReleaseFlowFixture();
  try {
    writeFixtureBenchmarkCertification(fixture);
    const certificate = certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true });
    const benchmarkCertification = {
      ...certificate.benchmarkCertification,
      unexpectedMetadata: "not covered by the benchmark certification id",
    };
    benchmarkCertification.certificationId = computeBenchmarkCertificationId(benchmarkCertification);
    const forged = { ...certificate, benchmarkCertification };
    forged.certificateId = computeReleaseCertificateId(forged);
    writeReleaseAuditState(fixture.repoRoot, forged);
    assert.match(inspectReleaseCertificate(fixture.repoRoot, "5.0.1").reason, /unexpected field/i);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects placeholder hashes in a self-rehashed benchmark certification", () => {
  const fixture = createReleaseFlowFixture();
  try {
    writeFixtureBenchmarkCertification(fixture);
    const certificate = certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true });
    const benchmarkCertification = {
      ...certificate.benchmarkCertification,
      binding: {
        ...certificate.benchmarkCertification.binding,
        candidateRuntimeSha256: "0".repeat(64),
      },
    };
    benchmarkCertification.certificationId = computeBenchmarkCertificationId(benchmarkCertification);
    const forged = { ...certificate, benchmarkCertification };
    forged.certificateId = computeReleaseCertificateId(forged);
    writeReleaseAuditState(fixture.repoRoot, forged);
    assert.match(inspectReleaseCertificate(fixture.repoRoot, "5.0.1").reason, /invalid binding/i);
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

    writeFixtureBenchmarkCertification(fixture);
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
      if (initialAllowMajor) writeFixtureBenchmarkCertification(fixture, targetVersion);
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
