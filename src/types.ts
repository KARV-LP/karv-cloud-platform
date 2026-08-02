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
  KARV_INTERNAL_API_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
}

