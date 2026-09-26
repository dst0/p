#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/scripts/indexing-reinstall-transaction.sh"
source "$SCRIPT_DIR/scripts/npm-link-discovery.sh"
source "$SCRIPT_DIR/scripts/central-install-transaction.sh"

INDEXING_REINSTALL_MARKER_ACTIVE=false
trap finish_reinstall_transaction EXIT

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
assert_no_local_checkout_p_alias_shadow
CENTRAL_INSTALL_ROOT="$HOME/.p/install"
CENTRAL_VERSIONS_ROOT="$CENTRAL_INSTALL_ROOT/versions"
if [[ -d "$CENTRAL_VERSIONS_ROOT" ]]; then
    CENTRAL_VERSIONS_ROOT="$(cd "$CENTRAL_VERSIONS_ROOT" && pwd -P)"
fi
AGENT_DIR="${P_CODING_AGENT_DIR:-$HOME/.p/agent}"
if [[ "$SCRIPT_DIR" != "$CENTRAL_VERSIONS_ROOT/"* ]]; then
    unset P_CENTRAL_INSTALL_PARENT_RUN_ID P_CENTRAL_INSTALL_PARENT_PID
    unset P_INDEXING_REINSTALL_PARENT_RUN_ID P_INDEXING_REINSTALL_PARENT_PID
    echo "Source checkout: $SCRIPT_DIR"
    echo "Source branch: $(git -C "$SCRIPT_DIR" branch --show-current)"
    echo "Source HEAD: $(git -C "$SCRIPT_DIR" rev-parse HEAD)"
    node "$SCRIPT_DIR/scripts/central-install-snapshot.js" prepare
    begin_central_install_transaction "$CENTRAL_INSTALL_ROOT"
    export P_CENTRAL_INSTALL_PARENT_RUN_ID="$CENTRAL_INSTALL_LOCK_RUN_ID"
    export P_CENTRAL_INSTALL_PARENT_PID="$$"
    begin_indexing_reinstall_transaction "$AGENT_DIR"
    export P_INDEXING_REINSTALL_PARENT_RUN_ID="$INDEXING_REINSTALL_RUN_ID"
    export P_INDEXING_REINSTALL_PARENT_PID="$$"
    STAGED_RUNTIME=$(node "$SCRIPT_DIR/scripts/central-install-snapshot.js" stage "$SCRIPT_DIR")
    echo "Installing from centralized runtime: $STAGED_RUNTIME"
    PREVIOUS_RUNTIME=""
    if [[ -L "$HOME/.p/install/current" ]]; then
        PREVIOUS_RUNTIME="$(realpath "$HOME/.p/install/current")"
    fi
    run_centralized_install_candidate "$STAGED_RUNTIME" "$PREVIOUS_RUNTIME" "$@"
    exit $?
fi
if [[ ! -f "$SCRIPT_DIR/.p-source-sha" ]]; then
    echo "Centralized runtime is missing its source marker: $SCRIPT_DIR" >&2
    exit 1
fi
echo "Installed runtime: $SCRIPT_DIR"
echo "Source branch: committed snapshot (no Git worktree)"
echo "Source HEAD: $(<"$SCRIPT_DIR/.p-source-sha")"
node "$SCRIPT_DIR/scripts/central-install-snapshot.js" prepare
begin_central_install_transaction "$CENTRAL_INSTALL_ROOT"
begin_indexing_reinstall_transaction "$AGENT_DIR"
node "$SCRIPT_DIR/scripts/indexing-config.js" migrate "$AGENT_DIR"
source "$SCRIPT_DIR/scripts/indexing-device-selection.sh"
initialize_indexing_device_selection "$SELECT_INDEXING"
initialize_indexing_batch_size_selection "$SELECT_INDEXING"
initialize_indexing_tray_selection "$SELECT_INDEXING"


# ---------------------------------------------------------------------------
# Main reinstall flow
# ---------------------------------------------------------------------------
echo "=== Using centralized runtime: $SCRIPT_DIR ==="

if [[ ! -f "$SCRIPT_DIR/.p-runtime-built" ]]; then
    if [[ -L "$HOME/.p/install/current" && "$(realpath "$HOME/.p/install/current")" == "$SCRIPT_DIR" ]]; then
        echo "Refusing to rebuild the active centralized runtime in place." >&2
        exit 1
    fi
    echo "=== Installing Monorepo Dependencies in a new runtime ==="
    npm install --ignore-scripts

    echo "=== Building Workspace Packages in a new runtime ==="
    npm run build
    node scripts/central-install-snapshot.js mark-built "$SCRIPT_DIR"
else
    echo "=== Reusing the already-built installed runtime ==="
fi

VERSION=$("$SCRIPT_DIR/packages/coding-agent/dist/cli.js" --version)

echo "=== Globally Relinking P CLI ==="
# Relink every npm-backed p visible on PATH. Different shell startup paths can
# otherwise select different global prefixes and keep invoking an old checkout.
NPM_BIN=$(command -v npm)
LINK_PREFIXES=("$(npm prefix -g)")
P_COMMANDS=()
discover_npm_backed_p_links_on_path "${PATH:-}"
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
EXPECTED_P_ENTRYPOINT="$SCRIPT_DIR/packages/coding-agent/dist/cli.js"
if [[ "$(realpath "$INSTALLED_P")" != "$EXPECTED_P_ENTRYPOINT" ]]; then
    echo "p does not resolve to the candidate runtime: $INSTALLED_P" >&2
    exit 1
fi
if [[ "$INSTALLED_VERSION" != "$VERSION" ]]; then
    echo "Expected p $VERSION, but $INSTALLED_P reports $INSTALLED_VERSION." >&2
    exit 1
fi
for P_COMMAND in "${P_COMMANDS[@]+"${P_COMMANDS[@]}"}"; do
    if [[ "$(realpath "$P_COMMAND")" != "$EXPECTED_P_ENTRYPOINT" ]]; then
        echo "p does not resolve to the candidate runtime: $P_COMMAND" >&2
        exit 1
    fi
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
clear_stale_indexing_reuse_decision

# Compute the new indexing version from the freshly-built files.
NEW_INDEXING_VERSION=$(node scripts/compute-indexing-version.js 2>/dev/null || echo "")
NEW_INDEXING_RUNTIME_FINGERPRINT=$(node scripts/compute-indexing-runtime-fingerprint.js 2>/dev/null || echo "")
INDEXING_REUSE_DECISION=$(
    node scripts/indexing-service-reuse.js "$NEW_INDEXING_VERSION" "$NEW_INDEXING_RUNTIME_FINGERPRINT" 2>/dev/null || echo "restart"
)

if [[ "$INDEXING_REUSE_DECISION" == "reuse" ]]; then
    # Bind the one-shot reuse approval to this serialized reinstall and its exact inputs.
    mark_indexing_service_reuse "$NEW_INDEXING_VERSION" "$NEW_INDEXING_RUNTIME_FINGERPRINT"
    echo "Indexing version unchanged; skipping daemon quiesce and restart."
    node scripts/prepare-indexing-service-reinstall.js --skip-quiesce
else
    echo "Indexing code, runtime configuration, or backend health changed; preparing daemon for reinstall..."
    node scripts/prepare-indexing-service-reinstall.js
fi

# Install or update the persistent code-indexing service (launchd/systemd)
P_INDEXING_REINSTALL_RUN_ID="$INDEXING_REINSTALL_RUN_ID" \
P_INDEXING_REINSTALL_EXPECTED_REUSE="$INDEXING_REUSE_DECISION" \
    node scripts/install-indexing-service.js
node scripts/prepare-indexing-service-reinstall.js --clear
INDEXING_REINSTALL_MARKER_ACTIVE=false
node scripts/indexing-service-health.js "$AGENT_DIR" "$SCRIPT_DIR"
node scripts/central-install-snapshot.js activate "$SCRIPT_DIR"

echo "Done. Version $VERSION installed."
