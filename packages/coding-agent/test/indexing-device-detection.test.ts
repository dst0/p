import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const selectionScript = path.join(repositoryRoot, "scripts", "indexing-device-selection.sh");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("indexing device detection", () => {
  it("preserves configured Linux NPU selections", () => {
    const agentDir = path.join(createFixture(), "agent");
    for (const device of ["amd-phoenix-npu", "amd-ryzenai-npu", "intel-openvino-npu", "ryzenai"]) {
      writeConfig(agentDir, { embeddingDevice: device });
      const selected = runDeviceSelection(agentDir);
      expect(selected.status, selected.stderr).toBe(0);
      expect(selected.stdout).toContain(`device=${device}`);
    }
  });

  it("loads device and batch size from code-rag.json", () => {
    const agentDir = path.join(createFixture(), "agent");
    writeConfig(agentDir, { embeddingDevice: "cpu", maxEmbeddingBatchSize: 32 });

    const selected = runDeviceSelection(agentDir);
    expect(selected.status, selected.stderr).toBe(0);
    expect(selected.stdout).toContain("Loaded configured embedding device: cpu");
    expect(selected.stdout).toContain("device=cpu");

    const batch = runBatchSizeSelection(agentDir);
    expect(batch.status, batch.stderr).toBe(0);
    expect(batch.stdout).toContain("batch_size=32");
  });

  it("rejects invalid config and requires a terminal for reselection", () => {
    const agentDir = path.join(createFixture(), "agent");
    writeConfig(agentDir, { embeddingDevice: "invalid", maxEmbeddingBatchSize: "invalid" });

    const selected = runDeviceSelection(agentDir);
    expect(selected.status).toBe(1);
    expect(selected.stderr).toContain("Invalid embeddingDevice in code-rag.json");
    const batch = runBatchSizeSelection(agentDir);
    expect(batch.status).toBe(1);
    expect(batch.stderr).toContain("Invalid maxEmbeddingBatchSize in code-rag.json");

    const forced = runDeviceSelection(agentDir, true, false);
    expect(forced.status).toBe(1);
    expect(forced.stderr).toContain("--select-indexing requires an interactive terminal");
  });

  it("detects only host-supported accelerator choices", () => {
    const root = createFixture();
    createPciDevice(root, "0000:66:00.1", "0x1022", "0x17f0", "0x10");
    createPciDevice(root, "0000:00:0b.0", "0x8086", "0x7d1d", "0x01");
    fs.mkdirSync(path.join(root, "dev"), { recursive: true });
    fs.writeFileSync(path.join(root, "dev", "kfd"), "");
    fs.writeFileSync(path.join(root, "os-release"), 'ID=ubuntu\nVERSION_ID="24.04"\n');

    const detected = runDeviceDetection(root);

    expect(detected.status, detected.stderr).toBe(0);
    expect(detected.stdout).toContain("amd_npu=true");
    expect(detected.stdout).toContain("intel_npu=true");
    expect(detected.stdout).toContain("amd_gpu=true");
    expect(detected.stdout).toContain("nvidia_gpu=false");
    expect(detected.stdout).toContain("generic_npu=false");
    expect(detected.stdout).toContain("Both AMD and Intel NPUs were detected");
  });

  it("detects Phoenix and exposes its automatic IRON path", () => {
    const root = createFixture();
    createPciDevice(root, "0000:66:00.1", "0x1022", "0x1502", "0x00");
    fs.mkdirSync(path.join(root, "dev"), { recursive: true });
    fs.writeFileSync(path.join(root, "os-release"), 'ID=ubuntu\nVERSION_ID="24.04"\n');

    const detected = runDeviceDetection(root);

    expect(detected.status, detected.stderr).toBe(0);
    expect(detected.stdout).toContain("amd_npu=true");
    expect(detected.stdout).toContain("amd_npu_family=phoenix");
    expect(detected.stdout).toContain("generic_npu=true");
  });

  it("detects Core AI and the Apple Neural Engine independently from GPU (MPS)", () => {
    const root = createFixture();

    const detected = runDeviceDetection(root, "Darwin", "arm64", "27.0");

    expect(detected.status, detected.stderr).toBe(0);
    expect(detected.stdout).toContain("mps=true");
    expect(detected.stdout).toContain("apple_ane=true");
    expect(detected.stdout).toContain("coreai=true");
    expect(detected.stdout).toContain("generic_npu=true");

    const legacy = runDeviceDetection(root, "Darwin", "arm64", "26.0");
    expect(legacy.stdout).toContain("apple_ane=true");
    expect(legacy.stdout).toContain("coreai=false");
    expect(legacy.stdout).toContain("generic_npu=true");
  });
});

function runDeviceSelection(agentDir: string, force = false, interactive = false) {
  return spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; AGENT_DIR="$P_CODING_AGENT_DIR"; initialize_indexing_device_selection "$2" "$3"; if declare -p INDEXING_DEVICE >/dev/null 2>&1; then printf "device=%s\\n" "$INDEXING_DEVICE"; else echo "device=<unset>"; fi',
      "bash",
      selectionScript,
      String(force),
      String(interactive),
    ],
    { encoding: "utf8", env: { ...process.env, P_CODING_AGENT_DIR: agentDir } },
  );
}

function runBatchSizeSelection(agentDir: string) {
  return spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; AGENT_DIR="$P_CODING_AGENT_DIR"; initialize_indexing_batch_size_selection false false; if declare -p INDEXING_MAX_EMBED_BATCH_SIZE >/dev/null 2>&1; then printf "batch_size=%s\\n" "$INDEXING_MAX_EMBED_BATCH_SIZE"; else echo "batch_size=<unset>"; fi',
      "bash",
      selectionScript,
    ],
    { encoding: "utf8", env: { ...process.env, P_CODING_AGENT_DIR: agentDir } },
  );
}

function runDeviceDetection(root: string, kernelName = "Linux", architecture = "x86_64", macOsVersion = "") {
  return spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; detect_supported_indexing_devices; if is_detected_indexing_device_supported npu; then generic_npu=true; else generic_npu=false; fi; printf "mps=%s\\napple_ane=%s\\ncoreai=%s\\namd_npu=%s\\namd_npu_family=%s\\nintel_npu=%s\\namd_gpu=%s\\nnvidia_gpu=%s\\ngeneric_npu=%s\\nreason=%s\\n" "$INDEXING_HAS_MPS" "$INDEXING_HAS_APPLE_ANE" "$INDEXING_HAS_COREAI" "$INDEXING_HAS_AMD_NPU" "$INDEXING_AMD_NPU_FAMILY" "$INDEXING_HAS_INTEL_NPU" "$INDEXING_HAS_AMD_GPU" "$INDEXING_HAS_NVIDIA_GPU" "$generic_npu" "$(describe_unsupported_indexing_device npu)"',
      "bash",
      selectionScript,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        P_INDEXING_TEST_DEV_ROOT: path.join(root, "dev"),
        P_INDEXING_TEST_DISABLE_LSPCI: "true",
        P_INDEXING_TEST_OS_RELEASE: path.join(root, "os-release"),
        P_INDEXING_TEST_PCI_ROOT: path.join(root, "pci"),
        P_INDEXING_TEST_UNAME_M: architecture,
        P_INDEXING_TEST_UNAME_S: kernelName,
        P_INDEXING_TEST_MACOS_VERSION: macOsVersion,
      },
    },
  );
}

function createPciDevice(root: string, address: string, vendor: string, device: string, revision: string): void {
  const directory = path.join(root, "pci", address);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "vendor"), `${vendor}\n`);
  fs.writeFileSync(path.join(directory, "device"), `${device}\n`);
  fs.writeFileSync(path.join(directory, "revision"), `${revision}\n`);
}

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-device-detection-"));
  temporaryDirectories.push(root);
  return root;
}

function writeConfig(agentDir: string, config: Record<string, unknown>): void {
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "code-rag.json"), JSON.stringify(config));
}
