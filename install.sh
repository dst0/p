#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Skip sudo when running as root
SUDO=""
if [[ "$(id -u)" != "0" ]]; then
    SUDO="sudo"
fi

# ---------- helpers ----------
ok()    { echo "✓  $*"; }
need()  { echo "✗  $* (will install)"; }
skip()  { echo "→  $* already installed, skipping."; }

# ---------- detect platform ----------
PLATFORM="unknown"
if [[ "$(uname)" == "Darwin" ]]; then
    PLATFORM="macos"
elif command -v apt-get &>/dev/null; then
    PLATFORM="ubuntu"
elif command -v yum &>/dev/null; then
    PLATFORM="centos"
elif command -v dnf &>/dev/null; then
    PLATFORM="fedora"
elif command -v pacman &>/dev/null; then
    PLATFORM="arch"
else
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
fi
echo "Detected platform: $PLATFORM"

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------
SELECT_INDEXING=false
for ARG in "$@"; do
    case "$ARG" in
        --help|-h)
            echo "Usage: install.sh [OPTIONS]"
            echo ""
            echo "Install system dependencies and set up the p CLI."
            echo ""
            echo "Options:"
            echo "  --help, -h             Show this help message."
            echo "  --select-indexing      Re-prompt for the embedding device"
            echo "                         selection, overwriting the saved"
            echo "                         choice in ~/.p/agent/indexing-device."
            echo ""
            echo "The embedding device (P_CODE_RAG_DEVICE) is saved after the"
            echo "first selection and reused automatically on subsequent runs."
            echo "Use --select-indexing to change it without editing the file."
            exit 0
            ;;
        --select-indexing)
            SELECT_INDEXING=true
            ;;
        *)
            echo "Unknown option: $ARG. Use --help for usage." >&2
            exit 1
            ;;
    esac
done

AGENT_DIR="${P_CODING_AGENT_DIR:-$HOME/.p/agent}"
INDEXING_DEVICE_FILE="$AGENT_DIR/indexing-device"
INDEXING_BATCH_SIZE_FILE="$AGENT_DIR/indexing-max-batch-size"
source "$SCRIPT_DIR/scripts/indexing-device-selection.sh"
initialize_indexing_device_selection "$SELECT_INDEXING"
initialize_indexing_batch_size_selection "$SELECT_INDEXING"


# ---------- ensure curl ----------
if ! command -v curl &>/dev/null; then
    need "curl"
    if [[ "$PLATFORM" == "macos" ]] && command -v brew &>/dev/null; then
        brew install curl
    elif [[ "$PLATFORM" == "ubuntu" ]]; then
        $SUDO apt-get update -qq && $SUDO apt-get install -y -qq curl
    else
        echo "Install curl manually, then re-run this script." >&2
        exit 1
    fi
fi
ok "curl"

# ---------- install Homebrew on macOS if needed ----------
if [[ "$PLATFORM" == "macos" ]]; then
    if ! command -v brew &>/dev/null; then
        need "Homebrew"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for the current session
        eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
    fi
    ok "Homebrew"
fi

# ---------- git ----------
if ! command -v git &>/dev/null; then
    need "git"
    case "$PLATFORM" in
        macos)   brew install git ;;
        ubuntu)  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git ;;
    esac
fi
ok "git"

# ---------- build tools ----------
if [[ "$PLATFORM" == "macos" ]]; then
    # Xcode Command Line Tools provide gcc/make
    if ! command -v make &>/dev/null; then
        need "Xcode Command Line Tools"
        xcode-select --install 2>/dev/null || true
        echo "Follow the on-screen prompts to complete Xcode tools installation, then re-run this script."
        exit 1
    fi
    ok "Xcode Command Line Tools"
elif [[ "$PLATFORM" == "ubuntu" ]]; then
    if ! command -v make &>/dev/null; then
        need "build-essential"
        $SUDO apt-get update -qq && $SUDO apt-get install -y -qq build-essential
    fi
    ok "build-essential"
fi

# ---------- Python 3.12+ ----------
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PYTHON_MAJOR=$(python3 -c 'import sys; print(sys.version_info.major)')
    PYTHON_MINOR=$(python3 -c 'import sys; print(sys.version_info.minor)')
    if [[ "$PYTHON_MAJOR" -ge 3 ]] && [[ "$PYTHON_MINOR" -ge 12 ]]; then
        PYTHON_CMD="python3"
        skip "python3 ($PYTHON_VERSION)"
    else
        need "python3 >= 3.12 (found $PYTHON_VERSION)"
    fi
fi

if [[ -z "$PYTHON_CMD" ]]; then
    case "$PLATFORM" in
        macos)
            brew install python@3.12
            PYTHON_CMD="python3.12"
            ;;
        ubuntu)
            # Ubuntu 24.04 ships Python 3.12 by default; older releases need deadsnakes PPA
            $SUDO apt-get update -qq
            if ! python3 -c 'import sys; assert sys.version_info >= (3,12)' &>/dev/null; then
                $SUDO apt-get install -y -qq software-properties-common
                $SUDO add-apt-repository -y ppa:deadsnakes/ppa
                $SUDO apt-get update -qq
            fi
            $SUDO apt-get install -y -qq python3 python3-venv python3-dev
            PYTHON_CMD="python3"
            ;;
    esac
fi

# Verify python3-venv is available
if ! "$PYTHON_CMD" -m venv /dev/null &>/dev/null; then
    need "python3-venv module"
    if [[ "$PLATFORM" == "ubuntu" ]]; then
        $SUDO apt-get install -y -qq python3-venv
    elif [[ "$PLATFORM" == "macos" ]]; then
        brew install python@3.12  # includes venv on macOS
    fi
fi
ok "python3 (with venv)"

# ---------- Node.js >= 22.19.0 ----------
NODE_OK=false
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/^v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    NODE_MINOR=$(echo "$NODE_VERSION" | cut -d. -f2)
    if [[ "$NODE_MAJOR" -gt 22 ]] || { [[ "$NODE_MAJOR" -eq 22 ]] && [[ "$NODE_MINOR" -ge 19 ]]; }; then
        skip "node ($NODE_VERSION)"
        NODE_OK=true
    else
        need "node >= 22.19.0 (found $NODE_VERSION)"
    fi
fi

if [[ "$NODE_OK" != "true" ]]; then
    if [[ "$PLATFORM" == "macos" ]]; then
        if command -v brew &>/dev/null; then
            brew install node  # brew ships Node 22 LTS
            # Verify after install
            NEW_VERSION=$(node -v)
            echo "Installed node $NEW_VERSION"
            NODE_OK=true
        fi
        if [[ "$NODE_OK" != "true" ]]; then
            echo "Install Node.js >= 22.19.0 manually (e.g. https://nodejs.org) then re-run." >&2
            exit 1
        fi
    elif [[ "$PLATFORM" == "ubuntu" ]]; then
        if [[ -n "$SUDO" ]]; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
        else
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        fi
        $SUDO apt-get install -y -qq nodejs
        NEW_VERSION=$(node -v)
        echo "Installed node $NEW_VERSION"
        NODE_OK=true
    fi
fi

# ---------- npm ----------
if ! command -v npm &>/dev/null; then
    need "npm (install Node.js first)"
    exit 1
fi
ok "npm"

echo ""
echo "=== All dependencies satisfied ==="
echo ""

# ---------- embedding device selection ----------
# Prompt here so the chosen value is exported to reinstall.sh, which skips its
# own prompt when P_CODE_RAG_DEVICE is already set in the environment.
if [[ -z "${P_CODE_RAG_DEVICE:-}" ]] && [[ -t 0 ]]; then
    EMBED_CHOICES=()
    EMBED_VALUES=()
    if [[ "$(uname)" == "Darwin" ]]; then
        if [[ "$(uname -m)" == "arm64" ]]; then
            EMBED_CHOICES+=("mps (Apple Silicon Metal – uses unified memory)")
            EMBED_VALUES+=("mps")
            EMBED_CHOICES+=("cpu (CPU only)")
            EMBED_VALUES+=("cpu")
        fi
    else
        EMBED_CHOICES+=("cpu (recommended – leaves GPU free for inference)")
        EMBED_VALUES+=("cpu")
        if [[ -e /dev/kfd ]]; then
            EMBED_CHOICES+=("rocm (AMD GPU – uses VRAM for embedding)")
            EMBED_VALUES+=("rocm")
        fi
        if [[ -e /dev/nvidiactl ]]; then
            EMBED_CHOICES+=("cuda (NVIDIA GPU – uses VRAM for embedding)")
            EMBED_VALUES+=("cuda")
        fi
    fi

    if [[ "${#EMBED_CHOICES[@]}" -gt 1 ]]; then
        echo "=== Embedding device for code indexing ==="
        for i in "${!EMBED_CHOICES[@]}"; do
            echo "  $((i+1))) ${EMBED_CHOICES[$i]}"
        done
        while true; do
            read -rp "Choose [1-${#EMBED_CHOICES[@]}] (default: 1): " EMBED_CHOICE
            EMBED_CHOICE="${EMBED_CHOICE:-1}"
            if [[ "$EMBED_CHOICE" =~ ^[0-9]+$ ]] && \
               [[ "$EMBED_CHOICE" -ge 1 ]] && \
               [[ "$EMBED_CHOICE" -le "${#EMBED_CHOICES[@]}" ]]; then
                export P_CODE_RAG_DEVICE="${EMBED_VALUES[$((EMBED_CHOICE-1))]}"
                echo "Using embedding device: $P_CODE_RAG_DEVICE"
                break
            fi
            echo "Invalid choice, enter a number between 1 and ${#EMBED_CHOICES[@]}."
        done
    else
        export P_CODE_RAG_DEVICE="cpu"
        echo "Embedding device: cpu (no GPU compute device detected)"
    fi

    # Save the device choice for future install.sh / reinstall.sh runs
    mkdir -p "$AGENT_DIR"
    echo "$P_CODE_RAG_DEVICE" > "$INDEXING_DEVICE_FILE"
    echo "Saved embedding device to $INDEXING_DEVICE_FILE"

    BATCH_CHOICES=("64 (default: maximum throughput)" "32 (balanced memory & speed)" "16 (low memory)" "8 (ultra-low memory)" "4 (minimal memory)" "1 (single item, zero batch overhead)")
    BATCH_VALUES=(64 32 16 8 4 1)
    echo ""
    echo "=== Max Embedding Batch Size for code indexing ==="
    for i in "${!BATCH_CHOICES[@]}"; do
        echo "  $((i+1))) ${BATCH_CHOICES[$i]}"
    done
    while true; do
        read -rp "Choose [1-${#BATCH_CHOICES[@]}] (default: 1 [64]): " BATCH_CHOICE
        BATCH_CHOICE="${BATCH_CHOICE:-1}"
        if [[ "$BATCH_CHOICE" =~ ^[0-9]+$ ]] && \
           [[ "$BATCH_CHOICE" -ge 1 ]] && \
           [[ "$BATCH_CHOICE" -le "${#BATCH_CHOICES[@]}" ]]; then
            export P_CODE_RAG_MAX_EMBED_BATCH_SIZE="${BATCH_VALUES[$((BATCH_CHOICE-1))]}"
            echo "Using max embedding batch size: $P_CODE_RAG_MAX_EMBED_BATCH_SIZE"
            break
        fi
        echo "Invalid choice, enter a number between 1 and ${#BATCH_CHOICES[@]}."
    done

    echo "$P_CODE_RAG_MAX_EMBED_BATCH_SIZE" > "$INDEXING_BATCH_SIZE_FILE"
    echo "Saved max embedding batch size to $INDEXING_BATCH_SIZE_FILE"
    echo ""
fi

# ---------- run reinstall ----------
echo "=== Running reinstall.sh ==="
bash "$SCRIPT_DIR/reinstall.sh"

echo ""
echo "=== p installed successfully ==="
