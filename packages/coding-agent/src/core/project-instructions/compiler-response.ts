export function parseProjectInstructionCompilerResponse(
  value: string,
  isContractCandidate?: (candidate: unknown) => boolean,
): unknown {
  const trimmed = value.trim();
  try {
    return parseJsonObject(trimmed);
  } catch {
    // Some providers wrap an otherwise exact response in prose or a JSON fence.
  }
  const candidates = findBalancedObjects(trimmed);
  const parsed = candidates.flatMap((candidate) => {
    try {
      return [parseJsonObject(candidate)];
    } catch {
      return [];
    }
  });
  if (isContractCandidate) {
    const matching = parsed.filter(isContractCandidate);
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) {
      throw new Error("Instruction compiler response contained multiple contract objects");
    }
  }
  if (parsed.length !== 1) {
    throw new Error("Instruction compiler response must contain exactly one complete JSON object");
  }
  return parsed[0];
}

function parseJsonObject(value: string): unknown {
  assertUniqueTopLevelKeys(value);
  return JSON.parse(value) as unknown;
}

function assertUniqueTopLevelKeys(value: string): void {
  if (!value.startsWith("{")) return;
  const keys = new Set<string>();
  const stack = ["{"];
  let expectsKey = true;
  for (let index = 1; index < value.length && stack.length > 0; index += 1) {
    const character = value[index]!;
    if (/\s/u.test(character)) continue;
    if (character === '"') {
      const end = findJsonStringEnd(value, index);
      if (stack.length === 1 && expectsKey) {
        const key = JSON.parse(value.slice(index, end + 1)) as string;
        if (keys.has(key)) throw new Error(`Instruction compiler response repeated top-level key: ${key}`);
        keys.add(key);
        expectsKey = false;
      }
      index = end;
    } else if (character === "{" || character === "[") {
      stack.push(character);
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === "," && stack.length === 1) {
      expectsKey = true;
    }
  }
}

function findJsonStringEnd(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return index;
  }
  throw new Error("Instruction compiler response did not contain a complete JSON string");
}

function findBalancedObjects(value: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (depth === 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      candidates.push(value.slice(start, index + 1));
      start = -1;
    }
  }
  if (depth !== 0 || inString) {
    throw new Error("Instruction compiler response did not contain a complete JSON object");
  }
  return candidates;
}
