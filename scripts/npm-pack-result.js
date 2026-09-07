export function readNpmPackResult(output, expectedPackage) {
  const { name, version } = expectedPackage;
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`npm pack returned invalid JSON for ${name}`);
  }

  let packed;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error(`npm pack must return exactly one result for ${name}`);
    [packed] = parsed;
  } else {
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Object.keys(parsed).length !== 1 ||
      !Object.hasOwn(parsed, name)
    ) {
      throw new Error(`npm pack must return exactly the requested package ${name}`);
    }
    packed = parsed[name];
  }

  if (
    packed === null ||
    typeof packed !== "object" ||
    Array.isArray(packed) ||
    packed.name !== name ||
    packed.version !== version
  ) {
    throw new Error(`npm pack returned a mismatched package identity for ${name}@${version}`);
  }
  const expectedFilename = `${name.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;
  if (packed.filename !== expectedFilename) {
    throw new Error(`npm pack returned an unexpected archive filename for ${name}@${version}`);
  }
  if (
    Array.isArray(expectedPackage.files) &&
    expectedPackage.files.includes("npm-shrinkwrap.json") &&
    (!Array.isArray(packed.files) || !packed.files.some((file) => file?.path === "npm-shrinkwrap.json"))
  ) {
    throw new Error(`npm pack omitted required npm-shrinkwrap.json for ${name}; use the pinned CI npm toolchain`);
  }
  return packed;
}
