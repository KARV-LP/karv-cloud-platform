import { buildPrompt } from "../prompts";
import type { AiRequest, AiResult, Env } from "../types";
import { gatewayHeaders, gatewayUrl, ProviderError } from "./common";

interface AnthropicResponse {
  content?: Array<{ text?: string; type?: string }>;
}

export async function runAnthropic(
  request: AiRequest,
  env: Env,
  requestId: string
): Promise<AiResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const response = await fetch(gatewayUrl(env, "anthropic/v1/messages"), {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      ...gatewayHeaders(env)
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: buildPrompt(request.task, request.input) }]
    })
  });

  if (!response.ok) {
    throw new ProviderError(
      "anthropic",
      response.status,
      response.headers.get("request-id") ?? undefined
    );
  }

  const data = (await response.json()) as AnthropicResponse;
  const output = (data.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();

  if (!output) throw new Error("Anthropic returned no text output");
  return { provider: "anthropic", model: env.ANTHROPIC_MODEL, output, requestId };
}

