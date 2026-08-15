#!/usr/bin/env bash

indexing_selection_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$indexing_selection_script_dir/indexing-device-detection.sh"
indexing_config_script="$indexing_selection_script_dir/indexing-config.js"

is_valid_indexing_device() {
  case "$1" in
    auto|cpu|nvidia-cuda|amd-rocm|apple-ane|apple-mps|intel-openvino-cpu|intel-openvino-npu|openvino|openvino-npu|cuda|rocm|mps|npu|vitisai|ryzenai|amd-phoenix-npu|amd-ryzenai-npu) return 0 ;;
    *) return 1 ;;
  esac
}

is_valid_indexing_search_mode() {
  [[ "$1" == "hybrid" || "$1" == "bm25-only" ]]
}

is_valid_indexing_batch_size() {
  [[ "$1" =~ ^[0-9]+$ ]] && [[ "$1" -ge 1 ]]
}

indexing_agent_directory() {
  printf "%s" "${AGENT_DIR:-${P_CODING_AGENT_DIR:-$HOME/.p/agent}}"
}

read_indexing_config_value() {
  node "$indexing_config_script" get "$(indexing_agent_directory)" "$1"
}

write_indexing_config_value() {
  node "$indexing_config_script" set "$(indexing_agent_directory)" "$1" "$2"
}

initialize_indexing_device_selection() {
  local force_selection="$1"
  local interactive="${2:-}"
  if [[ -z "$interactive" ]]; then
    [[ -t 0 ]] && interactive=true || interactive=false
  fi
  if [[ "$force_selection" == true ]]; then
    if [[ "$interactive" != true ]]; then
      echo "--select-indexing requires an interactive terminal." >&2
      return 1
    fi
    unset INDEXING_DEVICE
    unset INDEXING_SEARCH_MODE
    return 0
  fi

  local saved_search_mode
  saved_search_mode="$(read_indexing_config_value searchMode)" || return 1
  saved_search_mode="${saved_search_mode:-hybrid}"
  if ! is_valid_indexing_search_mode "$saved_search_mode"; then
    echo "Invalid searchMode in code-rag.json: $saved_search_mode" >&2
    echo "Run with --select-indexing to replace it." >&2
    return 1
  fi
  if [[ "$saved_search_mode" == "bm25-only" ]]; then
    INDEXING_SEARCH_MODE="bm25-only"
    echo "Loaded configured indexing mode: fast (BM25)"
    return 0
  fi

  local saved_device
  saved_device="$(read_indexing_config_value embeddingDevice)" || return 1
  [[ -z "$saved_device" ]] && return 0
  if ! is_valid_indexing_device "$saved_device"; then
    echo "Invalid embeddingDevice in code-rag.json: $saved_device" >&2
    echo "Run with --select-indexing to replace it." >&2
    return 1
  fi
  if [[ "$interactive" == true ]]; then
    detect_supported_indexing_devices
    if ! is_detected_indexing_device_supported "$saved_device"; then
      echo "Saved embedding device '$saved_device' is unavailable: $(describe_unsupported_indexing_device "$saved_device")"
      unset INDEXING_DEVICE
      return 0
    fi
  fi
  INDEXING_DEVICE="$saved_device"
  INDEXING_SEARCH_MODE="hybrid"
  echo "Loaded configured embedding device: $INDEXING_DEVICE"
}

initialize_indexing_batch_size_selection() {
  local force_selection="$1"
  local interactive="${2:-}"
  if [[ -z "$interactive" ]]; then
    [[ -t 0 ]] && interactive=true || interactive=false
  fi
  if [[ "$force_selection" == true ]]; then
    [[ "$interactive" == true ]] && unset INDEXING_MAX_EMBED_BATCH_SIZE
    return 0
  fi
  [[ "${INDEXING_SEARCH_MODE:-hybrid}" == "bm25-only" ]] && return 0
  local saved_batch_size
  saved_batch_size="$(read_indexing_config_value maxEmbeddingBatchSize)" || return 1
  [[ -z "$saved_batch_size" ]] && return 0
  if ! is_valid_indexing_batch_size "$saved_batch_size"; then
    echo "Invalid maxEmbeddingBatchSize in code-rag.json: $saved_batch_size" >&2
    echo "Run with --select-indexing to replace it." >&2
    return 1
  fi
  INDEXING_MAX_EMBED_BATCH_SIZE="$saved_batch_size"
  echo "Loaded configured embedding max batch size: $INDEXING_MAX_EMBED_BATCH_SIZE"
}

prompt_indexing_device_and_batch_size_selection() {
  [[ -n "${INDEXING_DEVICE:-}" || -n "${INDEXING_SEARCH_MODE:-}" || ! -t 0 ]] && return 0
  local choices=()
  local values=()
  detect_supported_indexing_devices
  local npu_label="NPU"
  [[ "$(uname -s)" == "Darwin" ]] && npu_label="NPU (Apple Neural Engine)"
  [[ -n "$INDEXING_NPU_UNSUPPORTED_REASON" ]] && echo "$npu_label unavailable: $INDEXING_NPU_UNSUPPORTED_REASON"
  if [[ "$INDEXING_HAS_AMD_NPU" == true ]]; then
    if [[ "$INDEXING_AMD_NPU_FAMILY" == "phoenix" ]]; then
      choices+=("amd-phoenix-npu (recommended - automatic MLIR-AIE/IRON installation)")
      values+=("amd-phoenix-npu")
    else
      choices+=("amd-ryzenai-npu (recommended - automatic Ryzen AI 1.8 installation)")
      values+=("amd-ryzenai-npu")
    fi
  fi
  if [[ "$INDEXING_HAS_INTEL_NPU" == true ]]; then
    choices+=("intel-openvino-npu (recommended - automatic Intel NPU installation)")
    values+=("intel-openvino-npu")
  fi
  if [[ "$INDEXING_HAS_APPLE_ANE" == true ]]; then
    if [[ "$INDEXING_HAS_COREAI" == true ]]; then
      choices+=("NPU (Apple Neural Engine via Core AI) (recommended)")
    else
      choices+=("NPU (Apple Neural Engine via CoreML EP, hybrid ANE + CPU)")
    fi
    values+=("apple-ane")
  fi
  if [[ "$INDEXING_HAS_MPS" == true ]]; then
    choices+=("GPU (MPS) (recommended - Apple Silicon Metal acceleration)")
    values+=("mps")
  fi
  [[ "$INDEXING_HAS_AMD_GPU" == true ]] && choices+=("rocm (detected AMD GPU runtime)") && values+=("rocm")
  [[ "$INDEXING_HAS_NVIDIA_GPU" == true ]] && choices+=("cuda (detected NVIDIA GPU runtime)") && values+=("cuda")
  choices+=("cpu (detected CPU)")
  values+=("cpu")
  choices+=("fast (BM25)")
  values+=("bm25-only")

  echo ""
  echo "=== Code indexing mode ==="
  for index in "${!choices[@]}"; do echo "  $((index + 1))) ${choices[$index]}"; done
  while true; do
    read -rp "Choose [1-${#choices[@]}] (default: 1): " choice
    choice="${choice:-1}"
    if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "${#choices[@]}" ]]; then
      local selected="${values[$((choice - 1))]}"
      if [[ "$selected" == "bm25-only" ]]; then
        INDEXING_SEARCH_MODE="bm25-only"
        INDEXING_DEVICE="cpu"
      else
        INDEXING_SEARCH_MODE="hybrid"
        INDEXING_DEVICE="$selected"
      fi
      break
    fi
    echo "Invalid choice, enter a number between 1 and ${#choices[@]}."
  done
  write_indexing_config_value searchMode "$INDEXING_SEARCH_MODE" || return 1
  write_indexing_config_value embeddingDevice "$INDEXING_DEVICE" || return 1
  if [[ "$INDEXING_SEARCH_MODE" == "bm25-only" ]]; then
    echo "Using indexing mode: fast (BM25)"
    return 0
  fi
  echo "Using indexing mode: hybrid ($INDEXING_DEVICE)"

  local batch_values=(64 32 16 8 4 1)
  echo ""
  echo "=== Max Embedding Batch Size for code indexing ==="
  for index in "${!batch_values[@]}"; do echo "  $((index + 1))) ${batch_values[$index]}"; done
  while true; do
    read -rp "Choose [1-${#batch_values[@]}] (default: 1): " choice
    choice="${choice:-1}"
    if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "${#batch_values[@]}" ]]; then
      INDEXING_MAX_EMBED_BATCH_SIZE="${batch_values[$((choice - 1))]}"
      break
    fi
    echo "Invalid choice, enter a number between 1 and ${#batch_values[@]}."
  done
  write_indexing_config_value maxEmbeddingBatchSize "$INDEXING_MAX_EMBED_BATCH_SIZE" || return 1
  echo "Using max embedding batch size: $INDEXING_MAX_EMBED_BATCH_SIZE"
}

initialize_indexing_tray_selection() {
  local force_selection="$1"
  local interactive="${2:-}"
  if [[ -z "$interactive" ]]; then
    [[ -t 0 ]] && interactive=true || interactive=false
  fi
  if [[ "$force_selection" == true ]]; then
    [[ "$interactive" == true ]] && unset INDEXING_ENABLE_TRAY
    return 0
  fi
  local saved_tray
  saved_tray="$(read_indexing_config_value enableTray)" || return 1
  [[ -z "$saved_tray" ]] && return 0
  INDEXING_ENABLE_TRAY="$saved_tray"
  echo "Loaded configured indexing tray indicator: $INDEXING_ENABLE_TRAY"
}

prompt_indexing_tray_selection() {
  [[ -n "${INDEXING_ENABLE_TRAY:-}" || ! -t 0 ]] && return 0
  echo ""
  echo "=== Code indexing system tray / menu bar indicator ==="
  echo "Show a background status indicator icon in the system menu bar / tray?"
  local default_choice="Y"
  read -rp "Enable status tray indicator? [Y/n] (default: Y): " choice
  choice="${choice:-$default_choice}"
  case "$choice" in
    [yY]|[yY][eE][sS])
      INDEXING_ENABLE_TRAY=true
      ;;
    *)
      INDEXING_ENABLE_TRAY=false
      ;;
  esac
  write_indexing_config_value enableTray "$INDEXING_ENABLE_TRAY" || return 1
  echo "Using indexing tray indicator: $INDEXING_ENABLE_TRAY"
}

check_and_prompt_missing_indexing_deps() {
  if [[ "${INDEXING_DEVICE:-}" == "npu" && "$(uname)" != "Darwin" ]]; then
    echo "The matching AMD Ryzen AI or Intel OpenVINO runtime will be installed automatically."
  fi
}

install_amd_xdna_npu_driver_if_needed() {
  [[ "$(uname)" != "Linux" ]] && return 0
  echo "AMD XDNA and Intel OpenVINO NPU installation is handled automatically by scripts/install-indexing-service.js."
}

