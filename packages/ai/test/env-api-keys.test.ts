import fs from "node:fs";
import tmp from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalEnv = { ...process.env };

beforeEach(() => {
  // Clear env vars that affect tests
  delete process.env.ANTHROPIC_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_CLOUD_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  delete process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
  delete process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.ZAI_CODING_CN_API_KEY;
  delete process.env.HF_TOKEN;
  delete process.env.MISTRAL_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("environment API keys", () => {
  it("does not treat generic GitHub tokens as GitHub Copilot credentials", () => {
    process.env.GH_TOKEN = "gh-token";
    process.env.GITHUB_TOKEN = "github-token";

    expect(findEnvKeys("github-copilot")).toBeUndefined();
    expect(getEnvApiKey("github-copilot")).toBeUndefined();
  });

  it("resolves GitHub Copilot credentials from COPILOT_GITHUB_TOKEN", () => {
    process.env.COPILOT_GITHUB_TOKEN = "copilot-token";

    expect(findEnvKeys("github-copilot")).toEqual(["COPILOT_GITHUB_TOKEN"]);
    expect(getEnvApiKey("github-copilot")).toBe("copilot-token");
  });

  it("resolves Anthropic OAuth token with higher precedence than API key", () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
    process.env.ANTHROPIC_API_KEY = "api-key";

    expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);
    expect(getEnvApiKey("anthropic")).toBe("oauth-token");
  });

  it("resolves standard providers from envMap", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    expect(getEnvApiKey("openai")).toBe("sk-openai");

    process.env.HF_TOKEN = "hf-token";
    expect(getEnvApiKey("huggingface")).toBe("hf-token");

    process.env.MISTRAL_API_KEY = "mistral-key";
    expect(getEnvApiKey("mistral")).toBe("mistral-key");

    expect(findEnvKeys("unknown-provider-xyz")).toBeUndefined();
    expect(getEnvApiKey("unknown-provider-xyz")).toBeUndefined();
  });

  it("resolves google-vertex authentication when ADC credentials and env vars exist", () => {
    // Write a temporary file for GOOGLE_APPLICATION_CREDENTIALS
    const tmpDir = fs.mkdtempSync(path.join(tmp.tmpdir(), "gac-test-"));
    const tmpFile = path.join(tmpDir, "credentials.json");
    fs.writeFileSync(tmpFile, "{}");

    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpFile;
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

    expect(getEnvApiKey("google-vertex")).toBe("<authenticated>");

    fs.unlinkSync(tmpFile);
    fs.rmdirSync(tmpDir);
  });

  it("resolves amazon-bedrock authentication from various AWS credential sources", () => {
    expect(getEnvApiKey("amazon-bedrock")).toBeUndefined();

    process.env.AWS_PROFILE = "my-profile";
    expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
    delete process.env.AWS_PROFILE;

    process.env.AWS_ACCESS_KEY_ID = "key";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    process.env.AWS_BEARER_TOKEN_BEDROCK = "bearer-token";
    expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;

    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/uri";
    expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
    delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;

    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = "http://uri";
    expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
    delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;

    process.env.AWS_WEB_IDENTITY_TOKEN_FILE = "/path/to/token";
    expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
  });
});
