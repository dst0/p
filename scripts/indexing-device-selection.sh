#!/usr/bin/env bash

is_valid_indexing_device() {
  case "$1" in
    auto|cpu|cuda|rocm|mps) return 0 ;;
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
    if ! is_valid_indexing_device "$P_CODE_RAG_DEVICE"; then
      echo "Invalid P_CODE_RAG_DEVICE: $P_CODE_RAG_DEVICE" >&2
      echo "Expected one of: auto, cpu, cuda, rocm, mps." >&2
      return 1
    fi
    export P_CODE_RAG_DEVICE
    return 0
  fi

  if [[ ! -f "$INDEXING_DEVICE_FILE" ]]; then
    return 0
  fi

  IFS= read -r saved_device < "$INDEXING_DEVICE_FILE" || true
  if ! is_valid_indexing_device "$saved_device"; then
    echo "Invalid saved embedding device in $INDEXING_DEVICE_FILE: $saved_device" >&2
    echo "Run with --select-indexing to replace it." >&2
    return 1
  fi

  export P_CODE_RAG_DEVICE="$saved_device"
  echo "Loaded saved embedding device: $P_CODE_RAG_DEVICE"
}
