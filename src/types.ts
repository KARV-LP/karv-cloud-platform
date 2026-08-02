export type AiProvider = "openai" | "anthropic";

export type AiTask = "catalog_summary" | "order_summary" | "seo_draft";

export interface AiRequest {
  provider: AiProvider;
  task: AiTask;
  input: string;
}

export interface AiResult {
  provider: AiProvider;
  model: string;
  output: string;
  requestId: string;
}

export interface Env {
  AI_API_ENABLED: string;
  AI_GATEWAY_BASE_URL: string;
  AI_GATEWAY_TOKEN?: string;
  ALLOWED_ORIGINS: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  KARV_ANALYTICS?: AnalyticsEngineDataset;
  KARV_DEFAULT_PROJECT: string;
  KARV_INTERNAL_API_TOKEN?: string;
  KARV_PROJECTS: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  REPORT_DELIVERY_ENABLED: string;
  REPORT_WEBHOOK_TOKEN?: string;
  REPORT_WEBHOOK_URL?: string;
  REPORTING_API_ENABLED: string;
}
