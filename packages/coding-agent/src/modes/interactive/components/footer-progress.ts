import { isAbsolute, relative, resolve, sep } from "node:path";

export const QUEUED_FOOTER_ANIMATION_MS = 250;
const QUEUED_SPINNER_FRAMES = ["|", "/", "-", "\\"];

/**
 * Render a compact visual progress bar.
 * Uses block characters for filled/empty portions.
 */
export function renderProgressBar(percent: number, barWidth: number): string {
  const filled = Math.round((percent / 100) * barWidth);
  const clampedFilled = Math.max(0, Math.min(barWidth, filled));
  const empty = barWidth - clampedFilled;
  return "▓".repeat(clampedFilled) + "░".repeat(empty);
}

/**
 * Compute a trend indicator for generation speed.
 * Returns ↑ if speed increased, ↓ if decreased, → if stable, or ▸ for first reading.
 */
export function computeGenTrend(currentRate: number, previousRate: number | undefined): string {
  if (previousRate === undefined) return "▸";
  const diff = currentRate - previousRate;
  if (diff > 5) return "↑";
  if (diff < -5) return "↓";
  return "→";
}

export function formatQueuedProgress(queued: { position: number; queuedAhead: number; queuedAt?: number }): string {
  const ahead = queued.queuedAhead === 0 ? "next" : `${queued.queuedAhead} ahead`;
  const parts = [`#${queued.position}, ${ahead}`];
  if (queued.queuedAt !== undefined) {
    const elapsed = Math.max(0, Math.floor((Date.now() - queued.queuedAt) / 1000));
    parts.push(`${elapsed}s`);
  }
  return parts.join(" ");
}

export function formatQueuedSpinner(now = Date.now()): string {
  const frameIndex = Math.floor(now / QUEUED_FOOTER_ANIMATION_MS) % QUEUED_SPINNER_FRAMES.length;
  return QUEUED_SPINNER_FRAMES[frameIndex] ?? QUEUED_SPINNER_FRAMES[0];
}

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
export function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;

  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}
