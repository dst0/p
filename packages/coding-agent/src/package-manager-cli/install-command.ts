import type { PackageCommand, PackageCommandOptions, UpdateTarget } from "./types.ts";

export function parsePackageCommand(args: string[]): PackageCommandOptions | undefined {
  const [rawCommand, ...rest] = args;
  let command: PackageCommand | undefined;
  if (rawCommand === "uninstall") {
    command = "remove";
  } else if (rawCommand === "install" || rawCommand === "remove" || rawCommand === "update" || rawCommand === "list") {
    command = rawCommand;
  }
  if (!command) {
    return undefined;
  }

  let local = false;
  let force = false;
  let projectTrustOverride: boolean | undefined;
  let help = false;
  let invalidOption: string | undefined;
  let invalidArgument: string | undefined;
  let missingOptionValue: string | undefined;
  let conflictingOptions: string | undefined;
  let source: string | undefined;
  let selfFlag = false;
  let extensionsFlag = false;
  let extensionFlagSource: string | undefined;

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "-l" || arg === "--local") {
      if (command === "install" || command === "remove") {
        local = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--self") {
      if (command === "update") {
        selfFlag = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--extensions") {
      if (command === "update") {
        extensionsFlag = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--approve" || arg === "-a") {
      projectTrustOverride = true;
      continue;
    }

    if (arg === "--no-approve" || arg === "-na") {
      projectTrustOverride = false;
      continue;
    }

    if (arg === "--force") {
      if (command === "update") {
        force = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--extension") {
      if (command !== "update") {
        invalidOption = invalidOption ?? arg;
        continue;
      }

      const value = rest[index + 1];
      if (!value || value.startsWith("-")) {
        missingOptionValue = missingOptionValue ?? arg;
      } else if (extensionFlagSource) {
        conflictingOptions = conflictingOptions ?? "--extension can only be provided once";
        index++;
      } else {
        extensionFlagSource = value;
        index++;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      invalidOption = invalidOption ?? arg;
      continue;
    }

    if (!source) {
      source = arg;
    } else {
      invalidArgument = invalidArgument ?? arg;
    }
  }

  let updateTarget: UpdateTarget | undefined;
  if (command === "update") {
    if (extensionFlagSource) {
      if (selfFlag || extensionsFlag) {
        conflictingOptions = conflictingOptions ?? "--extension cannot be combined with --self or --extensions";
      }
      if (source) {
        conflictingOptions = conflictingOptions ?? "--extension cannot be combined with a positional source";
      }
      updateTarget = { type: "extensions", source: extensionFlagSource };
    } else if (source) {
      const sourceIsSelf = source === "self" || source === "p";
      if (sourceIsSelf) {
        updateTarget = extensionsFlag ? { type: "all" } : { type: "self" };
      } else {
        if (extensionsFlag || selfFlag) {
          conflictingOptions =
            conflictingOptions ?? "positional update targets cannot be combined with --self or --extensions";
        }
        updateTarget = { type: "extensions", source };
      }
    } else if (selfFlag && extensionsFlag) {
      updateTarget = { type: "all" };
    } else if (selfFlag) {
      updateTarget = { type: "self" };
    } else if (extensionsFlag) {
      updateTarget = { type: "extensions" };
    } else {
      updateTarget = { type: "all" };
    }
  }

  return {
    command,
    source,
    updateTarget,
    local,
    force,
    projectTrustOverride,
    help,
    invalidOption,
    invalidArgument,
    missingOptionValue,
    conflictingOptions,
  };
}
