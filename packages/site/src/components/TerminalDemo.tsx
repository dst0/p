import React, { useState } from "react";

const DEMO_PRESETS = [
  {
    cmd: "p -p \"Explain the system architecture\"",
    output: [
      { text: "✔ Indexed 42 files (Qdrant hybrid dense/sparse search ready)", type: "success" },
      { text: "🧠 Thinking: Analyzing monorepo layout across 5 packages...", type: "accent" },
      { text: "The `p` monorepo consists of 5 core packages:", type: "text" },
      { text: "  • @dst0/p-ai          Unified LLM API (OpenAI, Anthropic, Gemini)", type: "out" },
      { text: "  • @dst0/p-agent-core   Agent runtime, tool engine, compaction", type: "out" },
      { text: "  • @dst0/p-code-index  Qdrant local semantic vector search", type: "out" },
      { text: "  • @dst0/p-tui         Differential rendering terminal UI", type: "out" },
      { text: "  • @dst0/p             CLI entrypoint & rules harness", type: "out" },
    ],
  },
  {
    cmd: "p /index up",
    output: [
      { text: "⚡ Priority queue updated for current repository.", type: "accent" },
      { text: "Indexing daemon (com.dst.p.code-index) active.", type: "success" },
      { text: "Status: 100% synchronized (SHA-256 runtime version match)", type: "text" },
    ],
  },
  {
    cmd: "p -p \"Create a test file for the indexer\"",
    output: [
      { text: "📝 Tool Call: write_to_file -> test/indexing-version.test.ts", type: "accent" },
      { text: "✔ Running validation checks...", type: "success" },
      { text: "Pass: 12 tests | 0 errors | 0.42s", type: "success" },
    ],
  },
];

export const TerminalDemo: React.FC = () => {
  const [selectedPreset, setSelectedPreset] = useState(0);
  const activePreset = DEMO_PRESETS[selectedPreset];

  return (
    <div className="terminal-window">
      <div className="terminal-header">
        <div className="terminal-dots">
          <div className="dot dot-red"></div>
          <div className="dot dot-yellow"></div>
          <div className="dot dot-green"></div>
        </div>
        <div className="terminal-title">p-cli — zsh — 80x24</div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {DEMO_PRESETS.map((p, idx) => (
            <button
              key={idx}
              className="copy-btn"
              style={{
                background: selectedPreset === idx ? "var(--accent-cyan)" : "rgba(255,255,255,0.08)",
                color: selectedPreset === idx ? "#000" : "#fff",
              }}
              onClick={() => setSelectedPreset(idx)}
            >
              Demo {idx + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="terminal-body">
        <div style={{ marginBottom: "1rem" }}>
          <span className="terminal-prompt">user@mac ~ % </span>
          <span className="terminal-cmd">{activePreset.cmd}</span>
        </div>
        {activePreset.output.map((line, i) => (
          <div
            key={i}
            className={
              line.type === "success"
                ? "terminal-success"
                : line.type === "accent"
                ? "terminal-accent"
                : line.type === "out"
                ? "terminal-out"
                : ""
            }
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
};
