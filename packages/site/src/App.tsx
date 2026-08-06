import React, { useState } from "react";
import { Header } from "./components/Header.js";
import { Hero } from "./components/Hero.js";
import { Features } from "./components/Features.js";
import { PackagesGrid } from "./components/PackagesGrid.js";
import { DocsViewer } from "./components/DocsViewer.js";
import { Footer } from "./components/Footer.js";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"home" | "docs" | "packages">("home");

  return (
    <div className="app">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {activeTab === "home" && (
        <>
          <Hero onReadDocs={() => setActiveTab("docs")} />
          <Features />
          <PackagesGrid />
        </>
      )}

      {activeTab === "packages" && (
        <div style={{ paddingTop: "2rem" }}>
          <PackagesGrid />
        </div>
      )}

      {activeTab === "docs" && <DocsViewer />}

      <Footer />
    </div>
  );
};

export default App;
