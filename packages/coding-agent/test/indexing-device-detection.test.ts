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
  it("preserves explicit Linux NPU selections for hardware-aware installation", () => {
    const root = createFixture();
    const agentDir = path.join(root, "agent");
    fs.mkdirSync(agentDir, { recursive: true });

    for (const device of ["intel-openvino-npu", "ryzenai"]) {
      const selected = runDeviceSelection(agentDir, device);
      expect(selected.status, selected.stderr).toBe(0);
      expect(selected.stdout).toContain(`device=${device}`);
    }
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

  it("detects Phoenix but rejects its unsupported transformer path", () => {
    const root = createFixture();
    createPciDevice(root, "0000:66:00.1", "0x1022", "0x1502", "0x00");
    fs.mkdirSync(path.join(root, "dev"), { recursive: true });
    fs.writeFileSync(path.join(root, "os-release"), 'ID=ubuntu\nVERSION_ID="24.04"\n');

    const detected = runDeviceDetection(root);

    expect(detected.status, detected.stderr).toBe(0);
    expect(detected.stdout).toContain("amd_npu=false");
    expect(detected.stdout).toContain("generic_npu=false");
    expect(detected.stdout).toContain("Ryzen AI Linux 1.7.1 does not support");
  });
});

function runDeviceSelection(agentDir: string, device: string) {
  return spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; AGENT_DIR="$P_CODING_AGENT_DIR"; INDEXING_DEVICE_FILE="$AGENT_DIR/indexing-device"; initialize_indexing_device_selection false false; printf "device=%s\\n" "$P_CODE_RAG_DEVICE"',
      "bash",
      selectionScript,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, P_CODING_AGENT_DIR: agentDir, P_CODE_RAG_DEVICE: device },
    },
  );
}

function runDeviceDetection(root: string) {
  return spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; detect_supported_indexing_devices; if is_detected_indexing_device_supported npu; then generic_npu=true; else generic_npu=false; fi; printf "amd_npu=%s\\nintel_npu=%s\\namd_gpu=%s\\nnvidia_gpu=%s\\ngeneric_npu=%s\\nreason=%s\\n" "$INDEXING_HAS_AMD_NPU" "$INDEXING_HAS_INTEL_NPU" "$INDEXING_HAS_AMD_GPU" "$INDEXING_HAS_NVIDIA_GPU" "$generic_npu" "$(describe_unsupported_indexing_device npu)"',
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
        P_INDEXING_TEST_UNAME_M: "x86_64",
        P_INDEXING_TEST_UNAME_S: "Linux",
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
