import assert from "node:assert/strict";
import test from "node:test";

import {
  AMD_PHOENIX_IRON_MANIFEST,
  buildAmdPhoenixIronConfig,
  buildAmdPhoenixIronEnvironment,
  resolveAmdPhoenixIronPlatform,
} from "./install-amd-phoenix-iron.js";

test("pins the Phoenix MLIR-AIE and Peano toolchain", () => {
  assert.deepEqual(
    {
      commit: AMD_PHOENIX_IRON_MANIFEST.mlirAieCommit,
      generation: AMD_PHOENIX_IRON_MANIFEST.deviceGeneration,
      mlirAie: AMD_PHOENIX_IRON_MANIFEST.mlirAieVersion,
      peano: AMD_PHOENIX_IRON_MANIFEST.peanoVersion,
    },
    {
      commit: "db06374df9bf83d9fc557001ca213368aed15788",
      generation: "npu1",
      mlirAie: "1.4.0",
      peano: "21.0.0.2026072001+ce8c0f8f",
    },
  );
  assert.deepEqual(AMD_PHOENIX_IRON_MANIFEST.systemPackages, {
    "amdxdna-dkms": "7.0.0-rc1+git20260310.6b13cb8f4-noble1",
    "libxrt-dev": "1:2.21.75-1~noble1",
    "libxrt-npu2": "1:2.21.75-1~noble1",
    "libxrt-utils": "1:2.21.75-1~noble1",
    "libxrt-utils-npu": "1:2.21.75-1~noble1",
    "libxrt2": "1:2.21.75-1~noble1",
  });
});

test("accepts Phoenix and requires the official Ubuntu and kernel baseline", () => {
  const plan = resolveAmdPhoenixIronPlatform({
    architecture: "x64",
    kernelRelease: "7.0.0-28-generic",
    osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
    pciDevices: [{ device: "0x1502", revision: "0x00", vendor: "0x1022" }],
    platform: "linux",
  });
  assert.equal(plan.backendId, "amd-phoenix-npu");
  assert.equal(plan.deviceGeneration, "npu1");
  assert.equal(plan.requiresKernelUpgrade, false);
  assert.equal(
    resolveAmdPhoenixIronPlatform({
      architecture: "x64",
      kernelRelease: "6.16.9",
      osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
      pciDevices: [{ device: "0x1502", revision: "0x00", vendor: "0x1022" }],
      platform: "linux",
    }).requiresKernelUpgrade,
    true,
  );
});

test("keeps Phoenix runtime paths in managed config and service environment", () => {
  const agent = "/home/test/.p/agent";
  const venv = `${agent}/indexing-service/venv`;
  assert.deepEqual(buildAmdPhoenixIronConfig(agent), {
    amdIronArtifactDirectory: `${agent}/indexing-service/amd-phoenix-iron/artifacts`,
    amdIronCacheDirectory: `${agent}/indexing-service/amd-phoenix-iron/cache`,
    amdIronSourceDirectory: `${agent}/indexing-service/amd-phoenix-iron/mlir-aie`,
    amdNpuGeneration: "npu1",
    amdNpuRuntimeVersion: "1.4.0",
  });
  assert.deepEqual(buildAmdPhoenixIronEnvironment(venv, {}), {
    LD_LIBRARY_PATH: "/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu",
    NPU_CACHE_HOME: `${agent}/indexing-service/amd-phoenix-iron/cache`,
    PEANO_INSTALL_DIR: `${venv}/lib/python3.12/site-packages/llvm-aie`,
    PYTHONPATH: "/usr/lib/python3/dist-packages",
  });
});
