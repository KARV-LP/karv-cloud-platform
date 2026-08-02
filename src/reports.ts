import { HttpError } from "./security";
import type { Env } from "./types";

export type ReportPeriod = "7d" | "30d";

interface AnalyticsQueryResponse {
  data?: unknown[];
  rows?: number;
}

export interface AiReport {
  generatedAt: string;
  period: ReportPeriod;
  rows: unknown[];
}

export function parseReportPeriod(value: string | null): ReportPeriod {
  if (value === null || value === "7d") return "7d";
  if (value === "30d") return "30d";
  throw new HttpError(400, "Period must be 7d or 30d");
}

export async function queryAiReport(
  env: Env,
  period: ReportPeriod
): Promise<AiReport> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_ANALYTICS_TOKEN) {
    throw new HttpError(503, "Reporting credentials are not configured");
  }

  const days = period === "7d" ? 7 : 30;
  const query = `
    SELECT
      blob2 AS project,
      blob3 AS provider,
      blob4 AS task,
      blob5 AS model,
      blob6 AS outcome,
      blob7 AS status,
      SUM(_sample_interval) AS requests,
      SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_duration_ms
    FROM karv_platform_metrics
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'ai_request'
    GROUP BY project, provider, task, model, outcome, status
    ORDER BY project, provider, task, outcome`;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,
        "Content-Type": "text/plain;charset=UTF-8"
      },
      body: query
    }
  );

  if (!response.ok) {
    throw new Error(`Analytics query failed with status ${response.status}`);
  }

  const result = (await response.json()) as AnalyticsQueryResponse;
  if (!Array.isArray(result.data)) {
    throw new Error("Analytics query returned an invalid response");
  }

  return {
    generatedAt: new Date().toISOString(),
    period,
    rows: result.data
  };
}

export async function deliverReport(env: Env, report: AiReport): Promise<void> {
  if (!env.REPORT_WEBHOOK_URL) {
    throw new Error("REPORT_WEBHOOK_URL is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (env.REPORT_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${env.REPORT_WEBHOOK_TOKEN}`;
  }

  const response = await fetch(env.REPORT_WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "karv-cloud-platform", ...report })
  });

  if (!response.ok) {
    throw new Error(`Report delivery failed with status ${response.status}`);
  }
}
