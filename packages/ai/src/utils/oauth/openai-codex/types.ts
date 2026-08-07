import { JWT_CLAIM_PATH } from "./constants.ts";

export type OAuthToken = { access: string; refresh: string; expires: number };

export type TokenOperation = "exchange" | "refresh";

export type DeviceAuthInfo = {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
};

export type DeviceTokenSuccess = {
  authorizationCode: string;
  codeVerifier: string;
};

export type JwtPayload = {
  [JWT_CLAIM_PATH]?: {
    chatgpt_account_id?: string;
  };
  [key: string]: unknown;
};

export type OAuthServerInfo = {
  close: () => void;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
};
