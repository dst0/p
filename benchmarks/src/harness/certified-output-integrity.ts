import { lstatSync, realpathSync, type Stats } from "node:fs";
import { dirname, parse, relative, resolve, sep } from "node:path";

interface PathIdentity {
  path: string;
  dev: number;
  ino: number;
  uid: number;
}

interface OutputBinding {
  root: string;
  declaredRoot: string;
  ownerUid: number;
  ancestors: PathIdentity[];
}

const bindings = new Map<string, OutputBinding>();

export function bindCertifiedOutputRoot(output: string): void {
  const declaredRoot = resolve(output);
  const root = realpathSync(declaredRoot);
  const ancestors: PathIdentity[] = [];
  let current = root;
  while (true) {
    ancestors.push(readDirectoryIdentity(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const ownerUid = ancestors[0]!.uid;
  const processUid = process.getuid?.();
  if (processUid !== undefined && ownerUid !== processUid) {
    throw new Error("Certified output root must be owned by the benchmark user");
  }
  bindings.set(declaredRoot, { root, declaredRoot, ownerUid, ancestors });
}

export function assertCertifiedOutputWritePath(path: string, requireBinding = false): void {
  const target = resolve(path);
  const binding = findBinding(target);
  if (!binding) {
    if (requireBinding) throw new Error("Certified output path has no bound root identity");
    return;
  }
  for (const expected of binding.ancestors) {
    const current = readDirectoryIdentity(expected.path);
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.uid !== expected.uid) {
      throw new Error(`Certified output ancestor identity changed: ${expected.path}`);
    }
  }
  if (target === binding.root || target === binding.declaredRoot) return;
  verifyExistingComponents(binding, target);
}

function findBinding(target: string): OutputBinding | undefined {
  return [...bindings.values()]
    .filter(
      (binding) =>
        target === binding.declaredRoot ||
        target.startsWith(`${binding.declaredRoot}${sep}`) ||
        target === binding.root ||
        target.startsWith(`${binding.root}${sep}`),
    )
    .sort((left, right) => right.root.length - left.root.length)[0];
}

function readDirectoryIdentity(path: string): PathIdentity {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Certified output identity path is not a real directory: ${path}`);
  }
  return { path, dev: stat.dev, ino: stat.ino, uid: stat.uid };
}

function verifyExistingComponents(binding: OutputBinding, target: string): void {
  const targetParent = dirname(target);
  const base =
    target === binding.root || target.startsWith(`${binding.root}${sep}`) ? binding.root : binding.declaredRoot;
  const relativeParent = relative(base, targetParent);
  if (relativeParent.startsWith("..") || parse(relativeParent).root) {
    throw new Error("Certified output write escapes its bound root");
  }
  let current = base;
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== binding.ownerUid) {
      throw new Error(`Certified output write encountered an unsafe directory: ${current}`);
    }
  }
  try {
    const stat = lstatSync(target);
    const safeDirectory = stat.isDirectory() && stat.uid === binding.ownerUid;
    const safeFile = stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === binding.ownerUid;
    if (!safeDirectory && !safeFile) throw new Error(`Certified output has an unsafe target: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
