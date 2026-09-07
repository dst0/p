import assert from "node:assert/strict";
import test from "node:test";
import {
  findCompatiblePython,
  indexingPythonCandidateNames,
  tryAutoInstallIndexingPython,
} from "./indexing-python-discovery.js";

test("macOS indexing prefers Python versions supported by pinned Core ML dependencies", () => {
  assert.deepEqual(indexingPythonCandidateNames({ platform: "darwin" }), [
    "python3.12",
    "python3",
  ]);
  assert.deepEqual(indexingPythonCandidateNames({ platform: "darwin", requiredMinor: 12 }), [
    "python3.12",
    "python3",
  ]);
  assert.deepEqual(indexingPythonCandidateNames({ platform: "linux" }).slice(0, 3), [
    "python3",
    "python3.14",
    "python3.13",
  ]);
});

test("macOS accepts Python 3.12 and rejects every incompatible fallback version", () => {
  for (const version of ["3.10", "3.11", "3.14"]) {
    assert.throws(() => findCompatiblePython({
      allowInstall: false,
      platform: "darwin",
      findOnPath: (name) => name === "python3" ? `/python/${version}` : undefined,
      captureCommand: () => `${version}\n`,
    }), /Code indexing requires Python 3\.12/);
  }
  assert.equal(findCompatiblePython({
    allowInstall: false,
    platform: "darwin",
    findOnPath: (name) => name === "python3.12" ? "/python/3.12" : undefined,
    captureCommand: () => "3.12\n",
  }), "/python/3.12");
});

test("macOS uses a Homebrew-installed Python outside the original PATH", () => {
  let installCalls = 0;
  assert.equal(findCompatiblePython({
    platform: "darwin",
    findOnPath: (name) => name === "python3" ? "/python/3.14" : undefined,
    captureCommand: (candidate) => candidate.endsWith("python3.12") ? "3.12\n" : "3.14\n",
    installPython: (requiredMinor, platform) => {
      installCalls += 1;
      assert.equal(requiredMinor, 12);
      assert.equal(platform, "darwin");
      return ["/opt/homebrew/opt/python@3.12/bin/python3.12"];
    },
  }), "/opt/homebrew/opt/python@3.12/bin/python3.12");
  assert.equal(installCalls, 1);
});

test("explicit minor and Linux discovery retain their existing contracts", () => {
  const versions = new Map([
    ["/python/3.12", "3.12\n"],
    ["/python/3.14", "3.14\n"],
  ]);
  assert.equal(findCompatiblePython({
    allowInstall: false,
    platform: "linux",
    requiredMinor: 12,
    findOnPath: (name) => name === "python3.12" ? "/python/3.12" : "/python/3.14",
    captureCommand: (candidate) => versions.get(candidate) ?? "",
  }), "/python/3.12");
  assert.equal(findCompatiblePython({
    allowInstall: false,
    platform: "linux",
    findOnPath: (name) => name === "python3" ? "/python/3.14" : undefined,
    captureCommand: (candidate) => versions.get(candidate) ?? "",
  }), "/python/3.14");
});

test("Homebrew installation returns the formula interpreter for immediate discovery", () => {
  const commands = [];
  assert.deepEqual(tryAutoInstallIndexingPython(12, "darwin", {
    findOnPath: (name) => name === "brew" ? "/opt/homebrew/bin/brew" : undefined,
    runCommand: (command, args) => {
      commands.push([command, args]);
      return true;
    },
    captureCommand: (_command, args) => args[0] === "--prefix"
      ? "/opt/homebrew/opt/python@3.12\n"
      : "",
  }), ["/opt/homebrew/opt/python@3.12/bin/python3.12"]);
  assert.deepEqual(commands, [["/opt/homebrew/bin/brew", ["install", "python@3.12"]]]);
});
