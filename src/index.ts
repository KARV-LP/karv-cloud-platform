import { runAnthropic } from "./providers/anthropic";
import { ProviderError } from "./providers/common";
import { runOpenAi } from "./providers/openai";
import {
  corsHeaders,
  HttpError,
  parseAiRequest,
  requireInternalAuth,
  securityHeaders
} from "./security";
import type { AiResult, Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        { status: "ok", service: "karv-cloud-platform", requestId },
        200
      );
    }

    if (request.method === "OPTIONS" && url.pathname === "/api/internal/ai") {
      return new Response(null, {
        status: 204,
        headers: { ...securityHeaders(), ...corsHeaders(request, env) }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/internal/ai") {
      try {
        if (env.AI_API_ENABLED !== "true") {
          throw new HttpError(503, "AI API is disabled");
        }

        await requireInternalAuth(request, env);
        const aiRequest = await parseAiRequest(request);
        const result: AiResult =
          aiRequest.provider === "openai"
            ? await runOpenAi(aiRequest, env, requestId)
            : await runAnthropic(aiRequest, env, requestId);

        return json(result, 200, corsHeaders(request, env));
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ error: error.message, requestId }, error.status);
        }

        if (error instanceof ProviderError) {
          console.error("AI provider request failed", {
            provider: error.provider,
            requestId,
            upstreamRequestId: error.requestId,
            upstreamStatus: error.upstreamStatus
          });
          return json({ error: "AI provider unavailable", requestId }, 502);
        }

        console.error("AI request failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          requestId
        });
        return json({ error: "Internal server error", requestId }, 500);
      }
    }

    return json({ error: "Not found", requestId }, 404);
  }
};

function json(
  body: unknown,
  status: number,
  additionalHeaders: HeadersInit = {}
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...securityHeaders(),
      ...additionalHeaders
    }
  });
}

