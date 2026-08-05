import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    return marked.parse(content) as string;
  } catch (err) {
    console.error("Failed to render markdown:", err);
    return `<p style="color: red;">Error rendering content</p>`;
  }
}
