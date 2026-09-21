import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(".github/workflows/build-binaries.yml"), "utf8");
const binaryBuildScript = readFileSync(resolve("scripts/build-binaries.sh"), "utf8");

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

test("validate installs locked dependencies before verifying the release certificate", () => {
  const validate = job("validate", "build");
  const install = validate.indexOf("name: Install dependencies");
  const verify = validate.indexOf("name: Verify release certificate");
  assert.notEqual(install, -1, "dependency installation must exist");
  assert.notEqual(verify, -1, "release certificate verification must exist");
  assert.ok(install < verify, "certificate verification imports locked dependencies");
  assert.match(validate.slice(install, verify), /run: npm ci --ignore-scripts/);
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

test("binary build hydrates native bindings without npm workspace graph resolution", () => {
  assert.match(
    binaryBuildScript,
    /npm pack --ignore-scripts --silent --pack-destination/,
  );
  assert.match(binaryBuildScript, /tar -xzf .*--strip-components=1/);
  assert.doesNotMatch(binaryBuildScript, /npm install --include=optional/);
});

test("macOS binary builds receive a runnable ad-hoc signature", () => {
  const signStart = binaryBuildScript.indexOf('if [[ "$platform" == darwin-*');
  assert.notEqual(signStart, -1, "Darwin signing guard must exist");
  const signBlock = binaryBuildScript.slice(signStart, binaryBuildScript.indexOf("\n    fi\n", signStart) + 8);
  assert.match(signBlock, /uname -s/);
  assert.match(signBlock, /command -v codesign/);
  assert.match(signBlock, /codesign --force --sign -/);
  assert.match(signBlock, /codesign --verify --strict/);
  assert.ok(signStart > binaryBuildScript.indexOf("bun build --compile"));
});

test("validation skips optional local LLM tests only when Ollama is unavailable", () => {
  const validate = job("validate", "build");
  const testStart = validate.indexOf("name: Test all, including configured live tests");
  assert.notEqual(testStart, -1, "full test step must exist");
  const testEnd = validate.indexOf("\n      - name:", testStart + 1);
  const testStep = validate.slice(testStart, testEnd === -1 ? validate.length : testEnd);
  assert.match(testStep, /curl --fail --silent --show-error --max-time 2 http:\/\/127\.0\.0\.1:11434\/api\/tags/);
  assert.match(testStep, /npm test/);
  assert.match(testStep, /P_NO_LOCAL_LLM=1 npm test/);
  assert.ok(testStep.indexOf("npm test") < testStep.indexOf("P_NO_LOCAL_LLM=1 npm test"));
});

test("npm publish tests use the same optional local LLM gate", () => {
  const publish = job("publish-npm");
  const testStart = publish.indexOf("name: Test");
  assert.notEqual(testStart, -1, "publish test step must exist");
  const testEnd = publish.indexOf("\n      - name:", testStart + 1);
  const testStep = publish.slice(testStart, testEnd === -1 ? publish.length : testEnd);
  assert.match(testStep, /curl --fail --silent --show-error --max-time 2 http:\/\/127\.0\.0\.1:11434\/api\/tags/);
  assert.match(testStep, /npm test/);
  assert.match(testStep, /P_NO_LOCAL_LLM=1 npm test/);
  assert.ok(testStep.indexOf("npm test") < testStep.indexOf("P_NO_LOCAL_LLM=1 npm test"));
});

test("release jobs install the pinned Python test dependency before tests", () => {
  for (const [name, nextName] of [
    ["validate", "build"],
    ["publish-npm", undefined],
  ]) {
    const releaseJob = job(name, nextName);
    const installStart = releaseJob.indexOf("name: Install Python test dependencies");
    const testStart = releaseJob.indexOf("name: Test");
    assert.notEqual(installStart, -1, `${name} must install Python test dependencies`);
    assert.notEqual(testStart, -1, `${name} test step must exist`);
    assert.ok(installStart < testStart, `${name} must install Python dependencies before tests`);
    const installEnd = releaseJob.indexOf("\n      - name:", installStart + 1);
    const installStep = releaseJob.slice(installStart, installEnd === -1 ? releaseJob.length : installEnd);
    assert.match(
      installStep,
      /python3 -m pip install --user --break-system-packages --disable-pip-version-check --no-cache-dir ['\"]?numpy==2\.5\.1['\"]?/,
    );
  }
});
