import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  certifyReleaseAudit,
  readReleaseAuditState,
  writeReleaseAuditState,
} from "./release-audit-certificate.js";
import {
  createReleaseFlowFixture,
  writeFixtureBenchmarkCertification,
} from "./release-flow-test-fixture.js";
import { beginRelease, writeReleaseReceipt } from "./release-transaction.js";
import { discoverWorkspacePackagePaths } from "./release-workspaces.js";

const versionBumpScript = resolve("scripts/version-bump.js");

test("version bump accepts an authorized major target but rejects receipt authorization drift", () => {
  const fixture = createReleaseFlowFixture();
  try {
    writeFixtureBenchmarkCertification(fixture);
    certifyReleaseAudit(fixture.repoRoot, "5.0.1", { allowMajor: true });
    const authorization = beginRelease(fixture.repoRoot, "5.0.1");
    const result = spawnSync(process.execPath, [versionBumpScript, "5.0.1"], {
      cwd: fixture.repoRoot,
      encoding: "utf8",
      env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorization.token },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(fixture.repoRoot, "package.json"))).version, "5.0.1");
    const versionBumped = readReleaseAuditState(fixture.repoRoot);
    writeReleaseAuditState(fixture.repoRoot, { ...versionBumped, allowMajor: false });
    assert.throws(
      () => writeReleaseReceipt(fixture.repoRoot, "5.0.1", authorization.token, "2026-08-21"),
      /authorization|certificate/i,
    );
    assert.equal(existsSync(join(fixture.repoRoot, "release-certificates/v5.0.1.json.br")), false);
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
      writeReleaseAuditState(fixture.repoRoot, scenario.mutate(readReleaseAuditState(fixture.repoRoot)));
      const protectedPaths = [
        "package.json",
        "package-lock.json",
        ...discoverWorkspacePackagePaths(fixture.repoRoot),
      ];
      const before = new Map(
        protectedPaths.map((path) => [path, readFileSync(join(fixture.repoRoot, path), "utf8")]),
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
