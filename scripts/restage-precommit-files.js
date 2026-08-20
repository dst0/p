import { execFileSync } from "node:child_process";

const root = process.cwd();
const stagedFiles = listChangedPaths(["diff", "--cached", "--name-only", "-z"]);

if (process.argv[2] === "--assert-clean") {
  const unstagedFiles = new Set(listChangedPaths(["diff", "--name-only", "-z"]));
  const partiallyStagedCount = stagedFiles.filter((path) => unstagedFiles.has(path)).length;
  if (partiallyStagedCount > 0) {
    console.error(
      `Pre-commit cannot safely format ${partiallyStagedCount} partially staged path(s). Stage or revert their unstaged changes first.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

const filesToRestage = listChangedPaths([
  "diff",
  "--cached",
  "--diff-filter=d",
  "--name-only",
  "-z",
]);
for (let index = 0; index < filesToRestage.length; index += 100) {
  execFileSync(
    "git",
    ["--literal-pathspecs", "add", "-f", "-A", "--", ...filesToRestage.slice(index, index + 100)],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}

function listChangedPaths(args) {
  return execFileSync("git", args, { cwd: root }).toString("utf8").split("\0").filter(Boolean);
}
