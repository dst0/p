import * as os from "node:os";
import * as path from "node:path";
import type { MarkdownTheme } from "@dst0/p-tui";
import { VERSION } from "../../../../config.ts";
import type { SourceInfo } from "../../../../core/source-info.ts";
import { isInstallTelemetryEnabled } from "../../../../core/telemetry.ts";
import {
  getChangelogPath,
  getNewEntries,
  normalizeChangelogLinks,
  parseChangelog,
} from "../../../../utils/changelog.ts";
import { parseGitUrl } from "../../../../utils/git.ts";
import { getCwdRelativePath } from "../../../../utils/paths.ts";
import { getPiUserAgent } from "../../../../utils/pi-user-agent.ts";
import { getMarkdownTheme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_getChangelogForDisplay(self: InteractiveMode): string | undefined {
  // Skip changelog for resumed/continued sessions (already have messages)
  if (self.session.state.messages.length > 0) {
    return undefined;
  }

  const lastVersion = self.settingsManager.getLastChangelogVersion();
  const changelogPath = getChangelogPath();
  const entries = parseChangelog(changelogPath);

  if (!lastVersion) {
    // Fresh install - record the version, send telemetry, don't show changelog
    self.settingsManager.setLastChangelogVersion(VERSION);
    self.reportInstallTelemetry(VERSION);
    return undefined;
  }

  const newEntries = getNewEntries(entries, lastVersion);
  if (newEntries.length > 0) {
    self.settingsManager.setLastChangelogVersion(VERSION);
    self.reportInstallTelemetry(VERSION);
    return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
  }

  return undefined;
}

export function do_reportInstallTelemetry(self: InteractiveMode, version: string): void {
  if (process.env.P_OFFLINE) {
    return;
  }

  if (!isInstallTelemetryEnabled(self.settingsManager)) {
    return;
  }

  void fetch(`https://p.dev/api/report-install?version=${encodeURIComponent(version)}`, {
    headers: {
      "User-Agent": getPiUserAgent(version),
    },
    signal: AbortSignal.timeout(5000),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function do_getMarkdownThemeWithSettings(self: InteractiveMode): MarkdownTheme {
  return {
    ...getMarkdownTheme(),
    codeBlockIndent: self.settingsManager.getCodeBlockIndent(),
  };
}

export function do_formatDisplayPath(_self: InteractiveMode, p: string): string {
  const home = os.homedir();
  let result = p;

  // Replace home directory with ~
  if (result.startsWith(home)) {
    result = `~${result.slice(home.length)}`;
  }

  return result;
}

export function do_formatExtensionDisplayPath(self: InteractiveMode, path: string): string {
  let result = self.formatDisplayPath(path);
  result = result.replace(/\/index\.ts$/, "").replace(/\/index\.js$/, "");
  return result;
}

export function do_formatContextPath(self: InteractiveMode, p: string): string {
  const cwd = path.resolve(self.sessionManager.getCwd());
  const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
  const relativePath = getCwdRelativePath(absolutePath, cwd);
  if (relativePath !== undefined) {
    return relativePath;
  }

  return self.formatDisplayPath(absolutePath);
}

export function do_getStartupExpansionState(self: InteractiveMode): boolean {
  return self.options.verbose || self.toolOutputExpanded;
}

export function do_getShortPath(self: InteractiveMode, fullPath: string, sourceInfo?: SourceInfo): string {
  const baseDir = sourceInfo?.baseDir;
  if (baseDir && self.isPackageSource(sourceInfo)) {
    const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
    if (
      relativePath &&
      relativePath !== "." &&
      !relativePath.startsWith("..") &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    ) {
      return relativePath.replace(/\\/g, "/");
    }
  }

  const source = sourceInfo?.source ?? "";
  const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (npmMatch && source.startsWith("npm:")) {
    return npmMatch[2];
  }

  const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
  if (gitMatch && source.startsWith("git:")) {
    return gitMatch[1];
  }

  return self.formatDisplayPath(fullPath);
}

export function do_getCompactPathLabel(self: InteractiveMode, resourcePath: string, sourceInfo?: SourceInfo): string {
  const shortPath = self.getShortPath(resourcePath, sourceInfo);
  const normalizedPath = shortPath.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
  if (segments.length > 0) {
    return segments[segments.length - 1]!;
  }
  return shortPath;
}

export function do_getCompactPackageSourceLabel(_self: InteractiveMode, sourceInfo?: SourceInfo): string {
  const source = sourceInfo?.source ?? "";
  if (source.startsWith("npm:")) {
    return source.slice("npm:".length) || source;
  }

  const gitSource = parseGitUrl(source);
  if (gitSource) {
    return gitSource.path || source;
  }

  return source;
}

export function do_getCompactExtensionLabel(
  self: InteractiveMode,
  resourcePath: string,
  sourceInfo?: SourceInfo,
): string {
  if (!self.isPackageSource(sourceInfo)) {
    return self.getCompactPathLabel(resourcePath, sourceInfo);
  }

  const sourceLabel = self.getCompactPackageSourceLabel(sourceInfo);
  if (!sourceLabel) {
    return self.getCompactPathLabel(resourcePath, sourceInfo);
  }

  const shortPath = self.getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
  const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
  const parsedPath = path.posix.parse(packagePath);

  if (parsedPath.name === "index") {
    return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
  }

  return `${sourceLabel}:${packagePath}`;
}
