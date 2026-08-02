const IGNORED_WATCH_PATH_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".p",
  ".svn",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "storage",
  "target",
]);

const reStr = `(?:^|[\\\\/])(?:${[...IGNORED_WATCH_PATH_SEGMENTS].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")).join("|")})(?:[\\\\/]|$)`;
console.log(reStr);
const re = new RegExp(reStr);

console.log("foo/node_modules/bar ->", re.test("foo/node_modules/bar"));
console.log(".git ->", re.test(".git"));
console.log("foo/.git/config ->", re.test("foo/.git/config"));
