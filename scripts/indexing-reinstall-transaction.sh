#!/usr/bin/env bash

INDEXING_REINSTALL_TRANSACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEXING_REINSTALL_LOCK_ACTIVE=false

begin_indexing_reinstall_transaction() {
    INDEXING_REINSTALL_AGENT_DIR="$1"
    INDEXING_REINSTALL_RUN_ID="$$-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM:-0}"
    INDEXING_REINSTALL_LOCK_ACTIVE=true
    node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --acquire \
        "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID" "$$"
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
    node "$INDEXING_REINSTALL_TRANSACTION_DIR/indexing-reinstall-lock.js" --release \
        "$INDEXING_REINSTALL_AGENT_DIR" "$INDEXING_REINSTALL_RUN_ID" >/dev/null 2>&1 || true
    INDEXING_REINSTALL_LOCK_ACTIVE=false
}
