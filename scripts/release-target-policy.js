import { valid } from "semver";

import { compareVersions } from "./release-changelog-audit.js";

const AUTHORIZED_MAJOR_TARGET = "5.0.1";

export function assertReleaseTargetVersion(currentVersion, targetVersion, options = {}) {
  if (valid(targetVersion) !== targetVersion) {
    throw new Error(`Invalid release target: ${targetVersion}`);
  }
  if (compareVersions(targetVersion, currentVersion) <= 0) {
    throw new Error(`Release target ${targetVersion} must be greater than current version ${currentVersion}`);
  }
  const changesMajor = targetVersion.split(".")[0] !== currentVersion.split(".")[0];
  if (changesMajor && options.allowMajor !== true) {
    throw new Error("Major releases require explicit authorization");
  }
  if (changesMajor && targetVersion !== AUTHORIZED_MAJOR_TARGET) {
    throw new Error(`Major release target ${targetVersion} is not authorized by repository policy`);
  }
  if (!changesMajor && options.allowMajor === true) {
    throw new Error("Major-release authorization cannot be used for a same-major target");
  }
}
