from pathlib import Path


session_path = Path("packages/coding-agent/src/core/agent-session.ts")
session = session_path.read_text()
before_hook, separator, after_hook = session.partition("\t\tthis.agent.afterToolCall")
if not separator:
    raise RuntimeError("afterToolCall boundary not found")
if "this._reconcileSuccessfulFinishWorkState();" in before_hook:
    raise RuntimeError("pre-execution reconciliation is still present")
post_marker = '''toolCall.name === FINISH_WORK_TOOL_NAME &&
\t\t\t\tgetFinishWorkStatus(args) === "success" &&
\t\t\t\t!nextIsError'''
if post_marker not in after_hook:
    raise RuntimeError("post-execution reconciliation is missing")
if 'item.status === "failed" || item.status === "blocked"' not in session:
    raise RuntimeError("success gate does not preserve failed/blocked blockers")

prompt_path = Path("packages/coding-agent/src/core/system-prompt.ts")
prompt = prompt_path.read_text()
if "A successful call automatically reconciles stale not_started or in_progress plan statuses" not in prompt:
    raise RuntimeError("completion prompt was not updated")

test_path = Path("packages/coding-agent/test/suite/regressions/finish-work-auto-prepend.test.ts")
tests = test_path.read_text()
start_marker = '\\tit("does not reconcile when a success payload fails validation"'
start = tests.find(start_marker)
if start == -1:
    raise RuntimeError("failure-path regression block not found")
end = tests.rfind("\n});")
if end <= start:
    raise RuntimeError("regression suite closing marker not found")
fixed_block = tests[start:end].replace("\\t", "\t")
tests = tests[:start] + fixed_block + tests[end:]
if "\\tit(" in tests:
    raise RuntimeError("literal tab escapes remain in regression tests")
test_path.write_text(tests)
