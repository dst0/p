#!/usr/bin/env bash

detect_supported_indexing_devices() {
  INDEXING_HAS_CPU=true
  INDEXING_HAS_MPS=false
  INDEXING_HAS_AMD_GPU=false
  INDEXING_HAS_NVIDIA_GPU=false
  INDEXING_HAS_AMD_NPU=false
  INDEXING_HAS_INTEL_NPU=false
  INDEXING_NPU_UNSUPPORTED_REASON=""

  local kernel_name="${P_INDEXING_TEST_UNAME_S:-$(uname -s)}"
  local architecture="${P_INDEXING_TEST_UNAME_M:-$(uname -m)}"
  if [[ "$kernel_name" == "Darwin" ]]; then
    [[ "$architecture" == "arm64" ]] && INDEXING_HAS_MPS=true
    return 0
  fi
  if [[ "$kernel_name" != "Linux" ]]; then
    INDEXING_NPU_UNSUPPORTED_REASON="NPU indexing is not supported on $kernel_name/$architecture."
    return 0
  fi

  local device_root="${P_INDEXING_TEST_DEV_ROOT:-/dev}"
  [[ -e "$device_root/kfd" ]] && INDEXING_HAS_AMD_GPU=true
  [[ -e "$device_root/nvidiactl" ]] && INDEXING_HAS_NVIDIA_GPU=true

  local amd_npu_detected=false
  local amd_npu_supported_hardware=false
  local intel_npu_detected=false
  local intel_npu_supported_hardware=false
  local pci_device
  local pci_root="${P_INDEXING_TEST_PCI_ROOT:-/sys/bus/pci/devices}"
  for pci_device in "$pci_root"/*; do
    [[ -d "$pci_device" ]] || continue
    local pci_vendor=""
    local pci_id=""
    local pci_revision=""
    IFS= read -r pci_vendor < "$pci_device/vendor" 2>/dev/null || true
    IFS= read -r pci_id < "$pci_device/device" 2>/dev/null || true
    IFS= read -r pci_revision < "$pci_device/revision" 2>/dev/null || true
    if [[ "$pci_vendor" == "0x1022" && ( "$pci_id" == "0x17f0" || "$pci_id" == "0x1502" ) ]]; then
      amd_npu_detected=true
      if [[ "$pci_id" == "0x17f0" && "$pci_revision" =~ ^0x(00|10|11|20)$ ]]; then
        amd_npu_supported_hardware=true
      fi
    fi
    if [[ "$pci_vendor" == "0x8086" && "$pci_id" =~ ^0x(7d1d|ad1d|643e|b03e|fd3e)$ ]]; then
      intel_npu_detected=true
      intel_npu_supported_hardware=true
    fi
  done

  if [[ "${P_INDEXING_TEST_DISABLE_LSPCI:-false}" != true ]] && command -v lspci &>/dev/null; then
    local pci_listing
    pci_listing="$(lspci -Dn 2>/dev/null || true)"
    [[ "$pci_listing" =~ 1022:(17f0|1502) ]] && amd_npu_detected=true
    if [[ "$pci_listing" =~ 1022:17f0.*\(rev[[:space:]]+(00|10|11|20)\) ]]; then
      amd_npu_supported_hardware=true
    fi
    if [[ "$pci_listing" =~ 8086:(7d1d|ad1d|643e|b03e|fd3e) ]]; then
      intel_npu_detected=true
      intel_npu_supported_hardware=true
    fi
  fi

  local os_id="unknown"
  local os_version="unknown"
  local os_release_file="${P_INDEXING_TEST_OS_RELEASE:-/etc/os-release}"
  if [[ -r "$os_release_file" ]]; then
    os_id="$(. "$os_release_file"; printf '%s' "${ID:-unknown}")"
    os_version="$(. "$os_release_file"; printf '%s' "${VERSION_ID:-unknown}")"
  fi
  local supported_linux=false
  if [[ ( "$architecture" == "x86_64" || "$architecture" == "amd64" ) && "$os_id" == "ubuntu" && "$os_version" == "24.04" ]]; then
    supported_linux=true
  fi

  if [[ "$supported_linux" == true ]]; then
    [[ "$amd_npu_supported_hardware" == true ]] && INDEXING_HAS_AMD_NPU=true
    [[ "$intel_npu_supported_hardware" == true ]] && INDEXING_HAS_INTEL_NPU=true
  elif [[ "$amd_npu_detected" == true || "$intel_npu_detected" == true ]]; then
    INDEXING_NPU_UNSUPPORTED_REASON="Detected NPU hardware, but automatic NPU indexing requires Ubuntu 24.04 x64; found $os_id $os_version $architecture."
  fi
  if [[ "$supported_linux" == true && "$amd_npu_detected" == true && "$amd_npu_supported_hardware" != true ]]; then
    INDEXING_NPU_UNSUPPORTED_REASON="Detected an AMD XDNA NPU that Ryzen AI Linux 1.7.1 does not support (only STX/KRK revisions are supported)."
  fi
}

is_detected_indexing_device_supported() {
  case "$1" in
    auto|cpu|intel-openvino-cpu) return 0 ;;
    mps|apple-mps|apple-ane) [[ "$INDEXING_HAS_MPS" == true ]] ;;
    cuda|nvidia-cuda) [[ "$INDEXING_HAS_NVIDIA_GPU" == true ]] ;;
    rocm|amd-rocm) [[ "$INDEXING_HAS_AMD_GPU" == true ]] ;;
    npu)
      [[ "$INDEXING_HAS_AMD_NPU" == true && "$INDEXING_HAS_INTEL_NPU" != true ]] || \
        [[ "$INDEXING_HAS_INTEL_NPU" == true && "$INDEXING_HAS_AMD_NPU" != true ]]
      ;;
    vitisai|ryzenai) [[ "$INDEXING_HAS_AMD_NPU" == true ]] ;;
    openvino|openvino-npu|intel-openvino-npu) [[ "$INDEXING_HAS_INTEL_NPU" == true ]] ;;
    *) return 1 ;;
  esac
}

describe_unsupported_indexing_device() {
  case "$1" in
    mps|apple-mps|apple-ane) echo "Apple MPS requires an Apple Silicon Mac." ;;
    cuda|nvidia-cuda) echo "No usable NVIDIA GPU runtime was detected (/dev/nvidiactl is absent)." ;;
    rocm|amd-rocm) echo "No usable AMD GPU runtime was detected (/dev/kfd is absent)." ;;
    npu)
      if [[ "$INDEXING_HAS_AMD_NPU" == true && "$INDEXING_HAS_INTEL_NPU" == true ]]; then
        echo "Both AMD and Intel NPUs were detected; select ryzenai or intel-openvino-npu explicitly."
      else
        echo "${INDEXING_NPU_UNSUPPORTED_REASON:-No supported AMD or Intel NPU was detected.}"
      fi
      ;;
    vitisai|ryzenai|openvino|openvino-npu|intel-openvino-npu)
      echo "${INDEXING_NPU_UNSUPPORTED_REASON:-No supported AMD or Intel NPU was detected.}"
      ;;
    *) echo "The selected indexing backend is not supported on this host." ;;
  esac
}
