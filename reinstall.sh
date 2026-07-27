#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INDEXING_REINSTALL_MARKER_ACTIVE=false
cleanup_indexing_reinstall_marker() {
    if [[ "$INDEXING_REINSTALL_MARKER_ACTIVE" == true ]]; then
        node scripts/prepare-indexing-service-reinstall.js --clear >/dev/null 2>&1 || true
    fi
}
trap cleanup_indexing_reinstall_marker EXIT

echo "=== Using current checkout (no git pull) ==="

echo "=== Reinstalling Monorepo Dependencies ==="
npm install --ignore-scripts

echo "=== Rebuilding Workspace Packages ==="
npm run build

VERSION=$("$SCRIPT_DIR/packages/coding-agent/dist/cli.js" --version)

echo "=== Globally Relinking P CLI ==="
# Relink every npm-backed p visible on PATH. Different shell startup paths can
# otherwise select different global prefixes and keep invoking an old checkout.
NPM_BIN=$(command -v npm)
LINK_PREFIXES=("$(npm prefix -g)")
P_COMMANDS=()
while IFS= read -r P_COMMAND; do
    [[ -n "$P_COMMAND" && -L "$P_COMMAND" ]] || continue
    P_COMMAND_TARGET=$(readlink "$P_COMMAND")
    [[ "$P_COMMAND_TARGET" == *"node_modules/@dst0/p/dist/cli.js" ]] || continue
    P_COMMANDS+=("$P_COMMAND")
    P_COMMAND_PREFIX=$(dirname "$(dirname "$P_COMMAND")")
    PREFIX_RECORDED=false
    for LINK_PREFIX in "${LINK_PREFIXES[@]}"; do
        if [[ "$LINK_PREFIX" == "$P_COMMAND_PREFIX" ]]; then
            PREFIX_RECORDED=true
            break
        fi
    done
    if [[ "$PREFIX_RECORDED" == false ]]; then
        LINK_PREFIXES+=("$P_COMMAND_PREFIX")
    fi
done < <(type -a -p p 2>/dev/null || true)
for LINK_PREFIX in "${LINK_PREFIXES[@]}"; do
    if ! npm_config_prefix="$LINK_PREFIX" "$NPM_BIN" link -w @dst0/p --ignore-scripts --no-audit --no-fund --loglevel=error; then
        if sudo -n true 2>/dev/null; then
            sudo env npm_config_prefix="$LINK_PREFIX" "$NPM_BIN" link -w @dst0/p --ignore-scripts --no-audit --no-fund --loglevel=error
        else
            echo "Unable to relink p in $LINK_PREFIX without elevated permissions." >&2
            exit 1
        fi
    fi
done

echo "=== Verification ==="
hash -r
INSTALLED_P=$(command -v p || true)
if [[ -z "$INSTALLED_P" ]]; then
    echo "The relink completed, but p is not available on PATH." >&2
    exit 1
fi
INSTALLED_VERSION=$("$INSTALLED_P" --version)
if [[ "$INSTALLED_VERSION" != "$VERSION" ]]; then
    echo "Expected p $VERSION, but $INSTALLED_P reports $INSTALLED_VERSION." >&2
    exit 1
fi
for P_COMMAND in "${P_COMMANDS[@]}"; do
    P_COMMAND_VERSION=$("$P_COMMAND" --version)
    if [[ "$P_COMMAND_VERSION" != "$VERSION" ]]; then
        echo "Expected p $VERSION, but $P_COMMAND reports $P_COMMAND_VERSION." >&2
        exit 1
    fi
done
echo "Installed p version: $INSTALLED_VERSION ($INSTALLED_P)"

# Verify compaction settings in built code
node -e "
const s = require('./packages/coding-agent/dist/core/compaction/compaction.js');
const settings = s.DEFAULT_COMPACTION_SETTINGS;
if (!settings) { console.error('DEFAULT_COMPACTION_SETTINGS not found'); process.exit(1); }
console.log('triggerRatio:', settings.triggerRatio);
console.log('triggerReserveTokens:', settings.triggerReserveTokens);
if (settings.triggerRatio !== 1.0) { console.error('ERROR: triggerRatio is not 1.0'); process.exit(1); }
if (settings.triggerReserveTokens !== 2000) { console.error('ERROR: triggerReserveTokens is not 2000'); process.exit(1); }
console.log('Compaction settings verified OK');
"

# Give the indexing daemon a bounded opportunity to quiesce. If active work cannot
# settle promptly, stop the validated daemon before replacing its managed service.
# However, if the indexing-related code hasn't changed, skip the quiesce entirely.
INDEXING_REINSTALL_MARKER_ACTIVE=true

# Read the old indexing version from the current daemon's status file.
OLD_INDEXING_VERSION=$(node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const agentDir = process.env.P_CODING_AGENT_DIR || path.join(os.homedir(), '.p', 'agent');
try {
  const status = JSON.parse(fs.readFileSync(path.join(agentDir, 'indexing-service-status.json'), 'utf8'));
  if (status && typeof status.indexingVersion === 'string') {
    console.log(status.indexingVersion);
    process.exit(0);
  }
} catch {}
console.log('');
process.exit(0);
")

# Compute the new indexing version from the freshly-built files.
NEW_INDEXING_VERSION=$(node scripts/compute-indexing-version.js 2>/dev/null || echo "")

if [[ -n "$OLD_INDEXING_VERSION" && "$OLD_INDEXING_VERSION" == "$NEW_INDEXING_VERSION" ]]; then
    # Indexing version unchanged; write flag file so prepare/install skip disruptive operations.
    AGENT_DIR="${P_CODING_AGENT_DIR:-$HOME/.p/agent}"
    touch "$AGENT_DIR/indexing-version-unchanged"
    echo "Indexing version unchanged; skipping daemon quiesce and restart."
    node scripts/prepare-indexing-service-reinstall.js --skip-quiesce
else
    if [[ -n "$OLD_INDEXING_VERSION" && -n "$NEW_INDEXING_VERSION" ]]; then
        echo "Indexing version changed; preparing daemon for reinstall..."
    fi
    node scripts/prepare-indexing-service-reinstall.js
fi

# ---------- embedding device selection ----------
# Prompt unless already set in the environment or running non-interactively.
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
        echo ""
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
fi

# Install or update the persistent code-indexing service (launchd/systemd)
node scripts/install-indexing-service.js
node scripts/prepare-indexing-service-reinstall.js --clear
INDEXING_REINSTALL_MARKER_ACTIVE=false

echo "Done. Version $VERSION installed."
