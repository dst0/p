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

# ---------- run reinstall ----------
echo "=== Running reinstall.sh ==="
bash "$SCRIPT_DIR/reinstall.sh"

echo ""
echo "=== p installed successfully ==="
