import { runAnthropic } from "./providers/anthropic";
import { ProviderError } from "./providers/common";
import { runOpenAi } from "./providers/openai";
import {
  deliverReport,
  parseReportPeriod,
  queryAiReport
} from "./reports";
import {
  corsHeaders,
  HttpError,
  parseAiRequest,
  requireInternalAuth,
  resolveKarvProject,
  securityHeaders
} from "./security";
import { recordAiMetric, type AiOutcome } from "./telemetry";
import type { AiProvider, AiResult, AiTask, Env } from "./types";

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

    if (
      request.method === "OPTIONS" &&
      (url.pathname === "/api/internal/ai" ||
        url.pathname === "/api/internal/reports/summary")
    ) {
      return new Response(null, {
        status: 204,
        headers: { ...securityHeaders(), ...corsHeaders(request, env) }
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/internal/reports/summary"
    ) {
      try {
        if (env.REPORTING_API_ENABLED !== "true") {
          throw new HttpError(503, "Reporting API is disabled");
        }
        await requireInternalAuth(request, env);
        const report = await queryAiReport(
          env,
          parseReportPeriod(url.searchParams.get("period"))
        );
        return json(report, 200, corsHeaders(request, env));
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ error: error.message, requestId }, error.status);
        }
        console.error("Report query failed", { requestId });
        return json({ error: "Report unavailable", requestId }, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/internal/ai") {
      const startedAt = Date.now();
      let project = env.KARV_DEFAULT_PROJECT || "unattributed";
      let provider: AiProvider | "unknown" = "unknown";
      let task: AiTask | "unknown" = "unknown";
      let model = "unknown";

      try {
        if (env.AI_API_ENABLED !== "true") {
          throw new HttpError(503, "AI API is disabled");
        }

        await requireInternalAuth(request, env);
        project = resolveKarvProject(request, env);
        const aiRequest = await parseAiRequest(request);
        provider = aiRequest.provider;
        task = aiRequest.task;
        model = provider === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL;
        const result: AiResult =
          provider === "openai"
            ? await runOpenAi(aiRequest, env, requestId)
            : await runAnthropic(aiRequest, env, requestId);

        recordMetric(200, "success");
        return json(result, 200, corsHeaders(request, env));
      } catch (error) {
        if (error instanceof HttpError) {
          recordMetric(error.status, "request_rejected");
          return json({ error: error.message, requestId }, error.status);
        }

        if (error instanceof ProviderError) {
          recordMetric(502, "provider_error");
          console.error("AI provider request failed", {
            provider: error.provider,
            requestId,
            upstreamRequestId: error.requestId,
            upstreamStatus: error.upstreamStatus
          });
          return json({ error: "AI provider unavailable", requestId }, 502);
        }

        recordMetric(500, "internal_error");
        console.error("AI request failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          requestId
        });
        return json({ error: "Internal server error", requestId }, 500);
      }

      function recordMetric(status: number, outcome: AiOutcome): void {
        recordAiMetric(env, {
          durationMs: Date.now() - startedAt,
          model,
          outcome,
          project,
          provider,
          status,
          task
        });
      }
    }

    return json({ error: "Not found", requestId }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (env.REPORT_DELIVERY_ENABLED !== "true") return;

    const period = controller.cron.includes("1 * *") ? "30d" : "7d";
    const report = await queryAiReport(env, period);
    await deliverReport(env, report);
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
