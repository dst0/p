import React from "react";

interface HeaderProps {
  activeTab: "home" | "docs" | "packages";
  setActiveTab: (tab: "home" | "docs" | "packages") => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="header">
      <div className="container header-inner">
        <a href="#" className="logo" onClick={(e) => { e.preventDefault(); setActiveTab("home"); }}>
          <div className="logo-badge">p</div>
          <span>p agent</span>
        </a>
        <nav>
          <ul className="nav-links">
            <li>
              <span
                className={`nav-link ${activeTab === "home" ? "active" : ""}`}
                onClick={() => setActiveTab("home")}
              >
                Overview
              </span>
            </li>
            <li>
              <span
                className={`nav-link ${activeTab === "packages" ? "active" : ""}`}
                onClick={() => setActiveTab("packages")}
              >
                Packages
              </span>
            </li>
            <li>
              <span
                className={`nav-link ${activeTab === "docs" ? "active" : ""}`}
                onClick={() => setActiveTab("docs")}
              >
                Documentation
              </span>
            </li>
            <li>
              <a
                href="https://github.com/dst0/p"
                target="_blank"
                rel="noreferrer"
                className="nav-link"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href="https://discord.com/invite/3cU7Bz4UPx"
                target="_blank"
                rel="noreferrer"
                className="nav-link"
              >
                Discord
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
};
