from pathlib import Path


path = Path("packages/coding-agent/test/suite/regressions/finish-work-auto-prepend.test.ts")
text = path.read_text()
old_responses = '''\t\t\tharness.setResponses([
\t\t\t\tfauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfinishCall("invalid success", {
\t\t\t\t\t\tremainingWork: ["Inspect the requested file"],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfinishCall("partially complete", {
\t\t\t\t\t\tstatus: "partial",
\t\t\t\t\t\tremainingWork: ["Inspect the requested file"],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t]);'''
new_responses = '''\t\t\tharness.setResponses([
\t\t\t\tfauxAssistantMessage(updateStateCall("Do all tracked work"), { stopReason: "toolUse" }),
\t\t\t\tfauxAssistantMessage(
\t\t\t\t\tfinishCall("invalid success", {
\t\t\t\t\t\tremainingWork: ["Inspect the requested file"],
\t\t\t\t\t}),
\t\t\t\t\t{ stopReason: "toolUse" },
\t\t\t\t),
\t\t\t]);'''
old_assertions = '''\t\t\tconst finishEnds = toolEndEvents(harness, "finish_work");
\t\t\texpect(finishEnds).toHaveLength(2);
\t\t\texpect(finishEnds[0]?.isError).toBe(true);
\t\t\texpect(JSON.stringify(finishEnds[0]?.result.content)).toContain("validation error");
\t\t\texpect(finishEnds[1]?.isError).toBe(false);'''
new_assertions = '''\t\t\tconst finishEnds = toolEndEvents(harness, "finish_work");
\t\t\texpect(finishEnds).toHaveLength(1);
\t\t\texpect(finishEnds[0]?.isError).toBe(true);
\t\t\texpect(JSON.stringify(finishEnds[0]?.result.content)).toContain("validation error");'''
for label, old, new in (
    ("responses", old_responses, new_responses),
    ("assertions", old_assertions, new_assertions),
):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)
path.write_text(text)
