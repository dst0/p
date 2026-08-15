import { existsSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getAgentDir, getBundledSkillsDir } from "../config.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { loadSkillFromFile, loadSkillsFromDirInternal } from "./skills/discovery.ts";
import type { LoadSkillsOptions, LoadSkillsResult, Skill } from "./skills/types.ts";

export * from "./skills/discovery.ts";
export * from "./skills/formatting.ts";
export * from "./skills/types.ts";

/**
 * Load skills from all configured locations (bundled defaults, user global, project local, explicit paths).
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
  const { agentDir, skillPaths, includeDefaults, bundledSkillsDir } = options;

  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir());

  const skillMap = new Map<string, Skill>();
  const realPathSet = new Set<string>();
  const allDiagnostics: ResourceDiagnostic[] = [];
  const collisionDiagnostics: ResourceDiagnostic[] = [];

  function addSkills(result: LoadSkillsResult) {
    allDiagnostics.push(...result.diagnostics);
    for (const skill of result.skills) {
      const realPath = canonicalizePath(skill.filePath);

      if (realPathSet.has(realPath)) {
        continue;
      }

      const existing = skillMap.get(skill.name);
      if (existing) {
        if (existing.sourceInfo.source === "bundled" && skill.sourceInfo.source !== "bundled") {
          // User / project / explicit overrides bundled skill silently
          skillMap.set(skill.name, skill);
          realPathSet.add(realPath);
        } else if (existing.sourceInfo.scope === "user" && skill.sourceInfo.scope === "project") {
          // Project overrides user skill silently
          skillMap.set(skill.name, skill);
          realPathSet.add(realPath);
        } else {
          collisionDiagnostics.push({
            type: "collision",
            message: `name "${skill.name}" collision`,
            path: skill.filePath,
            collision: {
              resourceType: "skill",
              name: skill.name,
              winnerPath: existing.filePath,
              loserPath: skill.filePath,
            },
          });
        }
      } else {
        skillMap.set(skill.name, skill);
        realPathSet.add(realPath);
      }
    }
  }

  if (includeDefaults) {
    const effectiveBundledDir = bundledSkillsDir ?? getBundledSkillsDir();
    if (effectiveBundledDir && existsSync(effectiveBundledDir)) {
      addSkills(loadSkillsFromDirInternal(effectiveBundledDir, "bundled", true));
    }
    addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
    addSkills(loadSkillsFromDirInternal(resolve(resolvedCwd, CONFIG_DIR_NAME, "skills"), "project", true));
  }

  const userSkillsDir = join(resolvedAgentDir, "skills");
  const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "skills");

  const isUnderPath = (target: string, root: string): boolean => {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  };

  const getSource = (resolvedPath: string): "user" | "project" | "path" => {
    if (!includeDefaults) {
      if (isUnderPath(resolvedPath, userSkillsDir)) return "user";
      if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
    }
    return "path";
  };

  for (const rawPath of skillPaths) {
    const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
    if (!existsSync(resolvedPath)) {
      allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
      continue;
    }

    try {
      const stats = statSync(resolvedPath);
      const source = getSource(resolvedPath);
      if (stats.isDirectory()) {
        addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
      } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
        const result = loadSkillFromFile(resolvedPath, source);
        if (result.skill) {
          addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
        } else {
          allDiagnostics.push(...result.diagnostics);
        }
      } else {
        allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read skill path";
      allDiagnostics.push({ type: "warning", message, path: resolvedPath });
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    diagnostics: [...allDiagnostics, ...collisionDiagnostics],
  };
}
