import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const workflowsDirectory = resolve(".github/workflows");
const workflows = readdirSync(workflowsDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => ({ name, content: readFileSync(join(workflowsDirectory, name), "utf8") }));

function actionReferences(content) {
  return [...content.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)].map(([, reference, rest]) => ({
    reference,
    comment: rest.trim(),
  }));
}

test("pins every third-party workflow action to a full commit SHA with its version tag", () => {
  const references = workflows.flatMap(({ name, content }) =>
    actionReferences(content).map((entry) => ({ name, ...entry })),
  );
  assert.ok(references.some(({ reference }) => reference.startsWith("cloudflare/")));
  for (const { name, reference, comment } of references) {
    if (reference.startsWith("./") || /^(?:actions|github)\//.test(reference)) {
      continue;
    }
    assert.match(reference, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `${name}: ${reference} must pin a full commit SHA`);
    assert.match(comment, /^# v\d+\.\d+\.\d+$/, `${name}: ${reference} must name its pinned release tag`);
  }
});

test("deploys Pages with the supported Wrangler action and the exact Wrangler from its own lockfile", () => {
  const deploy = workflows.find(({ name }) => name === "deploy-pages.yml")?.content ?? "";
  assert.doesNotMatch(deploy, /uses:\s*cloudflare\/pages-action/, "cloudflare/pages-action was removed upstream");
  const install = deploy.indexOf("- name: Install pinned Wrangler");
  const step = deploy.slice(deploy.indexOf("- name: Deploy to Cloudflare Pages"));
  assert.ok(install !== -1 && install < deploy.indexOf("- name: Deploy to Cloudflare Pages"));
  assert.match(deploy.slice(install), /^\s+working-directory: \.github\/pages-deploy\n\s+run: npm ci --ignore-scripts$/m);
  assert.match(step, /uses: cloudflare\/wrangler-action@[a-f0-9]{40} # v\d+\.\d+\.\d+/);
  assert.match(step, /^\s+env:\n(?:\s+#.*\n)?\s+npm_config_ignore_scripts: "true"$/m);
  assert.match(step, /^\s+workingDirectory: \.github\/pages-deploy$/m);
  assert.match(step, /^\s+command: pages deploy \.\.\/\.\.\/packages\/site\/dist --project-name=p-agent /m);
  for (const secret of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    assert.match(step, new RegExp(`\\$\\{\\{ secrets\\.${secret} \\}\\}`));
  }
  // The action only skips its own `npm i` when the installed Wrangler equals wranglerVersion.
  const wranglerVersion = /^\s+wranglerVersion: "(\d+\.\d+\.\d+)"$/m.exec(step)?.[1];
  const tool = JSON.parse(readFileSync(resolve(".github/pages-deploy/package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(resolve(".github/pages-deploy/package-lock.json"), "utf8"));
  assert.equal(tool.dependencies.wrangler, wranglerVersion);
  assert.equal(lock.packages["node_modules/wrangler"].version, wranglerVersion);
  assert.equal(lock.packages[""].dependencies.wrangler, wranglerVersion);
});
