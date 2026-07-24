from __future__ import annotations

import textwrap
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


minimal_path = Path("packages/coding-agent/src/core/compaction/minimal-compaction.ts")
minimal = minimal_path.read_text()
minimal = replace_once(
    minimal,
    '''\tconst systemPromptTokens = typeof budget === "number" ? 0 : (budget.systemPromptTokens ?? 0);

\tfor (let index = 0; index < messages.length; index++) {''',
    '''\tconst systemPromptTokens = typeof budget === "number" ? 0 : (budget.systemPromptTokens ?? 0);
\tconst originalTexts = messages.map((message) => messageText(message));

\tfor (let index = 0; index < messages.length; index++) {''',
    "capture original message text",
)
minimal = replace_once(
    minimal,
    '''\t\tconst text = messageText(message);
\t\tif (text && estimateTokens(message) > keepRecentTokens) {''',
    '''\t\tconst text = originalTexts[index];
\t\tif (text && estimateTokens(message) > keepRecentTokens) {''',
    "initial truncation source",
)
minimal = replace_once(
    minimal,
    '''\t\t\tconst text = messageText(message);
\t\t\tif (!text || estimateTokens(message) <= maxTokens) continue;''',
    '''\t\t\tconst text = originalTexts[index];
\t\t\tif (!text || estimateTokens(message) <= maxTokens) continue;''',
    "progressive truncation source",
)
minimal_path.write_text(minimal)

test_path = Path("packages/coding-agent/test/agent-session-auto-compaction-queue.test.ts")
test = test_path.read_text()
test = replace_once(
    test,
    '''\trenderStructuredSessionCheckpoint: () => "compacted",''',
    '''\trenderMinimalCompactionCheckpoint: () => "compacted",
\trenderStructuredSessionCheckpoint: () => "compacted",''',
    "auto-compaction mock checkpoint export",
)
test_path.write_text(test)

Path(".github/workflows/ci.yml").write_text(
    textwrap.dedent(
        """\
        name: CI

        on:
          push:
            branches: [main]
          pull_request:
            branches: [main]

        concurrency:
          group: ci-${{ github.ref }}
          cancel-in-progress: true

        jobs:
          build-check-test:
            runs-on: [self-hosted, Linux, X64, mini-pc, p]
            steps:
              - name: Checkout
                uses: actions/checkout@v5

              - name: Setup Node.js
                uses: actions/setup-node@v5
                with:
                  node-version: 22

              - name: Install system dependencies
                run: |
                  sudo apt-get update
                  sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev fd-find ripgrep
                  sudo ln -sf "$(which fdfind)" /usr/local/bin/fd

              - name: Install dependencies
                run: npm ci --ignore-scripts

              - name: Build
                run: npm run build

              - name: Check
                run: npm run check

              - name: Test
                run: |
                  mkdir -p "$RUNNER_TEMP/p-ci-home"
                  HOME="$RUNNER_TEMP/p-ci-home" ./test.sh
        """
    )
)

Path(__file__).unlink()
print("Applied final compaction regression fixes and restored CI.")
