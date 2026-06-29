#!/usr/bin/env bash
set -euo pipefail

# Single canonical 26-turn cache-reuse smoke for p + llm-orchestrator + llama.cpp.
#
# Contract:
# - runs real `p -p` work for 26 same-session turns;
# - every turn reads one small file, writes one transformed file, and calls finish_work;
# - fails on the first cache-reuse regression after the cold first turn;
# - allows one high prefill only immediately after p records compaction;
# - captures provider request payloads through a local proxy;
# - before compaction, requires the previous turn's provider-visible prompt to
#   remain an exact prefix of the next user turn's first provider-visible prompt.
#
# If the prompt prefix comparison fails, fix p. Do not relax this smoke unless
# p intentionally changes its provider-visible prompt contract and the cache
# reuse design is updated at the same time.

SSH_HOST="${SSH_HOST:-dst@192.168.8.167}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_ssh_mini_pc_760u}"
ORCHESTRATOR_HOST="${ORCHESTRATOR_HOST:-192.168.8.167}"
ORCHESTRATOR_PORT="${ORCHESTRATOR_PORT:-11450}"
LLAMA_LOG_PATH="${LLAMA_LOG_PATH:-/opt/llama/logs/llama-server-main-stderr.log}"
MODEL_ID="${MODEL_ID:-mini-pc/large-32-kvq4-cache}"
CONTEXT_WINDOW="${CONTEXT_WINDOW:-32768}"
SESSION_ID="${SESSION_ID:-p-cache-26-turn-smoke}"
TURNS="${TURNS:-26}"
MAX_PROMPT_EVAL_POST_FIRST="${MAX_PROMPT_EVAL_POST_FIRST:-6000}"
ROOT="${1:-/tmp/p-cache-26-turn-smoke-$(date +%s)}"

SSH=(ssh -i "$SSH_KEY" "$SSH_HOST")
CFG="$ROOT/config"
SESSION_DIR="$ROOT/sessions"
REQUEST_DIR="$ROOT/provider-requests"
PROMPT_CHECK_DIR="$ROOT/prompt-checks"

mkdir -p "$ROOT/in" "$ROOT/out" "$ROOT/logs" "$SESSION_DIR" "$CFG" "$REQUEST_DIR" "$PROMPT_CHECK_DIR"

PROXY_PORT="${PROXY_PORT:-$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)}"

cat > "$ROOT/provider_proxy.py" <<'PY'
import http.client
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1])
request_dir = sys.argv[2]
target_host = sys.argv[3]
target_port = int(sys.argv[4])
counter = 0
counter_lock = threading.Lock()


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        global counter
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        with counter_lock:
            counter += 1
            index = counter

        capture_path = os.path.join(request_dir, f"{index:06d}.json")
        with open(capture_path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "index": index,
                    "method": "POST",
                    "path": self.path,
                    "body": body.decode("utf-8", errors="replace"),
                },
                handle,
                ensure_ascii=False,
            )

        headers = {key: value for key, value in self.headers.items() if key.lower() != "host"}
        headers["Host"] = f"{target_host}:{target_port}"
        conn = http.client.HTTPConnection(target_host, target_port, timeout=600)
        try:
            conn.request("POST", self.path, body=body, headers=headers)
            resp = conn.getresponse()
            self.send_response(resp.status, resp.reason)
            for key, value in resp.getheaders():
                if key.lower() in {
                    "connection",
                    "keep-alive",
                    "proxy-authenticate",
                    "proxy-authorization",
                    "te",
                    "trailers",
                    "transfer-encoding",
                    "upgrade",
                }:
                    continue
                self.send_header(key, value)
            self.send_header("Connection", "close")
            self.end_headers()
            while True:
                chunk = resp.read(1)
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
            self.close_connection = True
        finally:
            conn.close()

    def log_message(self, _format, *_args):
        return


server = ThreadingHTTPServer(("127.0.0.1", port), ProxyHandler)
server.serve_forever()
PY

cat > "$ROOT/prompt_guard.py" <<'PY'
import json
import sys
from pathlib import Path

checkpoint_path = Path(sys.argv[1])
first_request_path = Path(sys.argv[2])
last_request_path = Path(sys.argv[3])
turn = sys.argv[4]
compacted = sys.argv[5] == "1"


def request_messages(path: Path):
    capture = json.loads(path.read_text(encoding="utf-8"))
    body = json.loads(capture["body"])
    messages = body.get("messages")
    if messages is None:
        messages = body.get("input")
    if not isinstance(messages, list):
        raise SystemExit(f"turn {turn}: request {path} has no message list")
    return messages


def normalized(messages):
    result = []
    for message in messages:
        if isinstance(message, dict):
            result.append(
                {
                    key: message[key]
                    for key in ("role", "content", "name", "tool_call_id", "tool_calls")
                    if key in message
                }
            )
        else:
            result.append(message)
    return result


def first_mismatch(expected, actual):
    limit = min(len(expected), len(actual))
    for index in range(limit):
        if expected[index] != actual[index]:
            return index
    if len(expected) > len(actual):
        return limit
    return None


def anchor_window(messages, fraction):
    if len(messages) <= 8:
        return messages
    width = min(6, max(2, len(messages) // 8))
    start = min(max(0, int(len(messages) * fraction) - width // 2), len(messages) - width)
    return messages[start : start + width]


def contains_window(messages, window):
    if not window:
        return True
    end = len(messages) - len(window) + 1
    return any(messages[index : index + len(window)] == window for index in range(max(0, end)))


current_first = normalized(request_messages(first_request_path))
current_last = normalized(request_messages(last_request_path))

if checkpoint_path.exists() and not compacted:
    previous = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    previous_messages = previous["messages"]
    mismatch = first_mismatch(previous_messages, current_first)
    if mismatch is not None:
        start_anchor = previous_messages[: min(8, len(previous_messages))]
        middle_anchor = anchor_window(previous_messages, 0.5)
        diagnostic_path = checkpoint_path.with_suffix(f".turn-{turn}.mismatch.json")
        diagnostic_path.write_text(
            json.dumps(
                {
                    "turn": turn,
                    "previous_request": previous.get("request"),
                    "current_first_request": str(first_request_path),
                    "mismatch_index": mismatch,
                    "previous_len": len(previous_messages),
                    "current_first_len": len(current_first),
                    "start_anchor_ok": current_first[: len(start_anchor)] == start_anchor,
                    "middle_anchor_ok": contains_window(current_first, middle_anchor),
                    "previous_at_mismatch": previous_messages[mismatch : mismatch + 3],
                    "current_at_mismatch": current_first[mismatch : mismatch + 3],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        raise SystemExit(
            f"turn {turn}: provider-visible prompt changed before compaction; "
            f"mismatch at message {mismatch}; diagnostic={diagnostic_path}"
        )

checkpoint_path.write_text(
    json.dumps(
        {
            "turn": turn,
            "request": str(last_request_path),
            "compacted": compacted,
            "messages": current_last,
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)
PY

python3 "$ROOT/provider_proxy.py" "$PROXY_PORT" "$REQUEST_DIR" "$ORCHESTRATOR_HOST" "$ORCHESTRATOR_PORT" &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
sleep 1

cat > "$CFG/models.json" <<JSON
{
  "providers": {
    "mini-pc-smoke": {
      "baseUrl": "http://127.0.0.1:$PROXY_PORT/v1",
      "apiKey": "ollama",
      "api": "openai-completions",
      "models": [
        {
          "id": "$MODEL_ID",
          "contextWindow": $CONTEXT_WINDOW,
          "maxTokens": 4096,
          "input": ["text"],
          "reasoning": false
        }
      ]
    }
  }
}
JSON

cat > "$CFG/settings.json" <<JSON
{
  "defaultProvider": "mini-pc-smoke",
  "defaultModel": "$MODEL_ID",
  "enabledModels": [],
  "quietStartup": true,
  "enableInstallTelemetry": false,
  "completionMode": "explicit",
  "compaction": {
    "enabled": true,
    "reserveTokens": 5000
  }
}
JSON

for n in $(seq -w 1 "$TURNS"); do
  cat > "$ROOT/in/file-$n.txt" <<EOF
turn $n source line one
symbols-$n: alpha beta gamma, punctuation stays.
mixedCase-$n: CacheReuseMustStayStable
EOF
  tr '[:lower:]' '[:upper:]' < "$ROOT/in/file-$n.txt" > "$ROOT/out/file-$n.expected"
done

line_count() {
  "${SSH[@]}" "wc -l < '$LLAMA_LOG_PATH'" | tr -d '[:space:]'
}

fetch_log_since() {
  local start="$1"
  local dest="$2"
  "${SSH[@]}" "tail -n +$((start + 1)) '$LLAMA_LOG_PATH'" > "$dest"
}

request_count() {
  find "$REQUEST_DIR" -maxdepth 1 -name '*.json' | wc -l | tr -d '[:space:]'
}

request_path_for_index() {
  printf '%s/%06d.json' "$REQUEST_DIR" "$1"
}

compaction_event_count() {
  if ! find "$SESSION_DIR" -type f -name '*.jsonl' -print -quit | grep -q .; then
    printf '0\n'
    return
  fi
  { grep -Rci '"type":"compaction"' "$SESSION_DIR" 2>/dev/null || true; } | awk -F: '{sum += $2} END {print sum + 0}'
}

max_prompt_eval_tokens() {
  local file="$1"
  awk '
    /prompt eval time =/ {
      for (i = 1; i <= NF; i++) {
        if ($i == "/") {
          value = $(i + 1) + 0
          if (value > max) max = value
        }
      }
    }
    END { print max + 0 }
  ' "$file"
}

verify_prompt_stability() {
  local turn="$1"
  local req_before="$2"
  local req_after="$3"
  local compaction_before="$4"
  local compaction_after="$5"
  local compacted="0"

  if [[ "$compaction_after" -gt "$compaction_before" ]]; then
    compacted="1"
    printf 'turn %s compaction detected; prompt-stability and prompt-eval baselines reset\n' "$(printf "%02d" "$turn")"
  fi

  if [[ "$req_after" -le "$req_before" ]]; then
    printf 'turn %s emitted no provider requests\n' "$(printf "%02d" "$turn")" >&2
    return 96
  fi

  python3 "$ROOT/prompt_guard.py" \
    "$PROMPT_CHECK_DIR/last-prompt.json" \
    "$(request_path_for_index "$((req_before + 1))")" \
    "$(request_path_for_index "$req_after")" \
    "$(printf "%02d" "$turn")" \
    "$compacted"
}

run_turn() {
  local turn="$1"
  local n
  n="$(printf "%02d" "$turn")"
  local before after_log stdout stderr exit_code max_eval req_before req_after compaction_before compaction_after
  before="$(line_count)"
  req_before="$(request_count)"
  compaction_before="$(compaction_event_count)"
  stdout="$ROOT/logs/turn-$n.out"
  stderr="$ROOT/logs/turn-$n.err"
  after_log="$ROOT/logs/turn-$n.llama.log"

  printf 'turn %s start\n' "$n"
  set +e
  (
    cd "$ROOT"
    P_CODING_AGENT_DIR="$CFG" p \
      --provider mini-pc-smoke \
      --model "$MODEL_ID" \
      --session-dir "$SESSION_DIR" \
      --session-id "$SESSION_ID" \
      --approve \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-themes \
      --no-context-files \
      --max-tokens 1024 \
      -p "Turn $n of $TURNS. Use the read tool to read in/file-$n.txt. Convert every alphabetic letter in that file to uppercase while preserving digits, punctuation, spaces, and newlines. Use the write tool to write exactly the transformed text to out/file-$n.txt. Do not use bash for this turn. Then call finish_work."
  ) >"$stdout" 2>"$stderr"
  exit_code=$?
  set -e
  fetch_log_since "$before" "$after_log"

  if [[ "$exit_code" -ne 0 ]]; then
    printf 'turn %s failed with exit %s\n' "$n" "$exit_code" >&2
    tail -n 80 "$stderr" >&2 || true
    return "$exit_code"
  fi

  req_after="$(request_count)"
  compaction_after="$(compaction_event_count)"
  verify_prompt_stability "$turn" "$req_before" "$req_after" "$compaction_before" "$compaction_after"

  if grep -q 'cannot continue from message role: assistant' "$stdout" "$stderr"; then
    printf 'turn %s hit cannot-continue assistant-role regression\n' "$n" >&2
    return 91
  fi

  if ! diff -u \
    <(perl -0pe 's/\n?\z/\n/' "$ROOT/out/file-$n.expected") \
    <(perl -0pe 's/\n?\z/\n/' "$ROOT/out/file-$n.txt") \
    > "$ROOT/logs/turn-$n.diff"; then
    printf 'turn %s output mismatch\n' "$n" >&2
    cat "$ROOT/logs/turn-$n.diff" >&2
    return 92
  fi

  if [[ "$turn" -gt 1 ]] && grep -q 'forcing full prompt re-processing' "$after_log"; then
    if [[ "$compaction_after" -le "$compaction_before" ]]; then
      printf 'turn %s full-prefill warning detected before compaction\n' "$n" >&2
      grep 'forcing full prompt re-processing' "$after_log" >&2
      return 93
    fi
  fi

  max_eval="$(max_prompt_eval_tokens "$after_log")"
  if [[ "$turn" -gt 1 && "$max_eval" -gt "$MAX_PROMPT_EVAL_POST_FIRST" && "$compaction_after" -le "$compaction_before" ]]; then
    printf 'turn %s prompt eval too high before compaction: %s > %s\n' "$n" "$max_eval" "$MAX_PROMPT_EVAL_POST_FIRST" >&2
    grep 'prompt eval time =' "$after_log" >&2 || true
    return 94
  fi

  printf 'turn %s ok max_prompt_eval=%s\n' "$n" "$max_eval"
}

run_interruption_probe() {
  local before after_log stdout stderr pid
  before="$(line_count)"
  stdout="$ROOT/logs/interruption.out"
  stderr="$ROOT/logs/interruption.err"
  after_log="$ROOT/logs/interruption.llama.log"

  printf 'interruption probe start\n'
  (
    cd "$ROOT"
    P_CODING_AGENT_DIR="$CFG" p \
      --provider mini-pc-smoke \
      --model "$MODEL_ID" \
      --session-dir "$SESSION_DIR" \
      --session-id "$SESSION_ID" \
      --approve \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-themes \
      --no-context-files \
      --max-tokens 4096 \
      -p "Interruption probe. Before using any tool or finish_work, write a long numbered list from 1 to 1000 with a short cache-stability sentence for each number. After the list, call finish_work."
  ) >"$stdout" 2>"$stderr" &
  pid=$!
  sleep 6
  if kill -0 "$pid" 2>/dev/null; then
    kill -INT "$pid" 2>/dev/null || true
    sleep 2
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  wait "$pid" || true
  fetch_log_since "$before" "$after_log"
  if grep -q 'cannot continue from message role: assistant' "$stdout" "$stderr"; then
    printf 'interruption probe hit assistant-role regression\n' >&2
    return 95
  fi
  printf 'interruption probe done\n'
}

printf 'root %s\n' "$ROOT"
printf 'model %s\n' "$MODEL_ID"
printf 'initial status\n'
"${SSH[@]}" "curl -fsS --max-time 10 http://127.0.0.1:$ORCHESTRATOR_PORT/api/status | jq '{total_active_requests,total_queue_depth,workers:[.workers[] | select(.id==\"mini-pc\" or .id==\"lms-micro\") | {id,machine_id,server_id,status,current_model,active_requests,queue_depth,target_load}]}'"

for turn in $(seq 1 "$TURNS"); do
  if [[ "$turn" -eq 9 ]]; then
    printf 'cold idle pause before turn 09\n'
    sleep 20
  fi
  if [[ "$turn" -eq 14 ]]; then
    run_interruption_probe
  fi
  run_turn "$turn"
done

printf 'queue probe start\n'
QUEUE_A="$ROOT/logs/queue-a.out"
QUEUE_B="$ROOT/logs/queue-b.out"
(
  cd "$ROOT"
  P_CODING_AGENT_DIR="$CFG" p \
    --provider mini-pc-smoke \
    --model "$MODEL_ID" \
    --session-dir "$SESSION_DIR" \
    --session-id "p-cache-queue-a" \
    --approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files \
    --max-tokens 2048 \
    -p "Queue probe A. Write a numbered list from 1 to 500, then call finish_work."
) >"$QUEUE_A" 2>"$ROOT/logs/queue-a.err" &
PID_A=$!
sleep 1
(
  cd "$ROOT"
  P_CODING_AGENT_DIR="$CFG" p \
    --provider mini-pc-smoke \
    --model "$MODEL_ID" \
    --session-dir "$SESSION_DIR" \
    --session-id "p-cache-queue-b" \
    --approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files \
    --max-tokens 512 \
    -p "Queue probe B. Reply with exactly QUEUE_B_DONE, then call finish_work."
) >"$QUEUE_B" 2>"$ROOT/logs/queue-b.err" &
PID_B=$!
sleep 3
"${SSH[@]}" "curl -fsS --max-time 10 http://127.0.0.1:$ORCHESTRATOR_PORT/api/status | jq '{total_active_requests,total_queue_depth,workers:[.workers[] | select(.id==\"mini-pc\") | {id,status,active_requests,queue_depth}]}'" > "$ROOT/logs/queue-status.json"
cat "$ROOT/logs/queue-status.json"
wait "$PID_A" || true
wait "$PID_B" || true
printf 'queue probe done\n'

printf 'final status\n'
"${SSH[@]}" "curl -fsS --max-time 10 http://127.0.0.1:$ORCHESTRATOR_PORT/api/status | jq '{total_active_requests,total_queue_depth,workers:[.workers[] | select(.id==\"mini-pc\" or .id==\"lms-micro\") | {id,status,current_model,active_requests,queue_depth,switching_to}]}'"

printf 'summary\n'
grep -h 'prompt eval time =' "$ROOT"/logs/turn-*.llama.log | awk '
  {
    for (i = 1; i <= NF; i++) {
      if ($i == "/") {
        value = $(i + 1) + 0
        count += 1
        if (value > max) max = value
      }
    }
  }
  END { printf "prompt_eval_entries=%d max_prompt_eval=%d\n", count, max + 0 }
'
