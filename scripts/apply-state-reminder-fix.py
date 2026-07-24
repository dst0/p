from __future__ import annotations

import re
from pathlib import Path

SOURCE_PATH = Path("packages/coding-agent/src/core/agent-session.ts")
TEST_PATH = Path("packages/coding-agent/test/suite/agent-session-state-update-tool.test.ts")
CHANGELOG_PATH = Path("packages/coding-agent/CHANGELOG.md")

REMINDER = (
    "After receiving the latest user message, call update_session_state first to record or revise "
    "the goal, plan, and next action before attempting any other tool call."
)

source = SOURCE_PATH.read_text()
source_pattern = re.compile(
    r"Before calling \$\{[^}\n]+\}, call update_session_state first to record or revise "
    r"the goal, plan, and next action for the latest user message\."
)
source, replacements = source_pattern.subn(REMINDER, source)
if replacements != 1:
    raise RuntimeError(f"Expected one session-state reminder replacement, found {replacements}")
SOURCE_PATH.write_text(source)

test = TEST_PATH.read_text()
constant_anchor = 'const PROGRESS_TOOL = "mark_session_progress";\n'
constant = f'const STATE_UPDATE_REMINDER =\n\t"{REMINDER}";\n'
if constant_anchor not in test:
    raise RuntimeError("Could not find test constant anchor")
test = test.replace(constant_anchor, constant_anchor + constant, 1)

old_assertion = '\t\t\texpect(JSON.stringify(readEnds[0]?.result.content)).toContain(UPDATE_TOOL);'
new_assertion = (
    '\t\t\tconst reminder = JSON.stringify(readEnds[0]?.result.content);\n'
    '\t\t\texpect(reminder).toContain(STATE_UPDATE_REMINDER);\n'
    '\t\t\texpect(reminder).not.toContain("Before calling");'
)
assertion_count = test.count(old_assertion)
if assertion_count != 2:
    raise RuntimeError(f"Expected two loose reminder assertions, found {assertion_count}")
test = test.replace(old_assertion, new_assertion)
TEST_PATH.write_text(test)

changelog = CHANGELOG_PATH.read_text()
changelog_anchor = (
    "### Fixed\n\n"
    "- Make task-verification gates self-explanatory after compaction: expose exact next actions, "
    "eligible evidence, required replay commands, and ready-to-use verification payloads through proactive status and every rejection.\n"
)
changelog_entry = (
    "- Clarify the session-state guard reminder around user-message timing instead of framing it as a prerequisite for the attempted tool call.\n"
)
if changelog_anchor not in changelog:
    raise RuntimeError("Could not find top Unreleased Fixed changelog anchor")
changelog = changelog.replace(changelog_anchor, changelog_anchor + changelog_entry, 1)
CHANGELOG_PATH.write_text(changelog)
