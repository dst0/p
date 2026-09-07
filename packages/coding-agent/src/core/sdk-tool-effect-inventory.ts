import { type ResolvedToolEffect, resolveToolEffect, toolEffectRequiresVerification } from "@dst0/p-agent-core";
import type { LoadExtensionsResult, ToolDefinition } from "./extensions/index.ts";
import {
  getBuiltinToolEffectNames,
  resolveBuiltinToolEffect,
  resolveToolDefinitionEffect,
} from "./tools/tool-effects.ts";

export function createSdkToolEffectInventory(
  customTools: readonly ToolDefinition[] | undefined,
  extensionsResult: LoadExtensionsResult,
): Map<string, ResolvedToolEffect> {
  const inventory = new Map<string, ResolvedToolEffect>();
  for (const name of getBuiltinToolEffectNames()) {
    const effect = resolveBuiltinToolEffect(name);
    if (effect) inventory.set(name, effect);
  }
  for (const extension of extensionsResult.extensions) {
    for (const { definition } of extension.tools.values()) {
      inventory.set(definition.name, resolveToolDefinitionEffect(definition, "declared"));
    }
  }
  for (const definition of customTools ?? []) {
    inventory.set(definition.name, resolveToolDefinitionEffect(definition, "declared"));
  }
  return inventory;
}

interface ActiveToolEffectOptions {
  inventory: ReadonlyMap<string, ResolvedToolEffect>;
  initialActiveToolNames: readonly string[];
  allowedToolNames: readonly string[] | undefined;
  excludeTools: readonly string[] | undefined;
  customTools: readonly ToolDefinition[] | undefined;
  extensionsResult: LoadExtensionsResult;
  includeAllExtensionTools: boolean;
}

export function collectInitialActiveToolEffects(options: ActiveToolEffectOptions): ResolvedToolEffect[] {
  const activeNames = new Set(options.initialActiveToolNames);
  const registeredCustomDefinitions = [
    ...options.extensionsResult.extensions.flatMap((extension) =>
      Array.from(extension.tools.values(), ({ definition }) => definition),
    ),
    ...(options.customTools ?? []),
  ];
  const allowed = options.allowedToolNames ? new Set(options.allowedToolNames) : undefined;
  for (const definition of registeredCustomDefinitions) {
    if (
      (allowed?.has(definition.name) ?? false) ||
      (!allowed && (options.includeAllExtensionTools || Boolean(definition.promptSnippet?.trim())))
    ) {
      activeNames.add(definition.name);
    }
  }
  const excluded = new Set(options.excludeTools ?? []);
  return Array.from(activeNames)
    .filter((name) => !excluded.has(name))
    .map((name) => options.inventory.get(name))
    .filter((effect): effect is ResolvedToolEffect => effect !== undefined);
}

export function toolEffectMapHasMutation(
  toolNames: readonly string[],
  inventory: ReadonlyMap<string, ResolvedToolEffect>,
): boolean {
  return toolNames.some((name) => toolEffectRequiresVerification(inventory.get(name) ?? resolveToolEffect(undefined)));
}
