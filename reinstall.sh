#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INDEXING_REINSTALL_MARKER_ACTIVE=false
cleanup_indexing_reinstall_marker() {
    if [[ "$INDEXING_REINSTALL_MARKER_ACTIVE" == true ]]; then
        node scripts/prepare-indexing-service-reinstall.mjs --clear >/dev/null 2>&1 || true
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
    if ! npm_config_prefix="$LINK_PREFIX" "$NPM_BIN" link -w @dst0/p --ignore-scripts; then
        if sudo -n true 2>/dev/null; then
            sudo env npm_config_prefix="$LINK_PREFIX" "$NPM_BIN" link -w @dst0/p --ignore-scripts
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

# Stop accepting new indexing work and let active repository operations finish
# before the service manager replaces the daemon and its managed backends.
INDEXING_REINSTALL_MARKER_ACTIVE=true
node scripts/prepare-indexing-service-reinstall.mjs

# Install or update the persistent code-indexing service (launchd/systemd)
node scripts/install-indexing-service.js
node scripts/prepare-indexing-service-reinstall.mjs --clear
INDEXING_REINSTALL_MARKER_ACTIVE=false

echo "Done. Version $VERSION installed."
