#!/usr/bin/env bash

INDEXING_REINSTALL_TRANSACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEXING_REINSTALL_LOCK_ACTIVE=false

begin_indexing_reinstall_transaction() {
    INDEXING_REINSTALL_AGENT_DIR="$1"
    if [[ -n "${P_INDEXING_REINSTALL_PARENT_RUN_ID:-}" || -n "${P_INDEXING_REINSTALL_PARENT_PID:-}" ]]; then
        if [[ -z "${P_INDEXING_REINSTALL_PARENT_RUN_ID:-}" || "${P_INDEXING_REINSTALL_PARENT_PID:-}" != "$PPID" ]]; then
            echo "Indexing reinstall parent identity does not match this child process." >&2
            return 1
        fi
        INDEXING_REINSTALL_RUN_ID="$P_INDEXING_REINSTALL_PARENT_RUN_ID"
        node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --assert-owner \
            "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID" "$PPID"
        INDEXING_REINSTALL_LOCK_ACTIVE=false
        return 0
    fi
    INDEXING_REINSTALL_RUN_ID="$$-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM:-0}"
    node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --acquire \
        "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID" "$$"
    INDEXING_REINSTALL_LOCK_ACTIVE=true
}

clear_stale_indexing_reuse_decision() {
    node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-service-reuse.js" --clear-reuse \
        "$INDEXING_REINSTALL_AGENT_DIR" >/dev/null 2>&1 || true
}

mark_indexing_service_reuse() {
    node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-service-reuse.js" --mark-reuse \
        "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID" "$1" "$2"
}

cleanup_indexing_reinstall_transaction() {
    if [[ "$INDEXING_REINSTALL_LOCK_ACTIVE" != true ]]; then
        return
    fi
    node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-service-reuse.js" --clear-reuse \
        "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID" >/dev/null 2>&1 || true
    if ! node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --release \
        "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID"; then
        return 1
    fi
    INDEXING_REINSTALL_LOCK_ACTIVE=false
}
