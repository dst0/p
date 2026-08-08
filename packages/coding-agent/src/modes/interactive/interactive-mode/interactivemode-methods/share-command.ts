import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "child_process";
import { getShareViewerUrl } from "../../../../config.ts";
import { SessionImportFileNotFoundError } from "../../../../core/agent-session-runtime.ts";
import { MissingSessionCwdError } from "../../../../core/session-cwd.ts";
import { BorderedLoader } from "../../components/bordered-loader.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleImportCommand(self: InteractiveMode, text: string): Promise<void> {
  const inputPath = self.getPathCommandArgument(text, "/import");
  if (!inputPath) {
    self.showError("Usage: /import <path.jsonl>");
    return;
  }

  const confirmed = await self.showExtensionConfirm("Import session", `Replace current session with ${inputPath}?`);
  if (!confirmed) {
    self.showStatus("Import cancelled");
    return;
  }

  try {
    if (self.loadingAnimation) {
      self.loadingAnimation.stop();
      self.loadingAnimation = undefined;
    }
    self.statusContainer.clear();
    const result = await self.runtimeHost.importFromJsonl(inputPath);
    if (result.cancelled) {
      self.showStatus("Import cancelled");
      return;
    }
    self.renderCurrentSessionState();
    self.showStatus(`Session imported from: ${inputPath}`);
  } catch (error: unknown) {
    if (error instanceof MissingSessionCwdError) {
      const selectedCwd = await self.promptForMissingSessionCwd(error);
      if (!selectedCwd) {
        self.showStatus("Import cancelled");
        return;
      }
      const result = await self.runtimeHost.importFromJsonl(inputPath, selectedCwd);
      if (result.cancelled) {
        self.showStatus("Import cancelled");
        return;
      }
      self.renderCurrentSessionState();
      self.showStatus(`Session imported from: ${inputPath}`);
      return;
    }
    if (error instanceof SessionImportFileNotFoundError) {
      self.showError(`Failed to import session: ${error.message}`);
      return;
    }
    await self.handleFatalRuntimeError("Failed to import session", error);
  }
}

export async function do_handleShareCommand(self: InteractiveMode): Promise<void> {
  // Check if gh is available and logged in
  try {
    const authResult = spawnSync("gh", ["auth", "status"], {
      encoding: "utf-8",
    });
    if (authResult.status !== 0) {
      self.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
      return;
    }
  } catch {
    self.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
    return;
  }

  // Export to a temp file
  const tmpFile = path.join(os.tmpdir(), "session.html");
  try {
    await self.session.exportToHtml(tmpFile);
  } catch (error: unknown) {
    self.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
    return;
  }

  // Show cancellable loader, replacing the editor
  const loader = new BorderedLoader(self.ui, theme, "Creating gist...");
  self.editorContainer.clear();
  self.editorContainer.addChild(loader);
  self.ui.setFocus(loader);
  self.ui.requestRender();

  const restoreEditor = () => {
    loader.dispose();
    self.editorContainer.clear();
    self.editorContainer.addChild(self.editor);
    self.ui.setFocus(self.editor);
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  };

  // Create a secret gist asynchronously
  let proc: ReturnType<typeof spawn> | null = null;

  loader.onAbort = () => {
    proc?.kill();
    restoreEditor();
    self.showStatus("Share cancelled");
  };

  try {
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((resolve) => {
      proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => resolve({ stdout, stderr, code }));
    });

    if (loader.signal.aborted) return;

    restoreEditor();

    if (result.code !== 0) {
      const errorMsg = result.stderr?.trim() || "Unknown error";
      self.showError(`Failed to create gist: ${errorMsg}`);
      return;
    }

    // Extract gist ID from the URL returned by gh
    // gh returns something like: https://gist.github.com/username/GIST_ID
    const gistUrl = result.stdout?.trim();
    const gistId = gistUrl?.split("/").pop();
    if (!gistId) {
      self.showError("Failed to parse gist ID from gh output");
      return;
    }

    // Create the preview URL
    const previewUrl = getShareViewerUrl(gistId);
    self.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
  } catch (error: unknown) {
    if (!loader.signal.aborted) {
      restoreEditor();
      self.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
