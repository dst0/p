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

echo "=== Adding 'mypi' alias ==="
SHELL_PROFILE=""
if [ -f "$HOME/.zshrc" ]; then
    SHELL_PROFILE="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    SHELL_PROFILE="$HOME/.bashrc"
fi

if [ -n "$SHELL_PROFILE" ]; then
    if ! grep -q "alias mypi=" "$SHELL_PROFILE"; then
        echo "alias mypi='$SCRIPT_DIR/packages/coding-agent/dist/cli.js'" >> "$SHELL_PROFILE"
        echo "Added 'mypi' alias to $SHELL_PROFILE"
    else
        sed -i "s|alias mypi=.*|alias mypi='$SCRIPT_DIR/packages/coding-agent/dist/cli.js'|g" "$SHELL_PROFILE"
        echo "Updated 'mypi' alias in $SHELL_PROFILE"
    fi
    echo "Please run 'source $SHELL_PROFILE' to use the alias."
else
    echo "Could not find .zshrc or .bashrc. Please add this alias manually:"
    echo "alias mypi='$SCRIPT_DIR/packages/coding-agent/dist/cli.js'"
fi

echo "Done."
