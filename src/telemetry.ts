import type { AiProvider, AiTask, Env } from "./types";

export type AiOutcome =
  | "success"
  | "request_rejected"
  | "provider_error"
  | "internal_error";

interface AiMetric {
  durationMs: number;
  model: string;
  outcome: AiOutcome;
  project: string;
  provider: AiProvider | "unknown";
  status: number;
  task: AiTask | "unknown";
}

export function recordAiMetric(env: Env, metric: AiMetric): void {
  if (!env.KARV_ANALYTICS) return;

  env.KARV_ANALYTICS.writeDataPoint({
    blobs: [
      "ai_request",
      metric.project,
      metric.provider,
      metric.task,
      metric.model,
      metric.outcome,
      String(metric.status)
    ],
    doubles: [1, Math.max(0, metric.durationMs)],
    indexes: [metric.project]
  });
}
