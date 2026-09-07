import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getPythonMajorMinor,
  reconcilePythonVenv,
} from "./indexing-python-environment.js";

function createTestHarness() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "p-indexing-env-test-"));
  const serviceDir = path.join(root, "indexing-service");
  const venvDir = path.join(serviceDir, "venv");
  const venvBinDir = path.join(venvDir, "bin");
  const venvPython = path.join(venvBinDir, "python");
  const siblingSentinel = path.join(serviceDir, "sibling-sentinel.txt");

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(siblingSentinel, "preserve-me", { mode: 0o600 });

  return {
    agentDirectory: root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
    createVenv(createExecutable = true) {
      fs.mkdirSync(venvBinDir, { recursive: true });
      if (createExecutable) {
        fs.writeFileSync(venvPython, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      }
      fs.writeFileSync(path.join(venvDir, "venv-sentinel.txt"), "sentinel", { mode: 0o600 });
      return { venvDir, venvPython };
    },
    root,
    serviceDir,
    siblingSentinel,
    venvDir,
    venvPython,
  };
}

test("getPythonMajorMinor extracts exact major.minor and rejects malformed outputs", () => {
  const fakeCapture = (cmd) => {
    if (cmd === "/bin/py312") return "3.12\n";
    if (cmd === "/bin/py312-verbose") return "Python 3.12.13\n3.12\n";
    if (cmd === "/bin/py314-padded") return "  3.14  \n";
    if (cmd === "/bin/garbage") return "3.12garbage\n";
    if (cmd === "/bin/warning-suffix") return "3.12.13 warning\n";
    if (cmd === "/bin/patch-triple") return "3.12.13\n";
    if (cmd === "/bin/negative-major") return "-3.12\n";
    if (cmd === "/bin/negative-minor") return "3.-12\n";
    if (cmd === "/bin/zero-major") return "0.12\n";
    if (cmd === "/bin/unsafe-int") return "9007199254740992.1\n";
    if (cmd === "/bin/invalid") return "unknown output\n";
    throw new Error(`Command not found: ${cmd}`);
  };

  assert.deepEqual(getPythonMajorMinor("/bin/py312", fakeCapture), [3, 12]);
  assert.deepEqual(getPythonMajorMinor("/bin/py312-verbose", fakeCapture), [3, 12]);
  assert.deepEqual(getPythonMajorMinor("/bin/py314-padded", fakeCapture), [3, 14]);
  assert.equal(getPythonMajorMinor("/bin/garbage", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/warning-suffix", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/patch-triple", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/negative-major", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/negative-minor", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/zero-major", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/unsafe-int", fakeCapture), undefined);
  assert.equal(getPythonMajorMinor("/bin/invalid", fakeCapture), undefined);
  assert.throws(() => getPythonMajorMinor("/bin/missing", fakeCapture), /Command not found/);
});

test("selected interpreter probe failure fails closed without deleting anything", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(true);
    const fakeCapture = () => {
      throw new Error("Selected python probe failed: corrupted interpreter binary");
    };
    assert.throws(
      () =>
        reconcilePythonVenv(
          { agentDirectory: harness.agentDirectory, python: "/usr/bin/broken-python" },
          fakeCapture,
        ),
      /Selected python probe failed/,
    );
    assert.ok(fs.existsSync(harness.venvDir), "venvDirectory must not be deleted on probe failure");
    assert.ok(fs.existsSync(path.join(harness.venvDir, "venv-sentinel.txt")), "venv contents intact");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must remain intact");
  } finally {
    harness.cleanup();
  }
});

test("missing options.agentDirectory fails closed before probing or deletion", () => {
  assert.throws(
    () => reconcilePythonVenv({ python: "/usr/bin/python3.12" }),
    /reconcilePythonVenv requires options.agentDirectory/,
  );
});

test("wrong or broad venvDirectory target is rejected before probing or deletion", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(true);
    assert.throws(
      () =>
        reconcilePythonVenv({
          agentDirectory: harness.agentDirectory,
          python: "/usr/bin/python3.12",
          venvDirectory: harness.root,
        }),
      /reconcilePythonVenv options.venvDirectory must be exactly/,
    );
    assert.ok(fs.existsSync(harness.venvDir), "venvDirectory must remain intact");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must remain intact");
  } finally {
    harness.cleanup();
  }
});

test("wrong venvPython target is rejected before probing or deletion", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(true);
    assert.throws(
      () =>
        reconcilePythonVenv({
          agentDirectory: harness.agentDirectory,
          python: "/usr/bin/python3.12",
          venvPython: "/usr/bin/python",
        }),
      /reconcilePythonVenv options.venvPython must be exactly/,
    );
    assert.ok(fs.existsSync(harness.venvDir), "venvDirectory must remain intact");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must remain intact");
  } finally {
    harness.cleanup();
  }
});

test("symlinked parent component fails closed without deleting", () => {
  const harness = createTestHarness();
  try {
    const realServiceDir = path.join(harness.root, "real-indexing-service");
    const realVenvDir = path.join(realServiceDir, "venv");
    fs.mkdirSync(realVenvDir, { recursive: true });
    fs.writeFileSync(path.join(realVenvDir, "sentinel.txt"), "real-sentinel", { mode: 0o600 });
    fs.rmSync(harness.serviceDir, { recursive: true, force: true });
    fs.symlinkSync(realServiceDir, harness.serviceDir);

    const fakeCapture = (cmd) => (cmd === "/usr/bin/python3.12" ? "3.12\n" : "");
    assert.throws(
      () =>
        reconcilePythonVenv(
          { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
          fakeCapture,
        ),
      /parent directory contains a symlink/i,
    );
    assert.ok(fs.existsSync(path.join(realVenvDir, "sentinel.txt")), "target under symlinked parent preserved");
  } finally {
    harness.cleanup();
  }
});

test("final-component symlink removes only the symlink non-recursively preserving target and siblings", () => {
  const harness = createTestHarness();
  try {
    const externalVenv = path.join(harness.root, "external-target-venv");
    fs.mkdirSync(externalVenv, { recursive: true });
    fs.writeFileSync(path.join(externalVenv, "external-sentinel.txt"), "keep", { mode: 0o600 });
    fs.symlinkSync(externalVenv, harness.venvDir);

    const fakeCapture = (cmd) => (cmd === "/usr/bin/python3.12" ? "3.12\n" : "");
    const preserved = reconcilePythonVenv(
      { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
      fakeCapture,
    );

    assert.equal(preserved, false);
    assert.equal(fs.existsSync(harness.venvDir), false, "symlink must be unlinked");
    assert.ok(fs.existsSync(externalVenv), "external target directory must be preserved");
    assert.ok(fs.existsSync(path.join(externalVenv, "external-sentinel.txt")), "external file preserved");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must be preserved");
  } finally {
    harness.cleanup();
  }
});

test("missing venv interpreter removes only options.venvDirectory", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(false);
    const fakeCapture = (cmd) => {
      if (cmd === "/usr/bin/python3.12") return "3.12\n";
      throw new Error(`Unexpected command: ${cmd}`);
    };
    const preserved = reconcilePythonVenv(
      { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
      fakeCapture,
    );
    assert.equal(preserved, false);
    assert.equal(fs.existsSync(harness.venvDir), false, "broken venv directory must be deleted");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must be preserved");
  } finally {
    harness.cleanup();
  }
});

test("broken venv interpreter execution removes only options.venvDirectory", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(true);
    const fakeCapture = (cmd) => {
      if (cmd === "/usr/bin/python3.12") return "3.12\n";
      if (cmd === harness.venvPython) throw new Error("dyld: Library not loaded");
      throw new Error(`Unexpected command: ${cmd}`);
    };
    const preserved = reconcilePythonVenv(
      { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
      fakeCapture,
    );
    assert.equal(preserved, false);
    assert.equal(fs.existsSync(harness.venvDir), false, "unexecutable venv directory must be deleted");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must be preserved");
  } finally {
    harness.cleanup();
  }
});

test("major.minor mismatch (e.g. 3.12 selected vs 3.14 venv) removes only options.venvDirectory", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(true);
    const fakeCapture = (cmd) => {
      if (cmd === "/usr/bin/python3.12") return "3.12\n";
      if (cmd === harness.venvPython) return "3.14\n";
      throw new Error(`Unexpected command: ${cmd}`);
    };
    const preserved = reconcilePythonVenv(
      { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
      fakeCapture,
    );
    assert.equal(preserved, false);
    assert.equal(fs.existsSync(harness.venvDir), false, "ABI mismatched venv must be deleted");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must be preserved");
  } finally {
    harness.cleanup();
  }
});

test("matching major.minor preserves options.venvDirectory ignoring patch versions", () => {
  const harness = createTestHarness();
  try {
    harness.createVenv(true);
    const fakeCapture = (cmd) => {
      if (cmd === "/usr/bin/python3.12") return "3.12\n";
      if (cmd === harness.venvPython) return "3.12\n";
      throw new Error(`Unexpected command: ${cmd}`);
    };
    const preserved = reconcilePythonVenv(
      { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
      fakeCapture,
    );
    assert.equal(preserved, true);
    assert.ok(fs.existsSync(harness.venvDir), "compatible venv must be preserved");
    assert.ok(fs.existsSync(path.join(harness.venvDir, "venv-sentinel.txt")), "venv contents preserved");
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must be preserved");
  } finally {
    harness.cleanup();
  }
});

test("non-existent venv directory returns false and does not throw when selected python is valid", () => {
  const harness = createTestHarness();
  try {
    const fakeCapture = (cmd) => {
      if (cmd === "/usr/bin/python3.12") return "3.12\n";
      throw new Error(`Unexpected command: ${cmd}`);
    };
    const preserved = reconcilePythonVenv(
      { agentDirectory: harness.agentDirectory, python: "/usr/bin/python3.12" },
      fakeCapture,
    );
    assert.equal(preserved, false);
    assert.ok(fs.existsSync(harness.siblingSentinel), "sibling files must be preserved");
  } finally {
    harness.cleanup();
  }
});
