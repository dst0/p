import path from "node:path";
import { loadWorkspaceCodeRagSettings } from "@dst0/p-code-index";
import type { IndexingDaemonOptions } from "./indexing-daemon/types.ts";

export function createIndexingDaemonOptions(agentDir: string): IndexingDaemonOptions {
  const configPath = path.join(agentDir, "code-rag.json");
  const settings = loadWorkspaceCodeRagSettings({
    workspaceRoot: agentDir,
    dataDirectory: path.join(agentDir, "code-rag"),
    userConfigPath: configPath,
    repositoryConfigPath: path.join(agentDir, ".p", "code-rag.json"),
  });
  return {
    agentDir,
    qdrantBinary: settings.qdrantBinary,
    qdrantDataDirectory: settings.qdrantDataDirectory,
    pythonExecutable: settings.pythonExecutable,
    embeddingModel: settings.embeddingModel,
    embeddingConfigPath: configPath,
  };
}
