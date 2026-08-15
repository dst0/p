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

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------
SELECT_INDEXING=false
for ARG in "$@"; do
    case "$ARG" in
        --help|-h)
            echo "Usage: reinstall.sh [OPTIONS]"
            echo ""
            echo "Reinstall the p CLI and update the code-indexing service."
            echo ""
            echo "Options:"
            echo "  --help, -h             Show this help message."
            echo "  --select-indexing      Re-prompt for the code indexing mode"
            echo "                         selection in ~/.p/agent/code-rag.json."
            echo ""
            echo "The indexing mode is saved in the standard code-index config"
            echo "and reused automatically on subsequent runs."
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

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
AGENT_DIR="${P_CODING_AGENT_DIR:-$HOME/.p/agent}"
node "$SCRIPT_DIR/scripts/indexing-config.js" migrate "$AGENT_DIR"
source "$SCRIPT_DIR/scripts/indexing-device-selection.sh"
initialize_indexing_device_selection "$SELECT_INDEXING"
initialize_indexing_batch_size_selection "$SELECT_INDEXING"
initialize_indexing_tray_selection "$SELECT_INDEXING"


# ---------------------------------------------------------------------------
# Main reinstall flow
# ---------------------------------------------------------------------------
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
for P_COMMAND in "${P_COMMANDS[@]+"${P_COMMANDS[@]}"}"; do
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

# Apply interactive indexing choices before computing the runtime fingerprint.
# Otherwise an unchanged code version can incorrectly reuse a daemon running
# with the previous device configuration.
prompt_indexing_device_and_batch_size_selection
prompt_indexing_tray_selection
check_and_prompt_missing_indexing_deps

# Give the indexing daemon a bounded opportunity to quiesce. If active work cannot
# settle promptly, stop the validated daemon before replacing its managed service.
# However, if the indexing-related code hasn't changed, skip the quiesce entirely.
INDEXING_REINSTALL_MARKER_ACTIVE=true

# Compute the new indexing version from the freshly-built files.
NEW_INDEXING_VERSION=$(node scripts/compute-indexing-version.js 2>/dev/null || echo "")
NEW_INDEXING_RUNTIME_FINGERPRINT=$(node scripts/compute-indexing-runtime-fingerprint.js 2>/dev/null || echo "")
INDEXING_REUSE_DECISION=$(
    node scripts/indexing-service-reuse.js "$NEW_INDEXING_VERSION" "$NEW_INDEXING_RUNTIME_FINGERPRINT" 2>/dev/null || echo "restart"
)

if [[ "$INDEXING_REUSE_DECISION" == "reuse" ]]; then
    # Indexing version unchanged; write flag file so prepare/install skip disruptive operations.
    AGENT_DIR="${P_CODING_AGENT_DIR:-$HOME/.p/agent}"
    touch "$AGENT_DIR/indexing-version-unchanged"
    echo "Indexing version unchanged; skipping daemon quiesce and restart."
    node scripts/prepare-indexing-service-reinstall.js --skip-quiesce
else
    echo "Indexing code, runtime configuration, or backend health changed; preparing daemon for reinstall..."
    node scripts/prepare-indexing-service-reinstall.js
fi

# Install or update the persistent code-indexing service (launchd/systemd)
node scripts/install-indexing-service.js
node scripts/prepare-indexing-service-reinstall.js --clear
INDEXING_REINSTALL_MARKER_ACTIVE=false
node scripts/indexing-service-health.js "$AGENT_DIR"

echo "Done. Version $VERSION installed."

