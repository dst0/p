/**
 * Verification ledger — deterministic record of required pre-commit/pre-push checks.
 *
 * Every required command executed by the agent is recorded with its exit code,
 * truncation status, and log pointer. Before git commit, git push, and
 * finish_work(status="success"), the ledger is consulted: every required
 * record must have status "passed".
 */

/** Result status of a verification command */
export type VerificationStatus = "passed" | "failed" | "unknown";

/** Record of a single verification command execution */
export interface VerificationRecord {
	/** Command that was executed */
	command: string;
	/** Whether this command is a required gate (e.g. ./test.sh, npm run check) */
	required: boolean;
	/** Process exit code (undefined if killed/cancelled) */
	exitCode: number | undefined;
	/** Signal that terminated the process */
	signal?: string;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Pointer to full log file (if truncated) */
	fullLogPointer?: string;
	/** ISO timestamp when command started */
	startedAt: string;
	/** ISO timestamp when command finished */
	finishedAt: string;
	/** Computed status */
	status: VerificationStatus;
	/** Optional reason for manual override */
	overrideReason?: string;
}

/** Summary of the current ledger state */
export interface LedgerEvaluation {
	/** Whether all required verifications have passed */
	allPassed: boolean;
	/** Records that are required but not passed */
	failures: VerificationRecord[];
	/** Total record count */
	totalRecords: number;
}

/** Default commands that are treated as required verification gates */
const REQUIRED_COMMANDS = new Set(["./test.sh", "npm run check", "npm test", "./reinstall.sh"]);

function isRequiredCommand(command: string): boolean {
	const trimmed = command.trim();
	for (const required of REQUIRED_COMMANDS) {
		if (trimmed === required || trimmed.endsWith(` ${required}`)) {
			return true;
		}
	}
	return false;
}

function computeStatus(
	required: boolean,
	exitCode: number | undefined,
	signal: string | undefined,
): VerificationStatus {
	if (signal !== undefined) {
		return "failed";
	}
	if (exitCode === undefined) {
		return "unknown";
	}
	if (!required) {
		return "passed";
	}
	return exitCode === 0 ? "passed" : "failed";
}

export class VerificationLedger {
	private records: VerificationRecord[] = [];

	/**
	 * Record a command execution result.
	 */
	public record(
		command: string,
		options: {
			exitCode: number | undefined;
			signal?: string;
			truncated: boolean;
			fullLogPointer?: string;
		},
	): VerificationRecord {
		const now = new Date().toISOString();
		const required = isRequiredCommand(command);
		const status = computeStatus(required, options.exitCode, options.signal);

		const record: VerificationRecord = {
			command,
			required,
			exitCode: options.exitCode,
			signal: options.signal,
			truncated: options.truncated,
			fullLogPointer: options.fullLogPointer,
			startedAt: now,
			finishedAt: now,
			status,
		};

		this.records.push(record);
		return record;
	}

	/**
	 * Explicitly mark a command as required (not in the default set).
	 */
	public markRequired(command: string): void {
		const record = this.records.find((r) => r.command === command);
		if (record) {
			record.required = true;
			record.status = computeStatus(true, record.exitCode, record.signal);
		}
	}

	/**
	 * Override a failed record with an explicit reason.
	 * Requires user confirmation before use.
	 */
	public override(record: VerificationRecord, reason: string): void {
		record.overrideReason = reason;
		record.status = "passed";
	}

	/**
	 * Evaluate the ledger. Returns whether all required verifications passed.
	 */
	public evaluate(): LedgerEvaluation {
		const requiredRecords = this.records.filter((r) => r.required);
		const failures = requiredRecords.filter((r) => r.status === "failed");

		return {
			allPassed: failures.length === 0,
			failures,
			totalRecords: this.records.length,
		};
	}

	/**
	 * Block if there are failed required verifications.
	 * Returns null if all passed, or the evaluation with failures.
	 */
	public gate(): LedgerEvaluation | null {
		const evaluation = this.evaluate();
		return evaluation.allPassed ? null : evaluation;
	}

	/**
	 * Get the latest record for a command (most recent execution).
	 */
	public latest(command: string): VerificationRecord | undefined {
		const matching = this.records.filter((r) => r.command === command);
		return matching.length > 0 ? matching[matching.length - 1] : undefined;
	}

	/**
	 * Get all records.
	 */
	public getRecords(): ReadonlyArray<VerificationRecord> {
		return this.records;
	}

	/**
	 * Clear all records (new session).
	 */
	public clear(): void {
		this.records = [];
	}
}

export function createVerificationLedger(): VerificationLedger {
	return new VerificationLedger();
}

/**
 * Check if a command should be treated as a required verification.
 */
export function isVerificationCommand(command: string): boolean {
	return isRequiredCommand(command);
}
