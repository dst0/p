import React, { useState } from "react";
import { TerminalDemo } from "./TerminalDemo.js";

interface HeroProps {
  onReadDocs: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onReadDocs }) => {
  const [copied, setCopied] = useState(false);
  const installCmd = "./install.sh";

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(installCmd);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="hero">
      <div className="container">
        <div className="badge">
          <span>v0.4.131 • Opinionated Agent Harness Mono Repo</span>
        </div>
        <h1 className="hero-title">
          Autonomous Coding Agent & <br />
          <span className="gradient-text">Local Code Indexing</span>
        </h1>
        <p className="hero-subtitle">
          An opinionated fork of the pi coding agent with automatic context management, repo-map injection, hybrid Qdrant retrieval, and multi-provider LLM API.
        </p>

        <div className="hero-actions">
          <div className="command-box">
            <span>$ {installCmd}</span>
            <button className="copy-btn" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button className="btn btn-primary" onClick={onReadDocs}>
            Read Documentation
          </button>
          <a
            href="https://github.com/dst0/p"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            GitHub Repo
          </a>
        </div>

        <TerminalDemo />
      </div>
    </section>
  );
};
