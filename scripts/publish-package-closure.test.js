import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { readWorkspacePackages } from "./release-workspaces.js";

const publishScript = resolve("scripts/publish.js");
const packages = readWorkspacePackages(resolve(".")).filter(({ packageJson }) => !packageJson.private);
const packageNames = new Set(packages.map(({ packageJson }) => packageJson.name));
const npmStub = `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.P_PUBLISH_COMMAND_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
if (args[0] === "view") {
  if (process.env.P_PUBLISH_CASE === "already-published") { console.log(JSON.stringify("5.0.1")); process.exit(0); }
  console.error("E404 fixture version not published"); process.exit(1);
}
if (args[0] === "publish" && ["publish", "invalid"].includes(process.env.P_PUBLISH_CASE)) process.exit(0);
if (args[0] !== "pack" || !args.includes("--dry-run") || !args.includes("--ignore-scripts")) {
  throw new Error("Only dry-run package checks are authorized in this fixture");
}
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const result = { name: manifest.name, version: manifest.version,
  filename: manifest.name.replace(/^@/, "").replaceAll("/", "-") + "-" + manifest.version + ".tgz",
  files: [{ path: "dist/index.js" }, ...(process.env.P_PUBLISH_CASE === "invalid" && manifest.name === "@dst0/p"
    ? [] : [{ path: "npm-shrinkwrap.json" }])], size: 123, unpackedSize: 456 };
console.log(JSON.stringify(process.env.P_PUBLISH_OUTPUT_FORMAT === "keyed" ? { [manifest.name]: result } : [result]));
`;

for (const format of ["array", "keyed"]) {
  for (const operation of ["dry", "publish", "invalid", "already-published"]) {
    test(`${operation} publication validates the full dependency closure with ${format} pack output`, () => {
      const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "p-publish-closure-")));
      const binDirectory = join(fixtureRoot, "bin");
      const commandLog = join(fixtureRoot, "commands.jsonl");
      mkdirSync(binDirectory);
      for (const { path, packageJson } of packages) {
        const packageDirectory = join(fixtureRoot, dirname(path));
        mkdirSync(join(packageDirectory, "dist"), { recursive: true });
        writeFileSync(
          join(packageDirectory, "package.json"),
          JSON.stringify({
            ...packageJson,
            version: "5.0.1",
            dependencies: Object.fromEntries(
              Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => [
                name,
                packageNames.has(name) ? "^5.0.1" : version,
              ]),
            ),
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
        const result = spawnSync(process.execPath, [publishScript, ...(operation === "dry" ? ["--dry-run"] : [])], {
          cwd: fixtureRoot,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            ...process.env,
            PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
            P_PUBLISH_COMMAND_LOG: commandLog,
            P_PUBLISH_OUTPUT_FORMAT: format,
            P_PUBLISH_CASE: operation,
          },
        });
        const calls = readFileSync(commandLog, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(result.status, operation === "invalid" ? 1 : 0, `${result.stdout}\n${result.stderr}`);
        if (operation === "invalid") assert.match(result.stderr, /omitted required npm-shrinkwrap.json for @dst0\/p/u);
        const queriedPackages = calls.filter(({ args }) => args[0] === "view").map(({ args }) => args[1]);
        assert.deepEqual(
          [...queriedPackages].sort(),
          packages.map(({ packageJson }) => `${packageJson.name}@5.0.1`).sort(),
        );
        const packedDirectories = calls.filter(({ args }) => args[0] === "pack").map(({ cwd }) => cwd);
        const publishedDirectories = calls.filter(({ args }) => args[0] === "publish").map(({ cwd }) => cwd);
        const expectedDirectories = packages.map(({ path }) => join(fixtureRoot, dirname(path))).sort();
        assert.deepEqual([...packedDirectories].sort(), operation === "already-published" ? [] : expectedDirectories);
        assert.deepEqual([...publishedDirectories].sort(), operation === "publish" ? expectedDirectories : []);
        if (operation === "publish") {
          for (const { args } of calls.filter(({ args }) => args[0] === "publish")) {
            assert.deepEqual(args, ["publish", "--access", "public", "--provenance", "--ignore-scripts"]);
          }
          assert.ok(
            calls.findLastIndex(({ args }) => args[0] === "pack") <
              calls.findIndex(({ args }) => args[0] === "publish"),
            "Every pending package must pass content validation before any publication",
          );
        }
        for (const { path, packageJson } of packages) {
          for (const dependency of Object.keys(packageJson.dependencies ?? {}).filter((name) =>
            packageNames.has(name),
          )) {
            const dependencyPath = packages.find(({ packageJson: candidate }) => candidate.name === dependency).path;
            for (const orderedDirectories of [packedDirectories, publishedDirectories].filter(
              (directories) => directories.length > 0,
            )) {
              assert.ok(
                orderedDirectories.indexOf(join(fixtureRoot, dirname(dependencyPath))) <
                  orderedDirectories.indexOf(join(fixtureRoot, dirname(path))),
                `${dependency} must precede ${packageJson.name}`,
              );
            }
          }
        }
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
}

test("every public workspace declares exact GitHub repository metadata for trusted publishing", () => {
  for (const { path, packageJson } of packages) {
    assert.deepEqual(
      packageJson.repository,
      {
        type: "git",
        url: "git+https://github.com/dst0/p.git",
        directory: dirname(path).replaceAll("\\", "/"),
      },
      `${packageJson.name} must identify its trusted-publishing repository and workspace`,
    );
  }
});
