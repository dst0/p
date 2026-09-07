import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const releaseScript = resolve("scripts/local-release.js");
const legacyBinary = "#!/bin/sh\n# upstream executable\nprintf '0.4.224\\n'\n";
const canonicalBinary = "#!/bin/sh\n# existing canonical executable\nprintf '0.4.224\\n'\n";
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
const binaryBuilder = `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const platform = args[args.indexOf("--platform") + 1];
const output = args[args.indexOf("--out") + 1];
mkdirSync(join(output, platform), { recursive: true });
writeFileSync(join(output, platform, "pi"), ${JSON.stringify(legacyBinary)}, { mode: 0o700 });
if (process.env.P_LOCAL_RELEASE_CANONICAL_BINARY === "1") {
  writeFileSync(join(output, platform, "p"), ${JSON.stringify(canonicalBinary)}, { mode: 0o700 });
}
writeFileSync(join(output, platform, "package.json"), JSON.stringify({ name: "@dst0/p", version: "0.4.224" }));
writeFileSync(join(output, "pi-" + platform + ".tar.gz"), "fixture archive");
`;

for (const hasCanonicalBinary of [false, true]) {
  test(
    `local release exposes the advertised p entrypoint with canonical binary present: ${hasCanonicalBinary}`,
    {
      skip: process.platform === "win32" ? "The local binary builder requires a POSIX shell" : false,
    },
    () => {
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
        const result = spawnSync(
          process.execPath,
          [releaseScript, "--skip-check", "--skip-bun-install", "--out", outputDirectory],
          {
            cwd: repoRoot,
            env: {
              ...process.env,
              PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
              P_LOCAL_RELEASE_CANONICAL_BINARY: hasCanonicalBinary ? "1" : "0",
            },
            encoding: "utf8",
            timeout: 60_000,
          },
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        const advertisedBinary = join(outputDirectory, "bun", "p");
        assert.ok(result.stdout.includes(`${advertisedBinary} --help`));
        assert.equal(
          existsSync(advertisedBinary),
          true,
          "The advertised p path must exist, not only the upstream pi binary",
        );
        assert.equal(readFileSync(advertisedBinary, "utf8"), hasCanonicalBinary ? canonicalBinary : legacyBinary);
        assert.equal(readFileSync(join(outputDirectory, "bun", "pi"), "utf8"), legacyBinary);
        assert.equal(
          readFileSync(join(outputDirectory, `pi-${process.platform}-${process.arch}.tar.gz`), "utf8"),
          "fixture archive",
        );
        const version = spawnSync(advertisedBinary, ["--version"], {
          cwd: fixtureRoot,
          encoding: "utf8",
          timeout: 60_000,
        });
        assert.equal(version.status, 0, version.stderr);
        assert.equal(version.stdout.trim(), "0.4.224");
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );
}
