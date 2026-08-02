import { buildPrompt } from "../prompts";
import type { AiRequest, AiResult, Env } from "../types";
import { gatewayHeaders, gatewayUrl, ProviderError } from "./common";

interface OpenAiResponse {
  output?: Array<{
    content?: Array<{ text?: string; type?: string }>;
    type?: string;
  }>;
  output_text?: string;
}

export async function runOpenAi(
  request: AiRequest,
  env: Env,
  requestId: string
): Promise<AiResult> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch(gatewayUrl(env, "openai/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      ...gatewayHeaders(env)
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: buildPrompt(request.task, request.input),
      max_output_tokens: 1200,
      reasoning: { effort: "low" },
      store: false,
      text: { verbosity: "low" }
    })
  });

  if (!response.ok) {
    throw new ProviderError(
      "openai",
      response.status,
      response.headers.get("x-request-id") ?? undefined
    );
  }

  const data = (await response.json()) as OpenAiResponse;
  const output = extractText(data);
  if (!output) throw new Error("OpenAI returned no text output");

  return { provider: "openai", model: env.OPENAI_MODEL, output, requestId };
}

function extractText(data: OpenAiResponse): string {
  if (typeof data.output_text === "string") return data.output_text.trim();

  return (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
}

