import type { Env } from "../types";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly upstreamStatus: number,
    readonly requestId?: string
  ) {
    super(`${provider} request failed`);
  }
}

export function gatewayHeaders(env: Env): HeadersInit {
  const headers: Record<string, string> = {
    "cf-aig-collect-log-payload": "false"
  };
  if (env.AI_GATEWAY_TOKEN) {
    headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
  }
  return headers;
}

export function gatewayUrl(env: Env, providerPath: string): string {
  const base = env.AI_GATEWAY_BASE_URL.replace(/\/$/, "");
  if (!base) throw new Error("AI_GATEWAY_BASE_URL is not configured");
  return `${base}/${providerPath}`;
}
