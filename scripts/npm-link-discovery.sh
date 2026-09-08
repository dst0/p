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
