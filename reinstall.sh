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
    ALIAS_LINE="alias mypi='$SCRIPT_DIR/packages/coding-agent/dist/cli.js'"
    if ! grep -q "alias mypi=" "$SHELL_PROFILE"; then
        echo "$ALIAS_LINE" >> "$SHELL_PROFILE"
        echo "Added 'mypi' alias to $SHELL_PROFILE"
    else
        TMP_PROFILE="$(mktemp)"
        awk -v alias_line="$ALIAS_LINE" '{ if ($0 ~ /^alias mypi=/) print alias_line; else print }' "$SHELL_PROFILE" > "$TMP_PROFILE"
        cat "$TMP_PROFILE" > "$SHELL_PROFILE"
        rm -f "$TMP_PROFILE"
        echo "Updated 'mypi' alias in $SHELL_PROFILE"
    fi
    echo "Please run 'source $SHELL_PROFILE' to use the alias."
else
    echo "Could not find .zshrc or .bashrc. Please add this alias manually:"
    echo "alias mypi='$SCRIPT_DIR/packages/coding-agent/dist/cli.js'"
fi

echo "Done."
