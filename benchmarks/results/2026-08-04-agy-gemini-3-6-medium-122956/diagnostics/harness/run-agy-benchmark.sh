#!/bin/zsh
set -o pipefail

output="/Users/dst/dev/p/benchmarks/results/2026-08-04-agy-gemini-3-6-medium-$(date -u +%H%M%S)"
mkdir -p "$output/diagnostics/startup-probe"
cp /tmp/agy-probe-v110.LPDMDV/stdout.jsonl "$output/diagnostics/startup-probe/stdout.jsonl"
cp /tmp/agy-probe-v110.LPDMDV/stderr.log "$output/diagnostics/startup-probe/stderr.log"
cat > "$output/diagnostics/startup-probe/state.json" <<'EOF'
{
  "status": "passed",
  "executable": "/Users/dst/.local/bin/agy",
  "version": "1.1.10",
  "authenticated": true,
  "requestedModelDisplayName": "Gemini 3.6 Medium",
  "resolvedModelId": "gemini-3.6-flash-medium",
  "outputFormat": "stream-json",
  "printTimeout": "2m"
}
EOF
printf '%s\n' "$output" > /tmp/agy-benchmark-output.txt
cd /Users/dst/dev/p
node /tmp/benchmark-agy.js \
  --agents agy \
  --agy-model gemini-3.6-flash-medium \
  --runs 1 \
  --max-runtime-seconds 4800 \
  --output "$output" \
  2>&1 | tee "$output/run.log"
