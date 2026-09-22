import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCertifiedModelConfiguration,
  validateCertifiedModelConfiguration,
} from "./certification-model-config-validation.ts";

export interface CertifiedModelConfiguration {
  sha256: string;
}

export interface CertifiedModelConfigurationInputs {
  modelsFile: string;
  kiloConfig: string;
  model: string;
  kiloModel: string;
  expectedResolvedModel: string;
}

export interface CertifiedModelConfigurationSnapshot {
  modelsFile: string;
  kiloConfig: string;
  modelConfiguration: CertifiedModelConfiguration;
  dispose(): void;
}

interface PrivateModelConfiguration {
  inputs: CertifiedModelConfigurationInputs;
  modelsSha256: string;
  kiloSha256: string;
}

const privateConfigurations = new WeakMap<CertifiedModelConfiguration, PrivateModelConfiguration>();

export function bindCertifiedModelConfiguration(
  inputs: CertifiedModelConfigurationInputs,
): CertifiedModelConfiguration {
  const validated = validateCertifiedModelConfiguration(inputs);
  const configuration = { sha256: validated.sha256 };
  privateConfigurations.set(configuration, { inputs: { ...inputs }, ...validated });
  return configuration;
}

export function snapshotCertifiedModelConfiguration(
  inputs: CertifiedModelConfigurationInputs,
  temporaryParent = tmpdir(),
): CertifiedModelConfigurationSnapshot {
  const root = mkdtempSync(join(temporaryParent, "p-certified-model-config-"));
  chmodSync(root, 0o700);
  try {
    const modelsFile = join(root, "models.json");
    const kiloConfig = join(root, "kilo.jsonc");
    writeFileSync(modelsFile, readCertifiedModelConfiguration(inputs.modelsFile, "P"), { mode: 0o600, flag: "wx" });
    writeFileSync(kiloConfig, readCertifiedModelConfiguration(inputs.kiloConfig, "Kilo"), { mode: 0o600, flag: "wx" });
    const modelConfiguration = bindCertifiedModelConfiguration({ ...inputs, modelsFile, kiloConfig });
    return {
      modelsFile,
      kiloConfig,
      modelConfiguration,
      dispose: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function recheckCertifiedModelConfiguration(configuration: CertifiedModelConfiguration): void {
  const privateConfiguration = privateConfigurations.get(configuration);
  if (!privateConfiguration)
    throw new Error("Certified model configuration binding is unavailable for publishing recheck");
  let current: { sha256: string; modelsSha256: string; kiloSha256: string };
  try {
    current = validateCertifiedModelConfiguration(privateConfiguration.inputs);
  } catch {
    throw new Error("Certified model configuration is no longer valid before certification publishing");
  }
  if (
    current.sha256 !== configuration.sha256 ||
    current.modelsSha256 !== privateConfiguration.modelsSha256 ||
    current.kiloSha256 !== privateConfiguration.kiloSha256
  ) {
    throw new Error("Certified model configuration raw input changed before certification publishing");
  }
}
