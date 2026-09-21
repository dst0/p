#!/usr/bin/env bash

discover_npm_backed_p_links_on_path() {
    local SEARCH_PATH="$1"
    local PATH_REMAINDER="${SEARCH_PATH}:"
    local PATH_DIRECTORY
    local P_COMMAND
    local P_COMMAND_RECORDED
    local P_COMMAND_PREFIX
    local P_COMMAND_TARGET
    local EXPECTED_ABSOLUTE_TARGET
    local EXPECTED_RELATIVE_TARGET="../lib/node_modules/@dst0/p/dist/cli.js"
    local PREFIX_RECORDED
    local RECORDED_P_COMMAND
    local LINK_PREFIX

    while [[ "$PATH_REMAINDER" == *:* ]]; do
        PATH_DIRECTORY=${PATH_REMAINDER%%:*}
        PATH_REMAINDER=${PATH_REMAINDER#*:}
        [[ -n "$PATH_DIRECTORY" ]] || PATH_DIRECTORY=.
        P_COMMAND="${PATH_DIRECTORY%/}/p"
        [[ -L "$P_COMMAND" ]] || continue
        [[ "$(basename "$(dirname "$P_COMMAND")")" == "bin" ]] || continue
        P_COMMAND_PREFIX=$(dirname "$(dirname "$P_COMMAND")")
        P_COMMAND_TARGET=$(readlink "$P_COMMAND")
        EXPECTED_ABSOLUTE_TARGET="${P_COMMAND_PREFIX%/}/lib/node_modules/@dst0/p/dist/cli.js"
        [[ "$P_COMMAND_TARGET" == "$EXPECTED_RELATIVE_TARGET" || "$P_COMMAND_TARGET" == "$EXPECTED_ABSOLUTE_TARGET" ]] || continue
        P_COMMAND_RECORDED=false
        for RECORDED_P_COMMAND in "${P_COMMANDS[@]+"${P_COMMANDS[@]}"}"; do
            if [[ "$RECORDED_P_COMMAND" == "$P_COMMAND" ]]; then
                P_COMMAND_RECORDED=true
                break
            fi
        done
        if [[ "$P_COMMAND_RECORDED" == false ]]; then
            P_COMMANDS+=("$P_COMMAND")
        fi
        PREFIX_RECORDED=false
        for LINK_PREFIX in "${LINK_PREFIXES[@]+"${LINK_PREFIXES[@]}"}"; do
            if [[ "$LINK_PREFIX" == "$P_COMMAND_PREFIX" ]]; then
                PREFIX_RECORDED=true
                break
            fi
        done
        if [[ "$PREFIX_RECORDED" == false ]]; then
            LINK_PREFIXES+=("$P_COMMAND_PREFIX")
        fi
    done
}

assert_no_local_checkout_p_alias_shadow() {
    local SHELL_CONFIG
    local LINE_NUMBER
    local SCAN_OUTPUT
    local FOUND=false
    local SHELL_CONFIGS=(
        "$HOME/.zshrc"
        "$HOME/.zprofile"
        "$HOME/.zshenv"
        "$HOME/.bashrc"
        "$HOME/.bash_profile"
        "$HOME/.profile"
    )

    for SHELL_CONFIG in "${SHELL_CONFIGS[@]}"; do
        [[ -f "$SHELL_CONFIG" ]] || continue
        if ! SCAN_OUTPUT=$(
            awk '
                function has_checkout_entrypoint(line) {
                    return line ~ /(^|[[:space:]=\047\042])[^[:space:]\047\042;#]*\/packages\/coding-agent\/dist\/cli[.]js([[:space:]\047\042;#]|$)/
                }
                function is_p_alias(line) {
                    return line ~ /(^|[;&|(){}][[:space:]]*|(then|do|else|elif)[[:space:]]+)(builtin[[:space:]]+)?alias([[:space:]]+-[A-Za-z]+)*[[:space:]]+([^;]*[[:space:]])?p[[:space:]]*=/ ||
                        line ~ /(^|[;&|(){}][[:space:]]*|(then|do|else|elif)[[:space:]]+)aliases\[[[:space:]]*(p|\047p\047|\042p\042)[[:space:]]*\][[:space:]]*=/
                }
                function inspect(line, line_number) {
                    if (is_p_alias(line) && has_checkout_entrypoint(line)) print line_number
                }
                {
                    physical = $0
                    if (logical == "") logical_start = NR
                    trailing_backslashes = 0
                    for (position = length(physical); position > 0 && substr(physical, position, 1) == "\\"; position--) {
                        trailing_backslashes++
                    }
                    if (trailing_backslashes % 2 == 1) {
                        logical = logical substr(physical, 1, length(physical) - 1)
                        next
                    }
                    logical = logical physical
                    inspect(logical, logical_start)
                    logical = ""
                }
                END {
                    if (logical != "") inspect(logical, logical_start)
                }
            ' "$SHELL_CONFIG"
        ); then
            printf 'Unable to inspect shell startup file: %s\n' "$SHELL_CONFIG" >&2
            return 1
        fi
        while IFS= read -r LINE_NUMBER; do
            [[ -n "$LINE_NUMBER" ]] || continue
            if [[ "$FOUND" == false ]]; then
                echo "A shell alias bypasses the managed p installation:" >&2
            fi
            printf '  %s:%s\n' "$SHELL_CONFIG" "$LINE_NUMBER" >&2
            FOUND=true
        done <<< "$SCAN_OUTPUT"
    done

    if [[ "$FOUND" == true ]]; then
        echo "Remove the stale alias, start a new shell, and rerun ./reinstall.sh." >&2
        return 1
    fi
}
