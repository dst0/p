import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const releaseScript = resolve("scripts/local-release.js");
const packages = [
  ["ai", "@dst0/p-ai"],
  ["tui", "@dst0/p-tui"],
  ["agent", "@dst0/p-agent-core"],
  ["code-index", "@dst0/p-code-index"],
  ["coding-agent", "@dst0/p"],
];
const npmStub = `import { appendFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.P_PACK_COMMAND_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
if (args[0] === "run" && ["clean", "build"].includes(args[1])) process.exit(0);
if (args[0] !== "pack") throw new Error("Unexpected npm command");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const filename = manifest.name.replace(/^@/, "").replaceAll("/", "-") + "-" + manifest.version + ".tgz";
const packed = { name: manifest.name, version: manifest.version, filename, files: [{ path: "npm-shrinkwrap.json" }] };
const destination = args[args.indexOf("--pack-destination") + 1];
const archiveKind = process.env.P_PACK_ARCHIVE_KIND;
const archivePath = join(destination, filename);
if (archiveKind === "file") writeFileSync(archivePath, "fixture tarball");
if (archiveKind === "directory") mkdirSync(archivePath);
if (archiveKind === "symlink") {
  writeFileSync(join(destination, "link-target"), "fixture tarball");
  symlinkSync("link-target", archivePath);
}
const result = process.env.P_PACK_OUTPUT_FORMAT === "keyed" ? { [manifest.name]: packed } : [packed];
console.log(JSON.stringify(result));
`;

for (const [format, archiveKind] of [
  ["array", "file"],
  ["keyed", "file"],
  ["keyed", "missing"],
  ["keyed", "directory"],
  ["keyed", "symlink"],
]) {
  test(
    `local release validates ${format} npm output with a ${archiveKind} archive`,
    {
      skip:
        process.platform === "win32" && archiveKind === "symlink"
          ? "Windows symlink fixtures require extra privilege"
          : false,
    },
    () => {
      const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "p-local-release-pack-")));
      const repoRoot = join(fixtureRoot, "repo");
      const binDirectory = join(fixtureRoot, "bin");
      const outputDirectory = join(fixtureRoot, "artifacts");
      const commandLog = join(fixtureRoot, "npm-commands.jsonl");
      mkdirSync(repoRoot);
      mkdirSync(binDirectory);
      writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "p-monorepo", version: "0.4.224" }));
      for (const [directory, name] of packages) {
        const packageDirectory = join(repoRoot, "packages", directory);
        mkdirSync(packageDirectory, { recursive: true });
        writeFileSync(
          join(packageDirectory, "package.json"),
          JSON.stringify({
            name,
            version: "0.4.224",
            files: name === "@dst0/p" ? ["npm-shrinkwrap.json"] : [],
          }),
        );
      }
      const stubPath = join(binDirectory, "npm-stub.js");
      writeFileSync(stubPath, npmStub);
      writeFileSync(join(binDirectory, "package.json"), '{"type":"module"}\n');
      if (process.platform === "win32") {
        writeFileSync(join(binDirectory, "npm.cmd"), `@"${process.execPath}" "${stubPath}" %*\r\n`);
      } else {
        writeFileSync(
          join(binDirectory, "npm"),
          `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${stubPath.replaceAll("'", "'\\''")}' "$@"\n`,
          { mode: 0o700 },
        );
      }

      try {
        const result = spawnSync(
          process.execPath,
          [releaseScript, "--skip-check", "--skip-install", "--out", outputDirectory],
          {
            cwd: repoRoot,
            env: {
              ...process.env,
              PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
              P_PACK_COMMAND_LOG: commandLog,
              P_PACK_OUTPUT_FORMAT: format,
              P_PACK_ARCHIVE_KIND: archiveKind,
            },
            encoding: "utf8",
            timeout: 60_000,
          },
        );
        const calls = readFileSync(commandLog, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        if (archiveKind !== "file") {
          assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
          assert.match(result.stderr, /npm pack did not produce a regular archive for @dst0\/p-ai/u);
          assert.equal(calls.filter(({ args }) => args[0] === "pack").length, 1);
          assert.equal(existsSync(join(outputDirectory, "node")), false);
          return;
        }
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.deepEqual(
          calls.filter(({ args }) => args[0] === "pack").map(({ cwd }) => cwd),
          packages.map(([directory]) => join(repoRoot, "packages", directory)),
        );
        for (const [, name] of packages) {
          const filename = `${name.replace(/^@/, "").replaceAll("/", "-")}-0.4.224.tgz`;
          const tarballPath = join(outputDirectory, "tarballs", filename);
          assert.equal(existsSync(tarballPath), true);
          assert.equal(readFileSync(tarballPath, "utf8"), "fixture tarball");
          assert.ok(result.stdout.includes(tarballPath), `Release output omitted ${name}`);
        }
        assert.equal(existsSync(join(outputDirectory, "node")), false, "Packing must not install or publish packages");
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );
}
