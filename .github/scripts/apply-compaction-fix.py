from __future__ import annotations

import re
import textwrap
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return updated


def patch_minimal_compaction() -> None:
    path = Path("packages/coding-agent/src/core/compaction/minimal-compaction.ts")
    text = path.read_text()

    text = regex_once(
        text,
        r"\t\t\tdetails: \{\n\t\t\t\t\.\.\.rawDetails,\n\t\t\t\tmarkdownSummary: raw\.summary,\n\t\t\t\} satisfies CompactionDetails,",
        """\t\t\tdetails: {
\t\t\t\treadFiles: rawDetails?.readFiles ?? [],
\t\t\t\tmodifiedFiles: rawDetails?.modifiedFiles ?? [],
\t\t\t\taudit: rawDetails?.audit,
\t\t\t\tmarkdownSummary: raw.summary,
\t\t\t\tstructuredState: rawDetails?.structuredState,
\t\t\t} satisfies CompactionDetails,""",
        "fallback compaction details",
    )

    corrected_replace = """function replaceFirstTextBlock<T extends { type: string; text?: string }>(
\tblocks: T[],
\ttext: string,
): T[] {
\tlet replaced = false;
\tconst result: T[] = [];
\tfor (const block of blocks) {
\t\tif (block.type !== \"text\") {
\t\t\tresult.push(block);
\t\t\tcontinue;
\t\t}
\t\tif (replaced) continue;
\t\treplaced = true;
\t\tresult.push({ ...block, text });
\t}
\treturn result;
}

function replaceText(message: AgentMessage, text: string): AgentMessage {
\tswitch (message.role) {
\t\tcase \"user\":
\t\tcase \"custom\":
\t\t\tif (typeof message.content === \"string\") return { ...message, content: text } as AgentMessage;
\t\t\treturn {
\t\t\t\t...message,
\t\t\t\tcontent: replaceFirstTextBlock(message.content, text),
\t\t\t} as AgentMessage;
\t\tcase \"toolResult\":
\t\t\treturn {
\t\t\t\t...message,
\t\t\t\tcontent: replaceFirstTextBlock(message.content, text),
\t\t\t} as ToolResultMessage;
\t\tcase \"assistant\":
\t\t\treturn {
\t\t\t\t...message,
\t\t\t\tcontent: replaceFirstTextBlock(message.content, text),
\t\t\t} as AssistantMessage;
\t\tcase \"bashExecution\":
\t\t\treturn { ...message, output: text };
\t\tdefault:
\t\t\treturn message;
\t}
}
"""
    text = regex_once(
        text,
        r"function replaceText\(message: AgentMessage, text: string\): AgentMessage \{.*?\n\}\n(?=\nfunction truncateHeadAndTail)",
        corrected_replace.rstrip(),
        "replaceText implementation",
    )
    text = replace_once(
        text,
        '\tlet result = [...lines.slice(0, headCount), ...lines.slice(-tailCount)].join("\\n");',
        '\tconst tail = tailCount > 0 ? lines.slice(-tailCount) : [];\n\tlet result = [...lines.slice(0, headCount), ...tail].join("\\n");',
        "head-tail line selection",
    )
    text = replace_once(
        text,
        "\t\t[500, 10, 4000],\n\t\t[50, 4, 800],\n\t\t[0, 0, 0],",
        "\t\t[500, 10, 4000],\n\t\t[50, 4, 800],\n\t\t[0, 2, 240],\n\t\t[0, 0, 0],",
        "progressive truncation passes",
    )
    path.write_text(text)


def patch_agent_session() -> None:
    path = Path("packages/coding-agent/src/core/agent-session.ts")
    text = path.read_text()
    text = replace_once(
        text,
        "\trenderStructuredSessionCheckpoint,\n\trenderWorkingSessionState,",
        "\trenderMinimalCompactionCheckpoint,\n\trenderStructuredSessionCheckpoint,\n\trenderWorkingSessionState,",
        "minimal checkpoint import",
    )
    text = replace_once(
        text,
        "\t\tconst summary = renderStructuredSessionCheckpoint(state, settings.renderedStateMaxTokens);",
        "\t\tconst summary = renderMinimalCompactionCheckpoint(state, settings.renderedStateMaxTokens);",
        "deterministic checkpoint renderer",
    )
    old_state = """\t\t\tconst baseState = this._getCurrentStructuredSessionState(pathEntries);
\t\t\tconst state = createStructuredSessionState({
\t\t\t\tsessionId: this.sessionManager.getSessionId(),
\t\t\t\tprevious: baseState,
\t\t\t\tsummary: modelResult.summary,
\t\t\t\tentries: pathEntries,
\t\t\t\treadFiles,
\t\t\t\tmodifiedFiles,
\t\t\t\taudit,
\t\t\t\ttimestamp: new Date().toISOString(),
\t\t\t});"""
    new_state = """\t\t\tconst baseState = this._getCurrentStructuredSessionState(pathEntries);
\t\t\tconst state =
\t\t\t\tmodelDetails?.structuredState && isStructuredSessionState(modelDetails.structuredState)
\t\t\t\t\t? modelDetails.structuredState
\t\t\t\t\t: createStructuredSessionState({
\t\t\t\t\t\tsessionId: this.sessionManager.getSessionId(),
\t\t\t\t\t\tprevious: baseState,
\t\t\t\t\t\tsummary: modelResult.summary,
\t\t\t\t\t\tentries: pathEntries,
\t\t\t\t\t\treadFiles,
\t\t\t\t\t\tmodifiedFiles,
\t\t\t\t\t\taudit,
\t\t\t\t\t\ttimestamp: new Date().toISOString(),
\t\t\t\t\t});"""
    text = replace_once(text, old_state, new_state, "model structured state preference")
    text = replace_once(
        text,
        "\t\t\t\t\tmarkdownSummary: modelResult.summary,",
        "\t\t\t\t\tmarkdownSummary: modelDetails?.markdownSummary ?? modelResult.summary,",
        "raw markdown preservation",
    )
    path.write_text(text)


def restore_ci() -> None:
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


patch_minimal_compaction()
patch_agent_session()
restore_ci()
Path(__file__).unlink()
print("Applied compaction fixes, restored CI, and removed temporary helper.")
