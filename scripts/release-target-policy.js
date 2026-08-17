import { valid } from "semver";

import { compareVersions } from "./release-changelog-audit.js";

export function assertReleaseTargetVersion(currentVersion, targetVersion) {
  if (valid(targetVersion) !== targetVersion) {
    throw new Error(`Invalid release target: ${targetVersion}`);
  }
  if (compareVersions(targetVersion, currentVersion) <= 0) {
    throw new Error(`Release target ${targetVersion} must be greater than current version ${currentVersion}`);
  }
  if (targetVersion.split(".")[0] !== currentVersion.split(".")[0]) {
    throw new Error("Major releases are not permitted by repository policy");
  }
}
