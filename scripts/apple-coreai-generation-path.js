import fs from "node:fs";
import path from "node:path";

export const CANONICAL_COREAI_ARTIFACT_VERSION = "qwen3-embedding-0.6b-ane-b1-s64-v1";
export const COREAI_ROOT_TRAILING_COMPONENTS = Object.freeze(["indexing-service", "apple-coreai"]);

export function validateArtifactRoot(artifactRoot) {
  if (typeof artifactRoot !== "string" || !artifactRoot.trim()) {
    throw new Error("artifactRoot must be a non-empty string");
  }
  if (!path.isAbsolute(artifactRoot)) {
    throw new Error(`artifactRoot must be an absolute path: "${artifactRoot}"`);
  }
  if (path.normalize(artifactRoot) !== artifactRoot || (artifactRoot.length > 1 && artifactRoot.endsWith(path.sep))) {
    throw new Error(`artifactRoot must be normalized: "${artifactRoot}"`);
  }

  const parsed = path.parse(artifactRoot);
  if (parsed.root === artifactRoot) {
    throw new Error(`artifactRoot cannot be filesystem root: "${artifactRoot}"`);
  }

  const segments = artifactRoot.split(path.sep).filter(Boolean);
  if (
    segments.length <= COREAI_ROOT_TRAILING_COMPONENTS.length ||
    segments[segments.length - 2] !== COREAI_ROOT_TRAILING_COMPONENTS[0] ||
    segments[segments.length - 1] !== COREAI_ROOT_TRAILING_COMPONENTS[1]
  ) {
    throw new Error(
      `artifactRoot must end with exact trailing components "${COREAI_ROOT_TRAILING_COMPONENTS.join("/")}": "${artifactRoot}"`,
    );
  }

  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        break;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`Path component must not be a symbolic link: "${current}"`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Path component must be a directory: "${current}"`);
    }
  }

  return artifactRoot;
}

export function validateGenerationPath(artifactRoot, generation, expectedVersion = CANONICAL_COREAI_ARTIFACT_VERSION) {
  validateArtifactRoot(artifactRoot);

  if (typeof generation !== "string" || !generation) {
    throw new Error("Generation must be a non-empty string");
  }
  if (generation.includes("/") || generation.includes("\\") || generation.includes("..")) {
    throw new Error(`Generation name cannot contain path separators or traversal: "${generation}"`);
  }

  const prefix = `${expectedVersion}-`;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!generation.startsWith(prefix) || !uuidRegex.test(generation.slice(prefix.length))) {
    throw new Error(`Invalid generation format: "${generation}"`);
  }

  const targetDir = path.join(artifactRoot, generation);
  if (path.dirname(path.resolve(targetDir)) !== path.resolve(artifactRoot)) {
    throw new Error(`Target generation is not a direct child of artifactRoot: ${generation}`);
  }
  return targetDir;
}
