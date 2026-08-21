import assert from "node:assert/strict";
import test from "node:test";

import { assertReleaseTargetVersion } from "./release-target-policy.js";

test("shared release target policy rejects stale and unauthorized major targets", () => {
  assert.doesNotThrow(() => assertReleaseTargetVersion("0.4.224", "0.5.0"));
  assert.throws(() => assertReleaseTargetVersion("0.4.224", "0.4.224"), /must be greater/);
  assert.throws(() => assertReleaseTargetVersion("0.4.224", "5.0.1"), /explicit authorization/);
  assert.throws(() => assertReleaseTargetVersion("0.4.224", "0.05.0"), /Invalid release target/);
});

test("shared release target policy accepts an explicitly authorized exact major target", () => {
  assert.doesNotThrow(() =>
    assertReleaseTargetVersion("0.4.224", "5.0.1", { allowMajor: true }),
  );
  assert.throws(
    () => assertReleaseTargetVersion("0.4.224", "6.0.0", { allowMajor: true }),
    /not authorized by repository policy/,
  );
  assert.throws(
    () => assertReleaseTargetVersion("0.4.224", "0.5.0", { allowMajor: true }),
    /cannot be used for a same-major target/,
  );
});
