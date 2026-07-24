from pathlib import Path

source_path = Path("packages/coding-agent/src/core/task-verification.ts")
source = source_path.read_text()

format_start = source.index("\t\tconst replayDescriptor = this.requiredBaselineReplayDescriptor();")
format_end = source.index("\tprivate baselineReplayInstruction(): string {", format_start)
source = source[:format_start] + '''\t\tconst replayDescriptor = this.requiredBaselineReplayDescriptor();
\t\tif (replayDescriptor) {
\t\t\tconst replayEvidence = this.findEvidence(
\t\t\t\t(item) =>
\t\t\t\t\titem.mutationRevision === this.state.mutationRevision &&
\t\t\t\t\titem.toolName === "bash" &&
\t\t\t\t\titem.descriptor === replayDescriptor,
\t\t\t);

\t\t\tif (replayEvidence?.isError) {
\t\t\t\treturn [
\t\t\t\t\t"NEXT REQUIRED ACTION: the required baseline replay still fails; repair the implementation before recording final success.",
\t\t\t\t\t`Failed replay command: ${replayEvidence.descriptor}`,
\t\t\t\t\t`Failed evidence: ${replayEvidence.ref} — ${replayEvidence.outputSummary || "no output summary"}`,
\t\t\t\t\t"After the next production mutation, rerun the same command and call action status again.",
\t\t\t\t].join("\\n");
\t\t\t}

\t\t\tif (!replayEvidence) {
\t\t\t\treturn [
\t\t\t\t\t"NEXT REQUIRED ACTION: rerun the exact scenario that established the baseline.",
\t\t\t\t\t`Required exact replay command: ${replayDescriptor}`,
\t\t\t\t\t`Only evidence from mutation revision ${this.state.mutationRevision} is eligible.`,
\t\t\t\t\t"Do not substitute another focused test, broad suite, lint, or typecheck for this replay.",
\t\t\t\t\t"After the successful replay, call action status again to receive the exact record_final payload.",
\t\t\t\t].join("\\n");
\t\t\t}

\t\t\treturn this.formatFinalRecordGuidance(
\t\t\t\t[replayEvidence],
\t\t\t\tthis.state.baseline.method === "failing_regression_test" ? "focused_test" : "manual_reproduction",
\t\t\t);
\t\t}

\t\tconst eligibleEvidence = this.findEligibleFinalEvidence();
\t\tif (eligibleEvidence) return this.formatFinalRecordGuidance(eligibleEvidence);

\t\treturn [
\t\t\t"NEXT REQUIRED ACTION: collect fresh semantic evidence for the current mutation revision before completion.",
\t\t\tthis.baselineReplayInstruction(),
\t\t\t`Only evidence from mutation revision ${this.state.mutationRevision} is eligible.`,
\t\t\t"After the successful run, call action status again to receive the exact record_final payload and evidence handle.",
\t\t].join("\\n");
\t}

''' + source[format_end:]

helper_start = source.index("\tprivate findEligibleFinalEvidence():")
helper_end = source.index("\tprivate findEvidence(", helper_start)
source = source[:helper_start] + '''\tprivate findEligibleFinalEvidence(): TaskVerificationEvidence[] | undefined {
\t\tconst current = [...this.evidence.values()].filter(
\t\t\t(item) => item.mutationRevision === this.state.mutationRevision && !item.isError,
\t\t);
\t\tconst newestFirst = current.slice().reverse();
\t\tconst focusedTest = newestFirst.find(
\t\t\t(item) =>
\t\t\t\titem.toolName === "bash" &&
\t\t\t\tTEST_PATTERN.test(item.descriptor) &&
\t\t\t\tFOCUSED_TEST_PATTERN.test(item.descriptor),
\t\t);
\t\tif (focusedTest) return [focusedTest];

\t\tconst manualReproduction = newestFirst.find(
\t\t\t(item) =>
\t\t\t\titem.toolName === "bash" &&
\t\t\t\t!TEST_PATTERN.test(item.descriptor) &&
\t\t\t\t!GENERIC_CHECK_PATTERN.test(item.descriptor) &&
\t\t\t\t!READ_ONLY_PATTERN.test(item.descriptor),
\t\t);
\t\tif (manualReproduction) return [manualReproduction];

\t\tconst taskText = `${this.state.taskContext ?? this.latestUserPrompt}\\n${this.state.taskSummary ?? ""}`;
\t\tconst behavioral = this.state.taskKind
\t\t\t? behavioralFinalRequired(this.state.taskKind, taskText)
\t\t\t: true;
\t\tconst highRisk = HIGH_RISK_PATTERN.test(taskText);
\t\tif (!behavioral && !highRisk) {
\t\t\tconst testSuite = newestFirst.find(
\t\t\t\t(item) => item.toolName === "bash" && TEST_PATTERN.test(item.descriptor),
\t\t\t);
\t\t\tif (testSuite) return [testSuite];
\t\t}

\t\tif (!behavioral) {
\t\t\tconst staticEvidence = current.filter((item) => STATIC_TOOLS.has(item.toolName));
\t\t\tif (staticEvidence.length >= 2) return staticEvidence.slice(-2);
\t\t}
\t\treturn undefined;
\t}

\tprivate finalMethodForEvidence(evidence: readonly TaskVerificationEvidence[]): FinalMethod {
\t\tif (evidence.length >= 2 && evidence.every((item) => STATIC_TOOLS.has(item.toolName))) {
\t\t\treturn "static_review";
\t\t}
\t\tconst primary = evidence[0];
\t\tif (!primary) return "manual_reproduction";
\t\tif (
\t\t\tprimary.toolName === "bash" &&
\t\t\tTEST_PATTERN.test(primary.descriptor) &&
\t\t\tFOCUSED_TEST_PATTERN.test(primary.descriptor)
\t\t) {
\t\t\treturn "focused_test";
\t\t}
\t\tif (primary.toolName === "bash" && TEST_PATTERN.test(primary.descriptor)) return "test_suite";
\t\treturn "manual_reproduction";
\t}

\tprivate formatFinalRecordGuidance(
\t\tevidence: readonly TaskVerificationEvidence[],
\t\tmethod: FinalMethod = this.finalMethodForEvidence(evidence),
\t): string {
\t\tconst refs = evidence.map((item) => item.ref);
\t\tconst evidenceLines = evidence.map((item) => `- ${item.ref}: ${item.descriptor}`);
\t\tconst payload = JSON.stringify({
\t\t\taction: "record_final",
\t\t\tfinal_method: method,
\t\t\tfinal_status: "passed",
\t\t\texpected_behavior: "the behavior that must now hold",
\t\t\tobserved_behavior: "what this evidence demonstrated",
\t\t\tevidence_refs: refs,
\t\t\tunresolved_failures: [],
\t\t});
\t\treturn [
\t\t\t"NEXT REQUIRED ACTION: record final verification using the successful semantic evidence already collected for the current mutation revision.",
\t\t\t`Eligible evidence:\\n${evidenceLines.join("\\n")}`,
\t\t\t`Use evidence_refs: ${JSON.stringify(refs)}`,
\t\t\t`Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
\t\t\tpayload,
\t\t].join("\\n");
\t}

''' + source[helper_end:]
source_path.write_text(source)

test_path = Path("packages/coding-agent/test/task-verification.test.ts")
tests = test_path.read_text()

import_anchor = "\tTASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE,\n"
if import_anchor not in tests:
    raise SystemExit("state import anchor not found")
tests = tests.replace(
    import_anchor,
    import_anchor + "\tTASK_VERIFICATION_STATE_CUSTOM_TYPE,\n",
    1,
)

new_tests = r'''

\tit("does not suggest unrelated passing evidence when an exact baseline replay is required", async () => {
\t\tconst sessionManager = SessionManager.inMemory();
\t\tconst baselineAgent = new Agent();
\t\tconst baselineController = createTaskVerificationController(sessionManager);
\t\tbaselineController.install(baselineAgent);
\t\tawait callVerificationTool(baselineController, {
\t\t\taction: "declare_task",
\t\t\ttask_kind: "bug_fix",
\t\t\ttask_summary: "Fix exact replay recovery after compaction",
\t\t});
\t\tawait callVerificationTool(baselineController, {
\t\t\taction: "authorize_baseline_test",
\t\t\ttest_paths: ["test/exact-replay.test.ts"],
\t\t});
\t\tawait afterTool(baselineAgent, "edit", {
\t\t\tpath: "test/exact-replay.test.ts",
\t\t\tedits: [{ oldText: "old", newText: "failing" }],
\t\t});
\t\tconst replayCommand = "vitest --run test/exact-replay.test.ts";
\t\tconst baselineHandle = evidenceHandle(
\t\t\tawait afterTool(
\t\t\t\tbaselineAgent,
\t\t\t\t"bash",
\t\t\t\t{ command: replayCommand },
\t\t\t\t{ isError: true, text: "expected failure" },
\t\t\t),
\t\t);
\t\tawait callVerificationTool(baselineController, {
\t\t\taction: "record_baseline",
\t\t\tbaseline_method: "failing_regression_test",
\t\t\thypothesis: "The existing implementation violates the required behavior",
\t\t\tconclusion: "The focused regression reproduces the defect",
\t\t\tevidence_refs: [baselineHandle],
\t\t\tunresolved_assumptions: [],
\t\t});
\t\tawait afterTool(baselineAgent, "edit", {
\t\t\tpath: "src/exact-replay.ts",
\t\t\tedits: [{ oldText: "old", newText: "new" }],
\t\t});
\t\tconst unrelatedHandle = evidenceHandle(
\t\t\tawait afterTool(
\t\t\t\tbaselineAgent,
\t\t\t\t"bash",
\t\t\t\t{ command: "vitest --run test/unrelated.test.ts" },
\t\t\t\t{ text: "passed" },
\t\t\t),
\t\t);

\t\tconst restored = createTaskVerificationController(sessionManager);
\t\tconst beforeReplay = await callVerificationTool(restored, { action: "status" });
\t\texpect(beforeReplay.text).toContain(`Required exact replay command: ${replayCommand}`);
\t\texpect(beforeReplay.text).toContain("Do not substitute another focused test");
\t\texpect(beforeReplay.text).not.toContain(`Use evidence_refs: ["${unrelatedHandle}"]`);
\t\texpect(beforeReplay.text).not.toContain('"action":"record_final"');

\t\tconst restoredAgent = new Agent();
\t\trestored.install(restoredAgent);
\t\tconst replayHandle = evidenceHandle(
\t\t\tawait afterTool(restoredAgent, "bash", { command: replayCommand }, { text: "passed" }),
\t\t);
\t\tconst afterReplay = await callVerificationTool(restored, { action: "status" });
\t\texpect(afterReplay.text).toContain(`Use evidence_refs: ["${replayHandle}"]`);
\t\texpect(afterReplay.text).toContain('"final_method":"focused_test"');
\t\texpect(afterReplay.text).toContain('"action":"record_final"');
\t});

\tit("offers a valid two-handle static-review payload for non-behavioral work", async () => {
\t\tconst { agent, controller } = createInstalledController();
\t\tawait callVerificationTool(controller, {
\t\t\taction: "declare_task",
\t\t\ttask_kind: "docs",
\t\t\ttask_summary: "Clarify verification documentation",
\t\t});
\t\tawait afterTool(agent, "edit", {
\t\t\tpath: "docs/verification.md",
\t\t\tedits: [{ oldText: "old", newText: "new" }],
\t\t});
\t\tconst first = evidenceHandle(await afterTool(agent, "read", { path: "docs/verification.md" }));
\t\tconst second = evidenceHandle(await afterTool(agent, "read", { path: "README.md" }));

\t\tconst status = await callVerificationTool(controller, { action: "status" });
\t\texpect(status.text).toContain('"final_method":"static_review"');
\t\texpect(status.text).toContain(`"evidence_refs":["${first}","${second}"]`);

\t\tconst final = await callVerificationTool(controller, {
\t\t\taction: "record_final",
\t\t\tfinal_method: "static_review",
\t\t\tfinal_status: "passed",
\t\t\texpected_behavior: "The documentation accurately describes verification recovery",
\t\t\tobserved_behavior: "Both relevant documents were inspected after the edit",
\t\t\tevidence_refs: [first, second],
\t\t\tunresolved_failures: [],
\t\t});
\t\texpect(final.isError).toBe(false);
\t});

\tit("uses persisted task context to preserve high-risk baseline guidance after restoration", async () => {
\t\tconst sessionManager = SessionManager.inMemory();
\t\tsessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
\t\t\tversion: 1,
\t\t\ttaskKind: "bug_fix",
\t\t\ttaskSummary: "Fix the reported issue",
\t\t\ttaskContext: "The daemon restart loses persisted indexing state and recovery repeats work",
\t\t\tmutationRevision: 0,
\t\t\tbaseline: {
\t\t\t\trequired: true,
\t\t\t\tstatus: "pending",
\t\t\t\tevidenceRefs: [],
\t\t\t\tauthorizedTestPaths: [],
\t\t\t\ttestSetupChanged: false,
\t\t\t},
\t\t\tfinal: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
\t\t\tupdatedAt: new Date().toISOString(),
\t\t});
\t\tconst agent = new Agent();
\t\tconst controller = createTaskVerificationController(sessionManager);
\t\tcontroller.install(agent);
\t\tawait afterTool(agent, "read", { path: "src/daemon.ts" });
\t\tawait afterTool(agent, "read", { path: "src/manifest.ts" });

\t\tconst status = await callVerificationTool(controller, { action: "status" });
\t\texpect(status.text).toContain("lifecycle/durability task");
\t\texpect(status.text).not.toContain('"baseline_method":"static_trace"');
\t});
'''.replace("\\t", "\t")

closing = "\n});\n"
index = tests.rfind(closing)
if index < 0:
    raise SystemExit("test suite closing anchor not found")
tests = tests[:index] + new_tests + tests[index:]
test_path.write_text(tests)
