import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import test from "node:test";

import { getCurrentChangeFragments } from "./release-change-fragments.js";
import { affectedChangelogPackages } from "./release-changelog-audit.js";
import { createReleaseFlowFixture, write } from "./release-flow-test-fixture.js";
import { parseReleaseChangeFragment } from "./release-fragment-parser.js";
import {
  getHistoricalFragmentPackageAliases,
  getHistoricalReleaseFragmentException,
  getHistoricalReleaseFragmentExceptionCommits,
  matchesHistoricalLegacyFragment,
} from "./release-historical-fragment-exceptions.js";
import { computeReleaseInputHash, releaseInputPaths } from "./release-inputs.js";

// Captured from the eleven reviewed Git commits; no branch or network dependency in tests.
const scopes = JSON.parse(readFileSync(new URL("./fixtures/release-historical-fragment-scopes.json", import.meta.url), "utf8"));

test("binds every historical exception to its full commit and complete ordered path set", () => {
  assert.deepEqual(getHistoricalReleaseFragmentExceptionCommits(), scopes.map(({ commit }) => commit));
  assert.equal(new Set(getHistoricalReleaseFragmentExceptionCommits()).size, scopes.length);
  for (const { commit, paths, fragments } of scopes) {
    const exception = getHistoricalReleaseFragmentException(commit, paths);
    assert.ok(exception, commit);
    const affected = affectedChangelogPackages(paths.filter((path) => !path.startsWith(".changes/")));
    assert.deepEqual(exception.affectedPackages, affected);
    const covered = new Set(fragments.flatMap(({ content }) => JSON.parse(content).packages));
    assert.deepEqual(exception.allowedMissingPackages ?? [], affected.filter((name) => !covered.has(name)));
    assert.equal(getHistoricalReleaseFragmentException(commit.slice(0, 12), paths), undefined);
    assert.equal(getHistoricalReleaseFragmentException(commit, paths.slice(1)), undefined);
    assert.equal(getHistoricalReleaseFragmentException(commit, [...paths, "packages/ai/src/new.js"]), undefined);
    assert.equal(getHistoricalReleaseFragmentException(commit, ["packages/ai/src/replaced.js", ...paths.slice(1)]), undefined);
    if (paths.length > 1) assert.equal(getHistoricalReleaseFragmentException(commit, [...paths].reverse()), undefined);
    exception.affectedPackages.push("tui");
    exception.allowedMissingPackages?.push("tui");
    assert.deepEqual(getHistoricalReleaseFragmentException(commit, paths).affectedPackages, affected);
    assert.deepEqual(getHistoricalReleaseFragmentException(commit, paths).allowedMissingPackages ?? [], affected.filter((name) => !covered.has(name)));
  }
});

test("allows only the reviewed legacy content and preserves the rewrite/recovery chain", () => {
  let rewrittenHash;
  let originalHash;
  for (const { commit, paths, fragments } of scopes) {
    const exception = getHistoricalReleaseFragmentException(commit, paths);
    if (!exception?.legacyFragment) continue;
    assert.equal(exception.allowedMissingPackages, undefined);
    const { path, content } = fragments.find(({ path }) => path === exception.legacyFragment.path);
    const hash = createHash("sha256").update(content.trim()).digest("hex");
    assert.equal(matchesHistoricalLegacyFragment(exception, path, hash), true);
    assert.equal(matchesHistoricalLegacyFragment(undefined, path, hash), false);
    assert.equal(matchesHistoricalLegacyFragment(exception, `${path}.copy`, hash), false);
    assert.equal(matchesHistoricalLegacyFragment(exception, path, `${hash.slice(1)}0`), false);
    assert.throws(() => parseReleaseChangeFragment(path, content), /None fragments require a specific reason/);
    assert.equal(parseReleaseChangeFragment(path, content, true).contentHash, hash);
    if (rewrittenHash === undefined) {
      rewrittenHash = hash;
      originalHash = exception.legacyFragment.previousContentHash;
    } else {
      assert.equal(exception.legacyFragment.previousContentHash, rewrittenHash);
      assert.equal(hash, originalHash);
    }
    exception.legacyFragment.contentHash = "modified";
    assert.equal(getHistoricalReleaseFragmentException(commit, paths).legacyFragment.contentHash, hash);
  }
  assert.match(originalHash, /^[a-f0-9]{64}$/);
  assert.match(rewrittenHash, /^[a-f0-9]{64}$/);
  assert.equal(matchesHistoricalLegacyFragment(undefined, undefined, undefined), false);
});

test("binds exception and parser source changes into the release certificate input hash", () => {
  const fixture = createReleaseFlowFixture();
  try {
    for (const path of ["scripts/release-historical-fragment-exceptions.js", "scripts/release-fragment-parser.js"]) {
      write(fixture.repoRoot, path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
      assert.ok(releaseInputPaths(fixture.repoRoot).includes(path));
      const before = computeReleaseInputHash(fixture.repoRoot);
      write(fixture.repoRoot, path, "export const changedReleasePolicy = true;\n");
      assert.notEqual(computeReleaseInputHash(fixture.repoRoot), before);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("maps the reviewed code-index fragment to coding-agent only for its exact committed bytes", () => {
  const aliased = scopes.filter(({ fragments }) =>
    fragments.some(({ content }) => JSON.parse(content).packages.includes("code-index")),
  );
  assert.equal(aliased.length, 1);
  const [{ commit, paths, fragments }] = aliased;
  const { path, content } = fragments[0];
  const hash = createHash("sha256").update(content.trim()).digest("hex");
  const aliases = { "code-index": "coding-agent" };
  const exception = getHistoricalReleaseFragmentException(commit, paths);
  assert.deepEqual(exception.aliasedFragment, { path, contentHash: hash, packageAliases: aliases });
  exception.aliasedFragment.packageAliases["code-index"] = "tui";
  assert.deepEqual(getHistoricalReleaseFragmentException(commit, paths).aliasedFragment.packageAliases, aliases);
  assert.throws(() => parseReleaseChangeFragment(path, content), /unknown changelog package/);
  assert.deepEqual(parseReleaseChangeFragment(path, content, false, aliases).packages, ["agent", "ai", "coding-agent"]);
  assert.throws(() => parseReleaseChangeFragment(path, content, false, { "code-index": "site" }), /unknown changelog package/);
  const nested = content.replace('"code-index"', '["code-index"]');
  assert.throws(() => parseReleaseChangeFragment(path, nested, false, aliases), /unknown changelog package/);
  assert.deepEqual(getHistoricalFragmentPackageAliases(path, hash), aliases);
  assert.equal(getHistoricalFragmentPackageAliases(`${path}.copy`, hash), undefined);
  assert.equal(getHistoricalFragmentPackageAliases(path, `${hash.slice(1)}0`), undefined);
  getHistoricalFragmentPackageAliases(path, hash)["code-index"] = "tui";
  assert.deepEqual(getHistoricalFragmentPackageAliases(path, hash), aliases);

  const fixture = createReleaseFlowFixture();
  try {
    write(fixture.repoRoot, path, content);
    const current = getCurrentChangeFragments(fixture.repoRoot).find((fragment) => fragment.path === path);
    assert.deepEqual(current.packages, ["agent", "ai", "coding-agent"]);
    assert.equal(current.contentHash, hash);
    write(fixture.repoRoot, path, content.replace("4.1.11", "4.1.12"));
    assert.throws(() => getCurrentChangeFragments(fixture.repoRoot), /unknown changelog package/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
