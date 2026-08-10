import React from "react";

const FEATURES = [
  {
    icon: "🔍",
    title: "Local Semantic Code Indexing",
    desc: "Integrated background daemon (`com.dst.p.code-index`) combining Qdrant vector retrieval with dense & sparse embeddings for sub-second repo search.",
  },
  {
    icon: "🤖",
    title: "Unified Multi-Provider AI",
    desc: "Single abstraction layer across OpenAI, Anthropic, Google Gemini, and custom local models via `@dst0/p-ai` with structured output support.",
  },
  {
    icon: "🧠",
    title: "Context Compaction & Rules",
    desc: "Automatic session history compaction, rules injection, repo-map generation, and subagent workflow orchestration.",
  },
  {
    icon: "🖥️",
    title: "Differential TUI Engine",
    desc: "Built-in terminal UI framework (`@dst0/p-tui`) with high-performance differential screen rendering and custom keybindings.",
  },
  {
    icon: "🛡️",
    title: "Containerization & Micro-VMs",
    desc: "Flexible isolation patterns: Gondolin Linux micro-VM routing, Docker containerization, and OpenShell policy controls.",
  },
  {
    icon: "📦",
    title: "Monorepo Architecture",
    desc: "Modular TypeScript workspace split into core agent runtime, AI provider SDK, TUI library, CLI, and code indexer.",
  },
];

export const Features: React.FC = () => {
  return (
    <section className="section">
      <div className="container">
        <h2 className="section-title">Engineered for Autonomous Coding</h2>
        <p className="section-subtitle">
          Built for speed, accuracy, and full control over developer context and tool calling.
        </p>

        <div className="grid-3">
          {FEATURES.map((feat, idx) => (
            <div key={idx} className="glass-card">
              <div className="feature-icon">{feat.icon}</div>
              <h3 className="feature-title">{feat.title}</h3>
              <p className="feature-desc">{feat.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
