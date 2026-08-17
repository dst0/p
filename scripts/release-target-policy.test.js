import assert from "node:assert/strict";
import test from "node:test";

import { assertReleaseTargetVersion } from "./release-target-policy.js";

test("shared release target policy rejects stale and major targets", () => {
  assert.doesNotThrow(() => assertReleaseTargetVersion("0.4.224", "0.5.0"));
  assert.throws(() => assertReleaseTargetVersion("0.4.224", "0.4.224"), /must be greater/);
  assert.throws(() => assertReleaseTargetVersion("0.4.224", "1.0.0"), /Major releases/);
  assert.throws(() => assertReleaseTargetVersion("0.4.224", "0.05.0"), /Invalid release target/);
});
