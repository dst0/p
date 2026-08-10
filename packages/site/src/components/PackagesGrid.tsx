import React from "react";

const PACKAGES = [
  {
    name: "@dst0/p",
    path: "packages/coding-agent",
    desc: "Interactive coding agent CLI with automatic context, memory, rules, and repo-map injection.",
    tags: ["CLI", "Agent", "Interactive"],
  },
  {
    name: "@dst0/p-agent-core",
    path: "packages/agent",
    desc: "Agent runtime engine with tool execution loop, state management, and subagent orchestration.",
    tags: ["Runtime", "Tools", "State"],
  },
  {
    name: "@dst0/p-ai",
    path: "packages/ai",
    desc: "Unified multi-provider LLM API supporting OpenAI, Anthropic, Google Gemini, and custom providers.",
    tags: ["LLM", "Multi-Provider", "API"],
  },
  {
    name: "@dst0/p-code-index",
    path: "packages/code-index",
    desc: "Local hybrid semantic repository indexing with Qdrant vector store and dense/sparse retrieval.",
    tags: ["Indexing", "Vector DB", "Qdrant"],
  },
  {
    name: "@dst0/p-tui",
    path: "packages/tui",
    desc: "Terminal UI framework with high-speed differential screen rendering and custom themes.",
    tags: ["TUI", "Terminal", "UI"],
  },
];

export const PackagesGrid: React.FC = () => {
  return (
    <section className="section">
      <div className="container">
        <h2 className="section-title">Monorepo Packages</h2>
        <p className="section-subtitle">
          Modular, decoupled components that can be consumed together or independently.
        </p>

        <div className="grid-3">
          {PACKAGES.map((pkg, idx) => (
            <div key={idx} className="glass-card package-card">
              <div>
                <div className="package-name">{pkg.name}</div>
                <p className="feature-desc" style={{ marginBottom: "1rem" }}>{pkg.desc}</p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                {pkg.tags.map((t, i) => (
                  <span key={i} className="badge" style={{ margin: 0, padding: "0.2rem 0.6rem", fontSize: "0.75rem" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
