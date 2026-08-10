import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { arch, platform } from "os";
import { join } from "path";
import { TOOLS, TOOLS_DIR } from "./constants.ts";
import {
  downloadFile,
  findBinaryRecursively,
  getLatestVersion,
  getTarExtractionArgs,
  runExtractionCommand,
} from "./download-management.ts";

export function getToolDownloadPaths(
  binaryName: string,
  assetName: string,
  targetPlatform: string,
  downloadId = `${binaryName}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
): { archivePath: string; binaryPath: string; extractDir: string } {
  const binaryExt = targetPlatform === "win32" ? ".exe" : "";
  return {
    archivePath: join(TOOLS_DIR, `${downloadId}_${assetName}`),
    binaryPath: join(TOOLS_DIR, binaryName + binaryExt),
    extractDir: join(TOOLS_DIR, `extract_tmp_${downloadId}`),
  };
}

export function moveDownloadedBinary(extractedBinary: string, binaryPath: string): void {
  try {
    renameSync(extractedBinary, binaryPath);
  } catch (error) {
    if (!existsSync(binaryPath)) throw error;
  }
}

export function extractTarGzArchive(archivePath: string, extractDir: string, assetName: string): void {
  const failure = runExtractionCommand("tar", getTarExtractionArgs(archivePath, extractDir));
  if (failure) {
    throw new Error(`Failed to extract ${assetName}: ${failure}`);
  }
}

export function getWindowsTarCommand(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (systemRoot) {
    const systemTar = join(systemRoot, "System32", "tar.exe");
    if (existsSync(systemTar)) {
      return systemTar;
    }
  }
  return "tar.exe";
}

export function extractZipArchive(archivePath: string, extractDir: string, assetName: string): void {
  const failures: string[] = [];

  if (platform() === "win32") {
    // Windows ships bsdtar as tar.exe, which supports zip files. Prefer the
    // System32 binary over Git Bash's GNU tar, which does not handle zip archives.
    const tarFailure = runExtractionCommand(getWindowsTarCommand(), ["xf", archivePath, "-C", extractDir]);
    if (!tarFailure) return;
    failures.push(tarFailure);

    const script =
      "& { param($archive, $destination) $ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }";
    const powershellFailure = runExtractionCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      archivePath,
      extractDir,
    ]);
    if (!powershellFailure) return;
    failures.push(powershellFailure);
  } else {
    const unzipFailure = runExtractionCommand("unzip", ["-q", archivePath, "-d", extractDir]);
    if (!unzipFailure) return;
    failures.push(unzipFailure);

    const tarFailure = runExtractionCommand("tar", ["xf", archivePath, "-C", extractDir]);
    if (!tarFailure) return;
    failures.push(tarFailure);
  }

  throw new Error(`Failed to extract ${assetName}: ${failures.join("; ")}`);
}

export async function downloadTool(tool: "fd" | "rg"): Promise<string> {
  const config = TOOLS[tool];
  if (!config) throw new Error(`Unknown tool: ${tool}`);

  const plat = platform();
  const architecture = arch();

  // Get latest version
  let version = await getLatestVersion(config.repo);
  if (tool === "fd" && plat === "darwin" && architecture === "x64") {
    version = "10.3.0";
  }

  // Get asset name for this platform
  const assetName = config.getAssetName(version, plat, architecture);
  if (!assetName) {
    throw new Error(`Unsupported platform: ${plat}/${architecture}`);
  }

  // Create tools directory
  mkdirSync(TOOLS_DIR, { recursive: true });

  const downloadUrl = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`;
  const { archivePath, binaryPath, extractDir } = getToolDownloadPaths(config.binaryName, assetName, plat);
  const binaryExt = plat === "win32" ? ".exe" : "";

  // Download
  await downloadFile(downloadUrl, archivePath);

  // Extract into a unique temp directory. fd and rg downloads can run concurrently
  // during startup, so sharing a fixed directory causes races.
  mkdirSync(extractDir, { recursive: true });

  try {
    if (assetName.endsWith(".tar.gz")) {
      extractTarGzArchive(archivePath, extractDir, assetName);
    } else if (assetName.endsWith(".zip")) {
      extractZipArchive(archivePath, extractDir, assetName);
    } else {
      throw new Error(`Unsupported archive format: ${assetName}`);
    }

    // Find the binary in extracted files. Some archives contain files directly
    // at root, others nest under a versioned subdirectory.
    const binaryFileName = config.binaryName + binaryExt;
    const extractedDir = join(extractDir, assetName.replace(/\.(tar\.gz|zip)$/, ""));
    const extractedBinaryCandidates = [join(extractedDir, binaryFileName), join(extractDir, binaryFileName)];
    let extractedBinary = extractedBinaryCandidates.find((candidate) => existsSync(candidate));

    if (!extractedBinary) {
      extractedBinary = findBinaryRecursively(extractDir, binaryFileName) ?? undefined;
    }

    if (extractedBinary) {
      moveDownloadedBinary(extractedBinary, binaryPath);
    } else {
      throw new Error(`Binary not found in archive: expected ${binaryFileName} under ${extractDir}`);
    }

    // Make executable (Unix only)
    if (plat !== "win32") {
      chmodSync(binaryPath, 0o755);
    }
  } finally {
    // Cleanup
    rmSync(archivePath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }

  return binaryPath;
}
