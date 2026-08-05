import React from "react";

export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="container">
        <p style={{ marginBottom: "0.5rem" }}>
          <strong>p</strong> — Agent Harness Mono Repo • Released under MIT License
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Source code on <a href="https://github.com/dst0/p" target="_blank" rel="noreferrer" style={{ color: "var(--accent-cyan)" }}>GitHub</a> • Join our <a href="https://discord.com/invite/3cU7Bz4UPx" target="_blank" rel="noreferrer" style={{ color: "var(--accent-cyan)" }}>Discord Community</a>
        </p>
      </div>
    </footer>
  );
};
