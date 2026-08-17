const VERSIONED_DEPENDENCY_SECTIONS = ["dependencies", "devDependencies"];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function workspacePackageNames(workspacePackages) {
  return new Set(workspacePackages.map(({ packageJson }) => packageJson.name));
}

export function versionPackageContent(packageJson, targetVersion, internalPackageNames) {
  const versioned = cloneJson(packageJson);
  versioned.version = targetVersion;
  for (const section of VERSIONED_DEPENDENCY_SECTIONS) {
    for (const dependencyName of Object.keys(versioned[section] ?? {})) {
      if (internalPackageNames.has(dependencyName)) {
        versioned[section][dependencyName] = `^${targetVersion}`;
      }
    }
  }
  return versioned;
}

export function versionLockfileContent(lockfile, targetVersion, internalPackageNames) {
  const versioned = cloneJson(lockfile);
  versioned.version = targetVersion;
  if (versioned.packages?.[""]) {
    versioned.packages[""].version = targetVersion;
  }
  for (const entry of Object.values(versioned.packages ?? {})) {
    if (entry.name && internalPackageNames.has(entry.name)) {
      entry.version = targetVersion;
    }
    for (const section of VERSIONED_DEPENDENCY_SECTIONS) {
      for (const dependencyName of Object.keys(entry[section] ?? {})) {
        if (internalPackageNames.has(dependencyName)) {
          entry[section][dependencyName] = `^${targetVersion}`;
        }
      }
    }
  }
  return versioned;
}
