import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { AiTask, Env, RateLimitBinding } from "./types";

const allowRateLimiter: RateLimitBinding = {
  limit: vi.fn().mockResolvedValue({ success: true })
};

const baseEnv: Env = {
  KARV_ANALYTICS: {
    writeDataPoint: () => undefined
  },
  AI_API_ENABLED: "false",
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway",
  AI_RATE_LIMITER: allowRateLimiter,
  ALLOWED_ORIGINS: "",
  ANTHROPIC_MODEL: "claude-sonnet-4-5",
  KARV_DEFAULT_PROJECT: "karv-lps",
  KARV_PROJECTS: "karv-lps,KV_COLLAB_BLING,3D,karv-cloud-platform",
  KARV_PROJECT_POLICIES: JSON.stringify({
    "karv-lps": {
      tasks: ["catalog_summary", "order_summary", "seo_draft"],
      maxInputChars: 8000
    },
    KV_COLLAB_BLING: {
      tasks: ["order_summary"],
      maxInputChars: 6000
    },
    "3D": {
      tasks: ["catalog_summary"],
      maxInputChars: 4000
    },
    "karv-cloud-platform": {
      tasks: ["catalog_summary"],
      maxInputChars: 4000
    }
  }),
  OPENAI_MODEL: "gpt-5.6-terra",
  REPORT_DELIVERY_ENABLED: "false",
  REPORTING_API_ENABLED: "false"
};

afterEach(() => vi.restoreAllMocks());

describe("KARV Cloud Platform worker", () => {
  it("returns a secure health response", async () => {
    const response = await worker.fetch(
      new Request("https://api.k-arv.com/health"),
      baseEnv
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      service: "karv-cloud-platform",
      status: "ok"
    });
  });

  it("keeps the AI endpoint disabled by default", async () => {
    const response = await postAi(baseEnv);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "AI API is disabled" });
  });

  it("fails closed when internal authentication is not configured", async () => {
    const response = await postAi(
      { ...baseEnv, AI_API_ENABLED: "true" },
      { Authorization: "Bearer unknown" }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Internal authentication is not configured"
    });
  });

  it("rejects requests without the internal bearer token", async () => {
    const response = await postAi({
      ...baseEnv,
      AI_API_ENABLED: "true",
      KARV_INTERNAL_API_TOKEN: "secret"
    });
    expect(response.status).toBe(401);
  });

  it("rejects an invalid internal bearer token", async () => {
    const response = await postAi(
      {
        ...baseEnv,
        AI_API_ENABLED: "true",
        KARV_INTERNAL_API_TOKEN: "secret"
      },
      { Authorization: "Bearer invalid" }
    );
    expect(response.status).toBe(401);
  });

  it("accepts the next token during controlled rotation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ output_text: "Token rotacionado" })
    );

    const response = await postAi(
      {
        ...baseEnv,
        AI_API_ENABLED: "true",
        KARV_INTERNAL_API_TOKEN: "current-secret",
        KARV_INTERNAL_API_TOKEN_NEXT: "next-secret",
        OPENAI_API_KEY: "test-key"
      },
      { Authorization: "Bearer next-secret" }
    );

    expect(response.status).toBe(200);
  });

  it("fails closed when rate limiting is not configured", async () => {
    const response = await postAi(
      {
        ...baseEnv,
        AI_API_ENABLED: "true",
        AI_RATE_LIMITER: undefined,
        KARV_INTERNAL_API_TOKEN: "secret"
      },
      { Authorization: "Bearer secret" }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "AI rate limiting is not configured"
    });
  });

  it("returns 429 when the project and task limit is exceeded", async () => {
    const rateLimiter: RateLimitBinding = {
      limit: vi.fn().mockResolvedValue({ success: false })
    };

    const response = await postAi(
      {
        ...baseEnv,
        AI_API_ENABLED: "true",
        AI_RATE_LIMITER: rateLimiter,
        KARV_INTERNAL_API_TOKEN: "secret"
      },
      { Authorization: "Bearer secret" }
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: "AI rate limit exceeded"
    });
    expect(rateLimiter.limit).toHaveBeenCalledWith({
      key: "karv-lps:catalog_summary"
    });
  });

  it("returns 503 when the rate limiter is unavailable", async () => {
    const rateLimiter: RateLimitBinding = {
      limit: vi.fn().mockRejectedValue(new Error("unavailable"))
    };

    const response = await postAi(
      {
        ...baseEnv,
        AI_API_ENABLED: "true",
        AI_RATE_LIMITER: rateLimiter,
        KARV_INTERNAL_API_TOKEN: "secret"
      },
      { Authorization: "Bearer secret" }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "AI rate limiting is unavailable"
    });
  });

  it("rejects a non-JSON content type", async () => {
    const response = await postAi(
      enabledEnv(),
      { Authorization: "Bearer secret", "Content-Type": "text/plain" },
      "plain text"
    );
    expect(response.status).toBe(415);
  });

  it("rejects an oversized request body", async () => {
    const response = await postAi(
      enabledEnv(),
      { Authorization: "Bearer secret" },
      aiBody({ input: "x".repeat(17_000) })
    );
    expect(response.status).toBe(413);
  });

  it("rejects invalid JSON", async () => {
    const response = await postAi(
      enabledEnv(),
      { Authorization: "Bearer secret" },
      "{not-json"
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown KARV project", async () => {
    const response = await postAi(enabledEnv(), {
      Authorization: "Bearer secret",
      "X-KARV-Project": "unknown"
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Unknown KARV project" });
  });

  it("rejects an unsupported task", async () => {
    const response = await postAi(
      enabledEnv(),
      { Authorization: "Bearer secret" },
      aiBody({ task: "delete_everything" as AiTask })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Unsupported task" });
  });

  it("rejects a task not permitted for the selected project", async () => {
    const response = await postAi(
      enabledEnv(),
      {
        Authorization: "Bearer secret",
        "X-KARV-Project": "3D"
      },
      aiBody({ task: "order_summary" })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Task is not allowed for KARV project"
    });
  });

  it("rejects empty input", async () => {
    const response = await postAi(
      enabledEnv(),
      { Authorization: "Bearer secret" },
      aiBody({ input: "   " })
    );
    expect(response.status).toBe(400);
  });

  it("enforces the input limit defined for each project", async () => {
    const response = await postAi(
      enabledEnv(),
      {
        Authorization: "Bearer secret",
        "X-KARV-Project": "3D"
      },
      aiBody({ input: "x".repeat(4_001) })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Input exceeds the 4000-character project limit"
    });
  });

  it("fails closed when project policies are invalid", async () => {
    const response = await postAi(
      {
        ...enabledEnv(),
        KARV_PROJECT_POLICIES: "not-json"
      },
      { Authorization: "Bearer secret" }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Project security policy is invalid"
    });
  });

  it("denies browser preflight when no origin is authorized", async () => {
    const response = await preflight(baseEnv, "https://www.k-arv.com");
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows preflight only for an explicitly configured origin", async () => {
    const response = await preflight(
      { ...baseEnv, ALLOWED_ORIGINS: "https://www.k-arv.com" },
      "https://www.k-arv.com"
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://www.k-arv.com"
    );
  });

  it("routes an authorized request through OpenAI Responses", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Resumo seguro" }]
          }
        ]
      })
    );

    const response = await postAi(
      {
        ...enabledEnv(),
        OPENAI_API_KEY: "test-key"
      },
      { Authorization: "Bearer secret" }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      model: "gpt-5.6-terra",
      output: "Resumo seguro",
      provider: "openai"
    });

    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-5.6-terra",
      store: false
    });
    expect(new Headers(init?.headers).get("cf-aig-collect-log-payload")).toBe(
      "false"
    );
  });

  it("records only safe AI metadata by project", async () => {
    const writeDataPoint = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ output_text: "Resumo seguro" })
    );

    const response = await postAi(
      {
        ...enabledEnv(),
        KARV_ANALYTICS: { writeDataPoint },
        OPENAI_API_KEY: "test-key"
      },
      {
        Authorization: "Bearer secret",
        "X-KARV-Project": "3D"
      }
    );

    expect(response.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledOnce();
    const point = writeDataPoint.mock.calls[0]?.[0];
    expect(point.blobs).toEqual([
      "ai_request",
      "3D",
      "openai",
      "catalog_summary",
      "gpt-5.6-terra",
      "success",
      "200"
    ]);
    expect(JSON.stringify(point)).not.toContain("Coleção de teste");
  });

  it("keeps the reporting endpoint disabled by default", async () => {
    const response = await worker.fetch(
      new Request("https://api.k-arv.com/api/internal/reports/summary"),
      baseEnv
    );
    expect(response.status).toBe(503);
  });

  it("returns an authenticated seven-day report", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: [{ project: "karv-lps", requests: 2 }] })
    );

    const response = await worker.fetch(
      new Request(
        "https://api.k-arv.com/api/internal/reports/summary?period=7d",
        { headers: { Authorization: "Bearer secret" } }
      ),
      {
        ...baseEnv,
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_ANALYTICS_TOKEN: "analytics-token",
        KARV_INTERNAL_API_TOKEN: "secret",
        REPORTING_API_ENABLED: "true"
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      period: "7d",
      rows: [{ project: "karv-lps", requests: 2 }]
    });
    expect(String(upstream.mock.calls[0]?.[1]?.body)).toContain(
      "INTERVAL '7' DAY"
    );
  });
});

function enabledEnv(): Env {
  return {
    ...baseEnv,
    AI_API_ENABLED: "true",
    KARV_INTERNAL_API_TOKEN: "secret"
  };
}

function aiBody(
  overrides: Partial<{ provider: "openai" | "anthropic"; task: AiTask; input: string }> = {}
): string {
  return JSON.stringify({
    provider: "openai",
    task: "catalog_summary",
    input: "Coleção de teste",
    ...overrides
  });
}

function postAi(
  env: Env,
  headers: HeadersInit = {},
  body: string = aiBody()
): Promise<Response> {
  return worker.fetch(
    new Request("https://api.k-arv.com/api/internal/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body
    }),
    env
  );
}

function preflight(env: Env, origin: string): Promise<Response> {
  return worker.fetch(
    new Request("https://api.k-arv.com/api/internal/ai", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST"
      }
    }),
    env
  );
}
