#!/usr/bin/env bash

is_valid_indexing_device() {
  case "$1" in
    auto|cpu|nvidia-cuda|amd-rocm|apple-ane|apple-mps|intel-openvino-cpu|cuda|rocm|mps|npu|vitisai|ryzenai) return 0 ;;
    *) return 1 ;;
  esac
}

initialize_indexing_device_selection() {
  local force_selection="$1"
  local interactive="${2:-}"
  local saved_device

  if [[ -z "$interactive" ]]; then
    if [[ -t 0 ]]; then
      interactive=true
    else
      interactive=false
    fi
  fi

  if [[ "$force_selection" == true ]]; then
    if [[ "$interactive" != true ]]; then
      echo "--select-indexing requires an interactive terminal." >&2
      return 1
    fi
    unset P_CODE_RAG_DEVICE
    return 0
  fi

  if [[ -n "${P_CODE_RAG_DEVICE:-}" ]]; then
    if [[ "$P_CODE_RAG_DEVICE" == "npu" && "$(uname -s)" == "Darwin" ]]; then
      P_CODE_RAG_DEVICE="apple-ane"
    fi
    if [[ "$P_CODE_RAG_DEVICE" == "npu" && "$(uname -s)" == "Linux" ]]; then
      echo "Linux NPU indexing is not automatically configured. Use cpu until an explicit AMD Ryzen AI/Vitis AI runtime is installed and validated." >&2
      return 1
    fi
    if ! is_valid_indexing_device "$P_CODE_RAG_DEVICE"; then
      echo "Invalid P_CODE_RAG_DEVICE: $P_CODE_RAG_DEVICE" >&2
      echo "Expected one of: auto, cpu, nvidia-cuda, amd-rocm, apple-ane, apple-mps, intel-openvino-cpu, vitisai, ryzenai." >&2
      return 1
    fi
    export P_CODE_RAG_DEVICE
    return 0
  fi

  if [[ ! -f "$INDEXING_DEVICE_FILE" ]]; then
    return 0
  fi

  IFS= read -r saved_device < "$INDEXING_DEVICE_FILE" || true
  if [[ "$saved_device" == "npu" && "$(uname -s)" == "Darwin" ]]; then
    saved_device="apple-ane"
    echo "$saved_device" > "$INDEXING_DEVICE_FILE" 2>/dev/null || true
  fi
  if [[ "$saved_device" == "npu" && "$(uname -s)" == "Linux" ]]; then
    echo "Saved Linux NPU indexing is no longer accepted in $INDEXING_DEVICE_FILE; using cpu until an explicit AMD Ryzen AI/Vitis AI runtime is installed and validated." >&2
    saved_device="cpu"
  fi

  if ! is_valid_indexing_device "$saved_device"; then
    echo "Invalid saved embedding device in $INDEXING_DEVICE_FILE: $saved_device" >&2
    echo "Run with --select-indexing to replace it." >&2
    return 1
  fi

  export P_CODE_RAG_DEVICE="$saved_device"
  echo "Loaded saved embedding device: $P_CODE_RAG_DEVICE"
}

is_valid_indexing_batch_size() {
  [[ "$1" =~ ^[0-9]+$ ]] && [[ "$1" -ge 1 ]]
}

initialize_indexing_batch_size_selection() {
  local force_selection="$1"
  local interactive="${2:-}"
  local saved_batch_size

  if [[ -z "$interactive" ]]; then
    if [[ -t 0 ]]; then
      interactive=true
    else
      interactive=false
    fi
  fi

  if [[ "$force_selection" == true ]]; then
    if [[ "$interactive" != true ]]; then
      return 0
    fi
    unset P_CODE_RAG_MAX_EMBED_BATCH_SIZE
    return 0
  fi

  if [[ -n "${P_CODE_RAG_MAX_EMBED_BATCH_SIZE:-}" ]]; then
    if ! is_valid_indexing_batch_size "$P_CODE_RAG_MAX_EMBED_BATCH_SIZE"; then
      echo "Invalid P_CODE_RAG_MAX_EMBED_BATCH_SIZE: $P_CODE_RAG_MAX_EMBED_BATCH_SIZE" >&2
      echo "Expected a positive integer." >&2
      return 1
    fi
    export P_CODE_RAG_MAX_EMBED_BATCH_SIZE
    return 0
  fi

  local batch_file="${INDEXING_BATCH_SIZE_FILE:-${AGENT_DIR:-$HOME/.p/agent}/indexing-max-batch-size}"
  if [[ ! -f "$batch_file" ]]; then
    return 0
  fi

  IFS= read -r saved_batch_size < "$batch_file" || true
  if ! is_valid_indexing_batch_size "$saved_batch_size"; then
    echo "Invalid saved embedding batch size in $batch_file: $saved_batch_size" >&2
    echo "Run with --select-indexing to replace it." >&2
    return 1
  fi

  export P_CODE_RAG_MAX_EMBED_BATCH_SIZE="$saved_batch_size"
  echo "Loaded saved embedding max batch size: $P_CODE_RAG_MAX_EMBED_BATCH_SIZE"
}

prompt_indexing_device_and_batch_size_selection() {
  local agent_dir="${AGENT_DIR:-${P_CODING_AGENT_DIR:-$HOME/.p/agent}}"
  local device_file="${INDEXING_DEVICE_FILE:-$agent_dir/indexing-device}"
  local batch_file="${INDEXING_BATCH_SIZE_FILE:-$agent_dir/indexing-max-batch-size}"

  if [[ -z "${P_CODE_RAG_DEVICE:-}" ]] && [[ -t 0 ]]; then
    local embed_choices=()
    local embed_values=()
    if [[ "$(uname)" == "Darwin" ]]; then
      if [[ "$(uname -m)" == "arm64" ]]; then
        embed_choices+=("npu (recommended – Neural Processing Unit / Apple Neural Engine)")
        embed_values+=("npu")
        embed_choices+=("mps (Apple Silicon Metal – uses unified memory)")
        embed_values+=("mps")
        embed_choices+=("cpu (CPU only)")
        embed_values+=("cpu")
      fi
    else
      local has_npu=false
      if [[ -e /dev/accel/accel0 || -e /dev/amdxdna || -d /sys/class/accel ]]; then
        has_npu=true
      fi

      if [[ "$has_npu" == true ]]; then
        echo "AMD XDNA NPU hardware detected, but Linux NPU indexing requires a separately installed and validated AMD Ryzen AI runtime."
        embed_choices+=("cpu (recommended – Linux NPU not auto-configured)")
        embed_values+=("cpu")
      else
        embed_choices+=("cpu (recommended – leaves GPU free for inference)")
        embed_values+=("cpu")
      fi
      if [[ -e /dev/kfd ]]; then
        embed_choices+=("rocm (AMD GPU – uses VRAM for embedding)")
        embed_values+=("rocm")
      fi
      if [[ -e /dev/nvidiactl ]]; then
        embed_choices+=("cuda (NVIDIA GPU – uses VRAM for embedding)")
        embed_values+=("cuda")
      fi
    fi

    if [[ "${#embed_choices[@]}" -gt 1 ]]; then
      echo ""
      echo "=== Embedding device for code indexing ==="
      for i in "${!embed_choices[@]}"; do
        echo "  $((i+1))) ${embed_choices[$i]}"
      done
      while true; do
        read -rp "Choose [1-${#embed_choices[@]}] (default: 1): " embed_choice
        embed_choice="${embed_choice:-1}"
        if [[ "$embed_choice" =~ ^[0-9]+$ ]] && \
           [[ "$embed_choice" -ge 1 ]] && \
           [[ "$embed_choice" -le "${#embed_choices[@]}" ]]; then
          export P_CODE_RAG_DEVICE="${embed_values[$((embed_choice-1))]}"
          echo "Using embedding device: $P_CODE_RAG_DEVICE"
          if [[ "$P_CODE_RAG_DEVICE" == "npu" && "$(uname)" == "Darwin" ]]; then
            echo "[Notice] On macOS, NPU acceleration is handled via CoreML / Apple Neural Engine (ANE) using ONNX Runtime. If a model feature is unsupported by CoreML runtime, execution will automatically fall back to mps (Metal Performance Shaders) with a console warning."
          fi
          break
        fi
        echo "Invalid choice, enter a number between 1 and ${#embed_choices[@]}."
      done
    else
      export P_CODE_RAG_DEVICE="cpu"
      echo "Embedding device: cpu (no GPU compute device detected)"
    fi

    mkdir -p "$agent_dir"
    echo "$P_CODE_RAG_DEVICE" > "$device_file"
    echo "Saved embedding device to $device_file"

    local batch_choices=("64 (default: maximum throughput)" "32 (balanced memory & speed)" "16 (low memory)" "8 (ultra-low memory)" "4 (minimal memory)" "1 (single item, zero batch overhead)")
    local batch_values=(64 32 16 8 4 1)
    echo ""
    echo "=== Max Embedding Batch Size for code indexing ==="
    for i in "${!batch_choices[@]}"; do
      echo "  $((i+1))) ${batch_choices[$i]}"
    done
    while true; do
      read -rp "Choose [1-${#batch_choices[@]}] (default: 1 [64]): " batch_choice
      batch_choice="${batch_choice:-1}"
      if [[ "$batch_choice" =~ ^[0-9]+$ ]] && \
         [[ "$batch_choice" -ge 1 ]] && \
         [[ "$batch_choice" -le "${#batch_choices[@]}" ]]; then
        export P_CODE_RAG_MAX_EMBED_BATCH_SIZE="${batch_values[$((batch_choice-1))]}"
        echo "Using max embedding batch size: $P_CODE_RAG_MAX_EMBED_BATCH_SIZE"
        break
      fi
      echo "Invalid choice, enter a number between 1 and ${#batch_choices[@]}."
    done

    echo "$P_CODE_RAG_MAX_EMBED_BATCH_SIZE" > "$batch_file"
    echo "Saved max embedding batch size to $batch_file"
    echo ""
  fi
}

check_and_prompt_missing_indexing_deps() {
  local agent_dir="${AGENT_DIR:-${P_CODING_AGENT_DIR:-$HOME/.p/agent}}"
  local venv_python="$agent_dir/indexing-service/venv/bin/python"
  local missing_deps=()
  if [[ "${P_CODE_RAG_DEVICE:-}" == "npu" && -t 0 ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      if [[ -f "$venv_python" ]] && ! "$venv_python" -c "import onnxruntime" 2>/dev/null; then
        missing_deps+=("onnxruntime")
      fi
      if [[ -f "$venv_python" ]] && ! "$venv_python" -c "import optimum.onnxruntime" 2>/dev/null; then
        missing_deps+=("optimum[onnxruntime]")
      fi
    else
      if [[ -f "$venv_python" ]] && ! "$venv_python" -c "import onnxruntime" 2>/dev/null; then
        missing_deps+=("onnxruntime")
      fi
      if [[ -f "$venv_python" ]] && ! "$venv_python" -c "import openvino" 2>/dev/null; then
        missing_deps+=("openvino")
      fi
      if [[ -f "$venv_python" ]] && ! "$venv_python" -c "import optimum.onnxruntime" 2>/dev/null; then
        missing_deps+=("optimum[onnxruntime]")
      fi
    fi
  fi

  if [[ "${#missing_deps[@]}" -gt 0 ]]; then
    echo ""
    echo "=== Missing Dependencies for $P_CODE_RAG_DEVICE ==="
    echo "The following Python package(s) are recommended/required for $P_CODE_RAG_DEVICE acceleration: ${missing_deps[*]}"
    read -rp "Do you want to install ${missing_deps[*]} into the indexing Python environment now? [Y/n]: " install_missing
    install_missing="${install_missing:-y}"
    if [[ "$install_missing" =~ ^[Yy]$ ]]; then
      echo "Installing missing dependencies: ${missing_deps[*]}..."
      "$venv_python" -m pip install "${missing_deps[@]}"
    fi
  fi

  if [[ "${P_CODE_RAG_DEVICE:-}" == "npu" && -t 0 ]]; then
    install_amd_xdna_npu_driver_if_needed
  fi
}

install_amd_xdna_npu_driver_if_needed() {
  if [[ "$(uname)" != "Linux" ]]; then
    return 0
  fi

  if [[ -e /dev/accel/accel0 || -e /dev/amdxdna || -d /sys/class/accel ]]; then
    echo ""
    echo "=== AMD XDNA NPU Hardware Detected ==="
    echo "p does not install or validate the AMD Ryzen AI/XRT/XDNA runtime automatically."
    echo "Use CPU indexing until AMD's matched Ryzen AI runtime, XRT/plugin packages, firmware, and Vitis AI ONNX Runtime environment are installed and validated."
    return 1
  fi
}
