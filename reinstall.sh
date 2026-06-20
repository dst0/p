#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Syncing with main branch ==="
git stash --include-untracked
git checkout main
git pull origin main || { echo "Failed to pull from origin"; exit 1; }
git stash pop 2>/dev/null || true

echo "=== Reinstalling Monorepo Dependencies ==="
npm install --ignore-scripts

echo "=== Rebuilding Workspace Packages ==="
npm run build

echo "=== Globally Relinking Pi CLI ==="
# npm link from repo root so the workspace is linked correctly
if sudo -n true 2>/dev/null; then
    sudo npm link --ignore-scripts
else
    npm link --ignore-scripts
fi

echo "=== Verification ==="
VERSION=$("$SCRIPT_DIR/packages/coding-agent/dist/cli.js" --version)
echo "Installed p version: $VERSION"

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

echo "Done. Version $VERSION installed."
