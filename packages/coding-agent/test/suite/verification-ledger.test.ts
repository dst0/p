import { describe, expect, it } from "vitest";
import { VerificationLedger, isVerificationCommand } from "../../src/core/verification-ledger.ts";

describe("VerificationLedger", () => {
	it("records a command and computes status", () => {
		const ledger = new VerificationLedger();
		const rec = ledger.record("./test.sh", { exitCode: 0, truncated: false });
		expect(rec.status).toBe("passed");
		expect(rec.exitCode).toBe(0);
		expect(rec.required).toBe(true);
	});

	it("marks failed required command as failure", () => {
		const ledger = new VerificationLedger();
		const rec = ledger.record("npm run check", { exitCode: 1, truncated: false });
		expect(rec.status).toBe("failed");
		expect(rec.required).toBe(true);
	});

	it("marks non-required command as optional", () => {
		const ledger = new VerificationLedger();
		const rec = ledger.record("echo hello", { exitCode: 0, truncated: false });
		expect(rec.required).toBe(false);
	});

	it("gate returns null when no required commands recorded", () => {
		const ledger = new VerificationLedger();
		ledger.record("echo hi", { exitCode: 0, truncated: false });
		expect(ledger.gate()).toBeNull();
	});

	it("gate returns null when all required commands pass", () => {
		const ledger = new VerificationLedger();
		ledger.record("./test.sh", { exitCode: 0, truncated: false });
		ledger.record("npm run check", { exitCode: 0, truncated: false });
		expect(ledger.gate()).toBeNull();
	});

	it("gate returns failures when required command fails", () => {
		const ledger = new VerificationLedger();
		ledger.record("./test.sh", { exitCode: 1, truncated: false });
		ledger.record("npm run check", { exitCode: 0, truncated: false });
		const gate = ledger.gate();
		expect(gate).not.toBeNull();
		expect(gate!.failures.length).toBe(1);
		expect(gate!.failures[0].command).toBe("./test.sh");
		expect(gate!.failures[0].exitCode).toBe(1);
	});

	it("gate returns multiple failures", () => {
		const ledger = new VerificationLedger();
		ledger.record("./test.sh", { exitCode: 1, truncated: false });
		ledger.record("npm run check", { exitCode: 2, truncated: false });
		const gate = ledger.gate();
		expect(gate).not.toBeNull();
		expect(gate!.failures.length).toBe(2);
	});

	it("recognizes default required commands", () => {
		expect(isVerificationCommand("./test.sh")).toBe(true);
		expect(isVerificationCommand("npm run check")).toBe(true);
		expect(isVerificationCommand("npm test")).toBe(true);
		expect(isVerificationCommand("./reinstall.sh")).toBe(true);
		expect(isVerificationCommand("echo hello")).toBe(false);
	});

	it("exitCode undefined is treated as unknown", () => {
		const ledger = new VerificationLedger();
		const rec = ledger.record("./test.sh", { exitCode: undefined, truncated: false });
		expect(rec.status).toBe("unknown");
	});

	it("records fullLogPointer when provided", () => {
		const ledger = new VerificationLedger();
		const rec = ledger.record("./test.sh", { exitCode: 0, truncated: true, fullLogPointer: "/tmp/out.log" });
		expect(rec.fullLogPointer).toBe("/tmp/out.log");
	});

	it("gate is cleared after clear() call", () => {
		const ledger = new VerificationLedger();
		ledger.record("./test.sh", { exitCode: 1, truncated: false });
		expect(ledger.gate()).not.toBeNull();
		ledger.clear();
		expect(ledger.gate()).toBeNull();
	});
});
