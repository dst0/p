import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const releaseScript = resolve("scripts/local-release.js");
const binary = "#!/bin/sh\n# standalone p executable\nprintf '0.4.224\\n'\n";
const npmStub = `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "run" && ["clean", "build"].includes(args[1])) process.exit(0);
if (args[0] === "install" && args.includes("--ignore-scripts")) {
  mkdirSync("node_modules/.bin", { recursive: true });
  writeFileSync("node_modules/.bin/p", "fixture node CLI"); process.exit(0);
}
if (args[0] !== "pack") throw new Error("Unexpected npm command");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const filename = manifest.name.replace(/^@/, "").replaceAll("/", "-") + "-" + manifest.version + ".tgz";
writeFileSync(join(args[args.indexOf("--pack-destination") + 1], filename), "fixture tarball");
console.log(JSON.stringify([{ name: manifest.name, version: manifest.version, filename,
  files: [{ path: "npm-shrinkwrap.json" }] }]));
`;
// Mirrors scripts/build-binaries.sh output: <out>/<platform>/<name> plus <out>/<name>-<platform>.tar.gz.
const binaryBuilder = `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const platform = args[args.indexOf("--platform") + 1];
const output = args[args.indexOf("--out") + 1];
const name = process.env.P_LOCAL_RELEASE_BINARY_NAME;
mkdirSync(join(output, platform), { recursive: true });
writeFileSync(join(output, platform, name), ${JSON.stringify(binary)}, { mode: 0o700 });
writeFileSync(join(output, platform, "package.json"), JSON.stringify({ name: "@dst0/p", version: "0.4.224" }));
writeFileSync(join(output, name + "-" + platform + ".tar.gz"), "fixture archive");
`;
const posixOnly = { skip: process.platform === "win32" ? "The local binary builder requires a POSIX shell" : false };
const platform = `${process.platform}-${process.arch}`;

function runLocalRelease(binaryName, callback) {
  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "p-local-binary-entrypoint-")));
  const repoRoot = join(fixtureRoot, "repo");
  const binDirectory = join(fixtureRoot, "bin");
  const outputDirectory = join(fixtureRoot, "artifacts");
  mkdirSync(join(repoRoot, "scripts"), { recursive: true });
  mkdirSync(binDirectory);
  writeFileSync(join(repoRoot, "package.json"), '{"name":"p-monorepo","version":"0.4.224"}\n');
  for (const [directory, name] of [
    ["ai", "@dst0/p-ai"],
    ["tui", "@dst0/p-tui"],
    ["agent", "@dst0/p-agent-core"],
    ["code-index", "@dst0/p-code-index"],
    ["coding-agent", "@dst0/p"],
  ]) {
    const packageDirectory = join(repoRoot, "packages", directory);
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name, version: "0.4.224" }));
  }
  const stubPath = join(binDirectory, "npm-stub.js");
  const builderPath = join(binDirectory, "binary-builder.js");
  writeFileSync(stubPath, npmStub);
  writeFileSync(builderPath, binaryBuilder);
  writeFileSync(join(binDirectory, "package.json"), '{"type":"module"}\n');
  for (const [path, script] of [
    [join(binDirectory, "npm"), stubPath],
    [join(repoRoot, "scripts", "build-binaries.sh"), builderPath],
  ]) {
    writeFileSync(
      path,
      `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
      { mode: 0o700 },
    );
  }
  writeFileSync(join(binDirectory, "bun"), "#!/bin/sh\n[ \"$1\" = --version ] || exit 9\nprintf '1.3.14\\n'\n", {
    mode: 0o700,
  });
  try {
    const result = spawnSync(process.execPath, [releaseScript, "--skip-check", "--skip-bun-install", "--out", outputDirectory], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
        P_LOCAL_RELEASE_BINARY_NAME: binaryName,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    callback(result, { fixtureRoot, outputDirectory });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("local release ships the p executable and p-<platform> archive from the binary build", posixOnly, () => {
  runLocalRelease("p", (result, { fixtureRoot, outputDirectory }) => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const advertisedBinary = join(outputDirectory, "bun", "p");
    const archive = join(outputDirectory, `p-${platform}.tar.gz`);
    assert.ok(result.stdout.includes(`${advertisedBinary} --help`));
    assert.ok(result.stdout.includes(`\n  ${archive}\n`));
    assert.equal(readFileSync(advertisedBinary, "utf8"), binary);
    assert.equal(readFileSync(archive, "utf8"), "fixture archive");
    assert.equal(existsSync(join(outputDirectory, "bun", "pi")), false);
    assert.equal(existsSync(join(outputDirectory, `pi-${platform}.tar.gz`)), false);
    const version = spawnSync(advertisedBinary, ["--version"], { cwd: fixtureRoot, encoding: "utf8", timeout: 60_000 });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), "0.4.224");
  });
});

test("local release rejects a binary build that still emits upstream pi names", posixOnly, () => {
  runLocalRelease("pi", (result, { outputDirectory }) => {
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, new RegExp(`Binary build did not produce p for ${platform}`));
    assert.equal(existsSync(join(outputDirectory, "bun", "p")), false);
    assert.equal(existsSync(join(outputDirectory, `pi-${platform}.tar.gz`)), false);
  });
});
