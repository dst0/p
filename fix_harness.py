import re

with open('packages/agent/src/harness/agent-harness.ts', 'r') as f:
    content = f.read()

pattern = r"""let res = "";
                if \(Array\.isArray\(content\)\) \{
                  for \(const c of content\) \{
                    if \(c\.type === "text"\) res \+= c\.text;
                  \}
                \}
                return res;"""

def replace_match(match):
    return """let res = "";
                if (Array.isArray(content)) {
                  for (const c of content) {
                    if (c && typeof c === "object" && "type" in c && c.type === "text") res += c.text;
                  }
                }
                return res;"""

content = re.sub(pattern, replace_match, content)

pattern2 = r"""let res = "";
                if \(Array\.isArray\(targetEntry\.content\)\) \{
                  for \(const c of targetEntry\.content\) \{
                    if \(c\.type === "text"\) res \+= c\.text;
                  \}
                \}
                return res;"""

def replace_match2(match):
    return """let res = "";
                if (Array.isArray(targetEntry.content)) {
                  for (const c of targetEntry.content) {
                    if (c && typeof c === "object" && "type" in c && c.type === "text") res += c.text;
                  }
                }
                return res;"""

content = re.sub(pattern2, replace_match2, content)

with open('packages/agent/src/harness/agent-harness.ts', 'w') as f:
    f.write(content)
