import { lstatSync, readFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCACertificates } from "node:tls";

export function verifiedCertifiedProxyCa(): string[] | undefined {
  const path = join(homedir(), ".p", "agent", "ca.pem");
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error("Certified proxy CA must be a regular, unlinked file");
  }
  return [...getCACertificates("default"), readFileSync(path, "utf8")];
}
