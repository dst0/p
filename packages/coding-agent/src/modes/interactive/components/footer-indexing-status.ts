import chalk from "chalk";
import type { IndexStatus } from "../../../core/indexing-service.ts";

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function formatEta(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 120) return `${rounded}s`;
  const minutes = rounded / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

export function formatIndexingStatus(status: IndexStatus): string {
  if (status.decision === "disabled") return "🔎 OFF";
  if (status.decision === "unknown") return "🔎 ?";
  if (!status.serviceRunning) return "🔎 ON!";
  if (status.ragState === "queued") return "🔎 queued";
  if (status.ragState === "initializing" || status.ragState === "updating") {
    const progress = status.progress;
    const isUpdating = status.ragState === "updating";
    const updateIcon = chalk.bgWhite.bold.green("▲");
    const updatePrefix = isUpdating ? `${updateIcon} ` : "";
    if (!progress) return isUpdating ? `🔎 ${updateIcon} update` : "🔎 init";
    const files =
      progress.processedFiles !== undefined && progress.totalFiles !== undefined
        ? ` ${formatTokens(progress.processedFiles)}/${formatTokens(progress.totalFiles)}`
        : "";
    if (progress.phase === "scanning") return `🔎 ${updatePrefix}scanning${files}`;
    if (progress.phase === "preparing") return `🔎 ${updatePrefix}preparing${files}`;
    if (progress.phase === "finalizing") return `🔎 ${updatePrefix}finalizing`;

    const reused = progress.reusedChunks;
    const recalculatedTotal = progress.recalculatedTotal;
    const recalculatedDone = progress.recalculatedChunks ?? 0;

    let percent: string;
    let chunks: string;
    let breakdown: string;

    if (isUpdating && recalculatedTotal !== undefined && recalculatedTotal > 0) {
      const isPreserving = reused !== undefined && reused > 0 && (progress.processedChunks ?? 0) < reused;
      if (isPreserving) {
        const preservedDone = progress.processedChunks ?? 0;
        percent = `${Math.min(100, Math.max(0, (100 * preservedDone) / Math.max(reused, 1))).toFixed(1)}%`;
        chunks = ` (${formatTokens(preservedDone)}/${formatTokens(reused)} preserved)`;
        breakdown = ` (${formatTokens(recalculatedTotal)} pending)`;
      } else {
        percent = `${Math.min(100, Math.max(0, (100 * recalculatedDone) / recalculatedTotal)).toFixed(1)}%`;
        chunks = ` (${formatTokens(recalculatedDone)}/${formatTokens(recalculatedTotal)} new chunks)`;
        breakdown = reused !== undefined && reused > 0 ? ` (${formatTokens(reused)} reused)` : "";
      }
    } else {
      percent = `${Math.min(100, Math.max(0, progress.percent)).toFixed(1)}%`;
      chunks =
        progress.processedChunks !== undefined && progress.totalChunks !== undefined
          ? ` (${formatTokens(progress.processedChunks)}/${formatTokens(progress.totalChunks)} chunks)`
          : "";
      breakdown =
        reused !== undefined && reused > 0 && recalculatedTotal !== undefined && recalculatedTotal > 0
          ? ` (${formatTokens(reused)} reused, ${formatTokens(recalculatedTotal)} new)`
          : reused !== undefined && reused > 0
            ? ` (${formatTokens(reused)} reused)`
            : recalculatedTotal !== undefined && recalculatedTotal > 0
              ? ` (${formatTokens(recalculatedTotal)} new)`
              : "";
    }

    const eta =
      progress.etaSeconds !== undefined && progress.etaSeconds > 0 ? ` (ETA: ${formatEta(progress.etaSeconds)})` : "";
    return `🔎 ${updatePrefix}${percent}${chunks}${breakdown}${eta}`;
  }
  if (
    status.lastError !== undefined ||
    status.ragState === "error" ||
    status.ragState === "partial" ||
    status.ragState === "unavailable" ||
    status.ragState === "disabled"
  ) {
    return "🔎 ON!";
  }
  if (status.ragState === "ready") {
    return "🔎: ✅";
  }
  return "🔎 ON";
}
