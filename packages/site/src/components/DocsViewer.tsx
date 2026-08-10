import React, { useState } from "react";
import docsData from "../docsData.json";
import { renderMarkdown } from "../utils/markdown.js";

export const DocsViewer: React.FC = () => {
  const [activeFile, setActiveFile] = useState<string>("index.md");

  const rawMarkdown = (docsData.files as Record<string, string>)[activeFile] || "# File Not Found";
  const htmlContent = renderMarkdown(rawMarkdown);

  return (
    <div className="container">
      <div className="docs-container">
        <aside className="docs-sidebar">
          {docsData.navigation.map((group, idx) => (
            <div key={idx}>
              <div className="docs-group-title">{group.title}</div>
              {group.items.map((item, itemIdx) => (
                <div
                  key={itemIdx}
                  className={`docs-item ${activeFile === item.path ? "active" : ""}`}
                  onClick={() => setActiveFile(item.path)}
                >
                  {item.title}
                </div>
              ))}
            </div>
          ))}
        </aside>

        <main className="docs-content">
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </main>
      </div>
    </div>
  );
};
