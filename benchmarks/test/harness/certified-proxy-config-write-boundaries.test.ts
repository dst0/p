import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { rewriteCertifiedAgentConfigs } from "../../src/harness/certified-proxy-config.ts";
import { makeDirectories, options, readJsonc, record } from "./certified-proxy-config-fixtures.ts";

function copiedConfigs(dirs: Record<string, string>): string[] {
  return [join(dirs.p, "models.json"), join(dirs.pi, "models.json"), join(dirs.kilo, "config", "kilo", "kilo.jsonc")];
}

test("invalid selected Kilo metadata cannot partially rewrite P and Pi private configs", () => {
  const fixture = makeDirectories();
  try {
    const paths = copiedConfigs(fixture.dirs);
    const kilo = readJsonc(paths[2]!);
    const provider = record(record(kilo.provider)["kilo-provider"]);
    const model = record(record(provider.models)["alias-v2"]);
    record(model.limit).output = -1;
    writeFileSync(paths[2]!, `${JSON.stringify(kilo)}\n`);
    const before = paths.map((path) => readFileSync(path, "utf8"));

    assert.throws(
      () => rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1"),
      /invalid numeric limit/u,
    );
    assert.deepEqual(
      paths.map((path) => readFileSync(path, "utf8")),
      before,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("unsafe proxy endpoints leave all private configurations unchanged", () => {
  for (const endpoint of [
    "https://localhost:43210/v1",
    "http://user:password@localhost:43210/v1",
    "http://localhost:43210/v1?token=hidden",
    "http://localhost:43210/v1#fragment",
    "http://localhost.evil.invalid:43210/v1",
    "not-a-url",
  ]) {
    const fixture = makeDirectories();
    try {
      const paths = copiedConfigs(fixture.dirs);
      const before = paths.map((path) => readFileSync(path, "utf8"));
      assert.throws(
        () => rewriteCertifiedAgentConfigs(options, fixture.dirs, endpoint),
        /local HTTP endpoint|proxy URL is invalid/u,
      );
      assert.deepEqual(
        paths.map((path) => readFileSync(path, "utf8")),
        before,
        endpoint,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("malformed selected model metadata fails before any private configuration rewrite", () => {
  for (const [field, value] of [
    ["reasoning", "yes"],
    ["contextWindow", -1],
    ["input", ["audio"]],
    ["compat", { thinkingFormat: "unknown" }],
  ] as const) {
    const fixture = makeDirectories();
    try {
      const paths = copiedConfigs(fixture.dirs);
      const p = JSON.parse(readFileSync(paths[0]!, "utf8")) as {
        providers: { compiler: { models: Array<Record<string, unknown>> } };
      };
      p.providers.compiler.models[0]![field] = value;
      writeFileSync(paths[0]!, `${JSON.stringify(p)}\n`);
      const before = paths.map((path) => readFileSync(path, "utf8"));
      assert.throws(() => rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1"));
      assert.deepEqual(
        paths.map((path) => readFileSync(path, "utf8")),
        before,
        field,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
