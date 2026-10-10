import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CertifiedEgressProxy } from "../../src/harness/certified-egress-proxy.ts";
import { verifiedCertifiedProxyCa } from "../../src/harness/certified-proxy-ca.ts";

function withIsolatedHome(action: (agentDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "certified-proxy-ca-test-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = root;
    assert.equal(homedir(), root);
    const agentDir = join(root, ".p", "agent");
    mkdirSync(agentDir, { recursive: true });
    action(agentDir);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}

test("certified proxy uses only a regular local CA file when present", () => {
  withIsolatedHome((agentDir) => {
    assert.equal(verifiedCertifiedProxyCa(), undefined);
    writeFileSync(join(agentDir, "ca.pem"), "synthetic CA fixture\n");
    assert.ok(verifiedCertifiedProxyCa()?.includes("synthetic CA fixture\n"));
  });
});

test("certified proxy refuses symlinked, hard-linked, and non-file CA paths", () => {
  for (const kind of ["symlink", "dangling-symlink", "hardlink", "directory"] as const) {
    withIsolatedHome((agentDir) => {
      const caPath = join(agentDir, "ca.pem");
      const sibling = join(agentDir, "auth.json");
      writeFileSync(sibling, "synthetic credential fixture\n");
      if (kind === "symlink") symlinkSync("auth.json", caPath);
      else if (kind === "dangling-symlink") symlinkSync("missing.pem", caPath);
      else if (kind === "hardlink") linkSync(sibling, caPath);
      else mkdirSync(caPath);
      assert.throws(() => verifiedCertifiedProxyCa(), /regular, unlinked file/u, kind);
    });
  }
});

test("HTTPS proxy startup validates the local CA while HTTP loopback does not read it", () => {
  withIsolatedHome((agentDir) => {
    writeFileSync(join(agentDir, "auth.json"), "synthetic credential fixture\n");
    symlinkSync("auth.json", join(agentDir, "ca.pem"));
    const options = { expectedModel: "fixture-model" };
    assert.throws(
      () => new CertifiedEgressProxy({ ...options, upstreamBaseUrl: "https://provider.invalid/v1" }, 1, []),
      /regular, unlinked file/u,
    );
    assert.doesNotThrow(() => new CertifiedEgressProxy({ ...options, upstreamBaseUrl: "http://127.0.0.1/v1" }, 1, []));
  });
});
