import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(".github/workflows/build-binaries.yml"), "utf8");

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName === undefined ? workflow.length : workflow.indexOf(`\n  ${nextName}:`, start);
  assert.notEqual(start, -1, `${name} job must exist`);
  assert.notEqual(end, -1, `${nextName} job must follow ${name}`);
  return workflow.slice(start, end);
}

function assertImmediatelyPrecedes(jobText, firstStep, secondStep) {
  const first = jobText.indexOf(`name: ${firstStep}`);
  const next = jobText.indexOf("\n      - name:", first + firstStep.length);
  assert.notEqual(first, -1, `${firstStep} step must exist`);
  assert.notEqual(next, -1, `${secondStep} step must follow ${firstStep}`);
  assert.ok(jobText.slice(next).startsWith(`\n      - name: ${secondStep}`));
}

test("validate pins the exact remote lightweight release tag commit", () => {
  const validate = job("validate", "build");
  assert.match(validate, /outputs:\n\s+release_sha: \$\{\{ steps\.pin_release\.outputs\.release_sha \}\}/);
  assert.match(validate, /id: pin_release/);
  assert.match(validate, /ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(validate, /git ls-remote --refs origin "\$\{tag_ref\}"/);
  assert.match(validate, /git cat-file -t "\$\{remote_sha\}"/);
  assert.match(validate, /"\$\{remote_sha\}" != "\$\{checkout_sha\}"/);
  assert.match(validate, /release_sha=\$\{remote_sha\}/);
  assert.ok(validate.indexOf("git cat-file -t") < validate.indexOf("release_sha=${remote_sha}"));
});

test("downstream release jobs checkout only the validated SHA", () => {
  const build = job("build", "publish-npm");
  const publish = job("publish-npm");
  const shaCheckout = /ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/g;

  assert.doesNotMatch(workflow, /source_ref|SOURCE_REF/);
  assert.equal(workflow.match(/ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/g)?.length, 1);
  assert.equal(workflow.match(shaCheckout)?.length, 2);
  assert.match(build, /needs: validate/);
  assert.match(publish, /needs: \[validate, build\]/);
  assert.match(build, shaCheckout);
  assert.match(publish, shaCheckout);
  assert.doesNotMatch(build, /ref: refs\/tags\/|ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.doesNotMatch(publish, /ref: refs\/tags\/|ref: \$\{\{ env\.RELEASE_TAG \}\}/);
});

test("downstream jobs fail closed if the remote tag moves before side effects", () => {
  const build = job("build", "publish-npm");
  const publish = job("publish-npm");

  for (const downstream of [build, publish]) {
    assert.match(downstream, /name: Re-check pinned release tag/);
    assert.match(downstream, /git ls-remote --refs origin "\$\{tag_ref\}"/);
    assert.match(downstream, /"\$\{remote_sha\}" != "\$\{RELEASE_SHA\}"/);
  }

  assertImmediatelyPrecedes(
    build,
    "Re-check pinned release tag",
    "Create GitHub Release and upload binaries",
  );
  assertImmediatelyPrecedes(publish, "Re-check pinned release tag", "Publish npm packages");
});

test("binary build verifies standalone package metadata before release upload", () => {
  const build = job("build", "publish-npm");
  assertImmediatelyPrecedes(build, "Build binaries", "Verify standalone package metadata");

  const verificationStart = build.indexOf("name: Verify standalone package metadata");
  const verificationEnd = build.indexOf("\n      - name:", verificationStart);
  assert.notEqual(verificationEnd, -1, "another step must follow standalone verification");
  const verification = build.slice(verificationStart, verificationEnd);
  assert.match(verification, /working-directory: packages\/coding-agent/);
  assert.match(verification, /bun --version/);
  assert.match(
    verification,
    /node \.\.\/\.\.\/node_modules\/vitest\/dist\/cli\.js --run test\/standalone-package-version\.test\.ts/,
  );
  assert.ok(verification.indexOf("bun --version") < verification.indexOf("node ../../node_modules"));
  assert.ok(verificationStart < build.indexOf("name: Create GitHub Release and upload binaries"));
});
