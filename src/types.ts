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

interface SecretBindings {
  AI_GATEWAY_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  KARV_INTERNAL_API_TOKEN?: string;
  OPENAI_API_KEY?: string;
  REPORT_WEBHOOK_TOKEN?: string;
  REPORT_WEBHOOK_URL?: string;
}

export type Env = CloudflareBindings & SecretBindings;
