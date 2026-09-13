import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBenchmarkSandboxProfile } from "../../src/harness/benchmark-isolation.ts";
import { snapshotCertifiedExecutableRuntime } from "../../src/workloads/certification-executable-snapshot.ts";

test("certified executable snapshot freezes the package runtime closure inside sandbox scope", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-runtime-binding-"));
  try {
    const candidate = join(root, "candidate");
    const piRoot = join(root, "pi-package");
    const workspace = join(root, "workspace");
    mkdirSync(candidate);
    mkdirSync(join(piRoot, "bin"), { recursive: true });
    mkdirSync(workspace);
    writeFileSync(join(piRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
    writeFileSync(join(piRoot, "dependency.txt"), "live-v1\n");
    const pi = join(piRoot, "bin", "pi");
    writeFileSync(
      pi,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "1.0.0"; else cat "$(dirname "$0")/../dependency.txt"; fi\n',
    );
    chmodSync(pi, 0o755);

    const frozen = snapshotCertifiedExecutableRuntime(pi, "pi", join(candidate, "certified-runtimes", "pi"));
    assert.equal(spawnSync(frozen.executablePath, [], { encoding: "utf8" }).stdout, "live-v1\n");

    writeFileSync(join(piRoot, "dependency.txt"), "live-v2\n");
    assert.equal(spawnSync(frozen.executablePath, [], { encoding: "utf8" }).stdout, "live-v1\n");

    const profile = createBenchmarkSandboxProfile({ workspace, runtime: candidate });
    assert.match(profile, new RegExp(`subpath ${JSON.stringify(realpathSync(candidate))}`, "u"));
    assert.equal(profile.includes(piRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified executable snapshot rejects external symlink bytes before creating the destination", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-runtime-external-link-"));
  try {
    const packageRoot = join(root, "package");
    const outside = join(root, "secret.txt");
    const destination = join(root, "snapshot");
    mkdirSync(join(packageRoot, "bin"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const executable = join(packageRoot, "bin", "pi");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    writeFileSync(outside, "SECRET_BYTES_MUST_NOT_ENTER_SNAPSHOT");
    symlinkSync(outside, join(packageRoot, "dependency.txt"));

    assert.throws(() => snapshotCertifiedExecutableRuntime(executable, "pi", destination), /external symbolic link/u);
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicitly allowlisted external link records immutable provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-runtime-allowlisted-link-"));
  try {
    const packageRoot = join(root, "package");
    const shared = join(root, "shared-runtime.js");
    const destination = join(root, "snapshot");
    mkdirSync(join(packageRoot, "bin"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const executable = join(packageRoot, "bin", "pi");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    writeFileSync(shared, "trusted shared runtime\n");
    symlinkSync(shared, join(packageRoot, "shared-runtime.js"));

    const frozen = snapshotCertifiedExecutableRuntime(executable, "pi", destination, {
      allowedExternalSymlinks: [{ link: "shared-runtime.js", target: shared }],
    });
    assert.equal(frozen.externalSymlinks.length, 1);
    assert.equal(frozen.externalSymlinks[0]?.targetPath, realpathSync(shared));
    assert.equal(
      frozen.externalSymlinks[0]?.sha256,
      createHash("sha256")
        .update(readFileSync(join(destination, "shared-runtime.js")))
        .digest("hex"),
    );
    assert.equal(lstatSync(join(destination, "shared-runtime.js")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(destination, "shared-runtime.js"), "utf8"), "trusted shared runtime\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
