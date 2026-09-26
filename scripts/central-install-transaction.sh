#!/usr/bin/env bash

CENTRAL_INSTALL_TRANSACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CENTRAL_INSTALL_LOCK_ACTIVE=false

finish_reinstall_transaction() {
    local exit_status=$?
    trap - EXIT
    if [[ "${INDEXING_REINSTALL_MARKER_ACTIVE:-false}" == true ]]; then
        node "$CENTRAL_INSTALL_TRANSACTION_DIR/prepare-indexing-service-reinstall.js" --clear >/dev/null 2>&1 || true
    fi
    if ! cleanup_indexing_reinstall_transaction; then
        echo "Failed to release the indexing reinstall lock; inspect its exact owner before retrying." >&2
        exit_status=1
    fi
    if ! cleanup_central_install_transaction; then
        echo "Failed to release the central install lock; inspect its exact owner before retrying." >&2
        exit_status=1
    fi
    exit "$exit_status"
}

begin_central_install_transaction() {
    CENTRAL_INSTALL_LOCK_ROOT="$1"
    if [[ -n "${P_CENTRAL_INSTALL_PARENT_RUN_ID:-}" || -n "${P_CENTRAL_INSTALL_PARENT_PID:-}" ]]; then
        if [[ -z "${P_CENTRAL_INSTALL_PARENT_RUN_ID:-}" || "${P_CENTRAL_INSTALL_PARENT_PID:-}" != "$PPID" ]]; then
            echo "Central install parent identity does not match this child process." >&2
            return 1
        fi
        CENTRAL_INSTALL_LOCK_RUN_ID="$P_CENTRAL_INSTALL_PARENT_RUN_ID"
        node "$CENTRAL_INSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --assert-owner \
            "$CENTRAL_INSTALL_LOCK_ROOT" "$CENTRAL_INSTALL_LOCK_RUN_ID" "$PPID"
        CENTRAL_INSTALL_LOCK_ACTIVE=false
        return 0
    fi
    CENTRAL_INSTALL_LOCK_RUN_ID="$$-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM:-0}"
    node "$CENTRAL_INSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --acquire \
        "$CENTRAL_INSTALL_LOCK_ROOT" "$CENTRAL_INSTALL_LOCK_RUN_ID" "$$"
    CENTRAL_INSTALL_LOCK_ACTIVE=true
}

cleanup_central_install_transaction() {
    if [[ "$CENTRAL_INSTALL_LOCK_ACTIVE" != true ]]; then
        return 0
    fi
    if ! node "$CENTRAL_INSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --release \
        "$CENTRAL_INSTALL_LOCK_ROOT" "$CENTRAL_INSTALL_LOCK_RUN_ID"; then
        return 1
    fi
    CENTRAL_INSTALL_LOCK_ACTIVE=false
}

run_centralized_install_candidate() {
    local CANDIDATE_RUNTIME="$1"
    local PREVIOUS_RUNTIME="$2"
    local CANDIDATE_STATUS
    shift 2

    if bash "$CANDIDATE_RUNTIME/reinstall.sh" "$@"; then
        return 0
    else
        CANDIDATE_STATUS=$?
    fi

    if [[ -z "$PREVIOUS_RUNTIME" ]]; then
        echo "Centralized install failed; no previous runtime is available to restore." >&2
        return "$CANDIDATE_STATUS"
    fi

    echo "Centralized install failed; restoring the previous verified runtime: $PREVIOUS_RUNTIME" >&2
    if bash "$PREVIOUS_RUNTIME/reinstall.sh"; then
        echo "Previous p runtime restored; the candidate install remains failed." >&2
    else
        echo "Failed to restore the previous p runtime; inspect CLI and service paths before retrying." >&2
    fi
    return "$CANDIDATE_STATUS"
}
