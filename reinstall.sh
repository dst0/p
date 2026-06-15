#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Reinstalling Monorepo Dependencies ==="
npm install --ignore-scripts

echo "=== Rebuilding Workspace Packages ==="
npm run build

echo "=== Globally Relinking Pi CLI ==="
(cd "$SCRIPT_DIR/packages/coding-agent" && npm link --ignore-scripts)

echo "=== Verification ==="
"$SCRIPT_DIR/packages/coding-agent/dist/cli.js" --version
echo "Done. Use 'mypi' alias (in ~/.zshrc) or the path above."
