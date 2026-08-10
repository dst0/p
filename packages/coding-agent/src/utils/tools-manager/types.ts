export interface DownloadLockOptions {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  staleMs?: number;
}

export interface ToolConfig {
  name: string;
  repo: string; // GitHub repo (e.g., "sharkdp/fd")
  binaryName: string; // Name of the binary inside the archive
  systemBinaryNames?: string[]; // Alternative system command names to try before downloading
  tagPrefix: string; // Prefix for tags (e.g., "v" for v1.0.0, "" for 1.0.0)
  getAssetName: (version: string, plat: string, architecture: string) => string | null;
}
