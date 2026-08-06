import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const docsDir = path.join(repoRoot, "packages/coding-agent/docs");
const docsJsonPath = path.join(docsDir, "docs.json");
const outputJsonPath = path.join(repoRoot, "packages/site/src/docsData.json");

if (!fs.existsSync(docsJsonPath)) {
  console.error("docs.json not found at", docsJsonPath);
  process.exit(1);
}

const docsConfig = JSON.parse(fs.readFileSync(docsJsonPath, "utf-8"));
const filesContent = {};

const files = fs.readdirSync(docsDir);
for (const file of files) {
  if (file.endsWith(".md")) {
    const filePath = path.join(docsDir, file);
    filesContent[file] = fs.readFileSync(filePath, "utf-8");
  }
}

const docsData = {
  navigation: docsConfig.navigation,
  redirects: docsConfig.redirects || [],
  files: filesContent,
};

const outputDir = path.dirname(outputJsonPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputJsonPath, JSON.stringify(docsData, null, 2), "utf-8");
console.log(`Successfully generated docsData.json with ${Object.keys(filesContent).length} files.`);
