import { performance } from "node:perf_hooks";

export type BenchmarkTimeoutKind = "hard_deadline" | "inactivity" | "wall_clock";
export type BenchmarkTimeoutMode = "semantic_progress" | "wall_clock";
export type BenchmarkTerminationReason =
  | "capture"
  | "hard_deadline"
  | "inactivity"
  | "interruption"
  | "marker"
  | "recording"
  | "wall_clock";

interface BenchmarkTurnTimeoutOptions {
  hardTimeoutMs?: number;
  onTimeout(kind: BenchmarkTimeoutKind): void;
  progressGraceMs: number;
  startedAt: number;
  timeoutMode: BenchmarkTimeoutMode;
  timeoutMs: number;
}

export class BenchmarkTurnTimeoutController {
  private activityDeadline: number;
  private activityTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly hardDeadline: number | undefined;
  private hardTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly nominalDeadline: number;
  private readonly onTimeout: (kind: BenchmarkTimeoutKind) => void;
  private readonly progressGraceMs: number;
  private stopped = false;
  private readonly timeoutMode: BenchmarkTimeoutMode;

  constructor(options: BenchmarkTurnTimeoutOptions) {
    this.nominalDeadline = options.startedAt + options.timeoutMs;
    this.activityDeadline = this.nominalDeadline;
    this.hardDeadline = options.hardTimeoutMs === undefined ? undefined : options.startedAt + options.hardTimeoutMs;
    this.onTimeout = options.onTimeout;
    this.progressGraceMs = options.progressGraceMs;
    this.timeoutMode = options.timeoutMode;
    this.armHardDeadline();
    this.armActivityDeadline();
  }

  renewSemanticProgress(): void {
    if (this.stopped || this.timeoutMode !== "semantic_progress") return;
    this.activityDeadline = Math.max(this.nominalDeadline, performance.now() + this.progressGraceMs);
    this.armActivityDeadline();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.activityTimer = undefined;
    this.hardTimer = undefined;
  }

  private armActivityDeadline(): void {
    if (this.stopped) return;
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(
      () => this.reachActivityDeadline(),
      Math.max(0, this.activityDeadline - performance.now()),
    );
  }

  private armHardDeadline(): void {
    if (this.stopped || this.hardDeadline === undefined) return;
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.hardTimer = setTimeout(() => this.reachHardDeadline(), Math.max(0, this.hardDeadline - performance.now()));
  }

  private reachActivityDeadline(): void {
    if (this.stopped) return;
    const now = performance.now();
    if (this.hardDeadline !== undefined && now >= this.hardDeadline) {
      this.finish("hard_deadline");
      return;
    }
    if (now < this.activityDeadline) {
      this.armActivityDeadline();
      return;
    }
    this.finish(this.timeoutMode === "semantic_progress" ? "inactivity" : "wall_clock");
  }

  private reachHardDeadline(): void {
    if (this.stopped || this.hardDeadline === undefined) return;
    if (performance.now() < this.hardDeadline) {
      this.armHardDeadline();
      return;
    }
    this.finish("hard_deadline");
  }

  private finish(kind: BenchmarkTimeoutKind): void {
    if (this.stopped) return;
    this.stop();
    this.onTimeout(kind);
  }
}
