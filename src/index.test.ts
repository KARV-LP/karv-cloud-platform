import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./types";

const baseEnv: Env = {
  AI_API_ENABLED: "false",
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway",
  ALLOWED_ORIGINS: "https://personalize.k-arv.com",
  ANTHROPIC_MODEL: "claude-sonnet-4-5",
  KARV_DEFAULT_PROJECT: "karv-lps",
  KARV_PROJECTS: "karv-lps,KV_COLLAB_BLING,3D",
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
  });

  it("rejects requests without the internal bearer token", async () => {
    const response = await postAi({
      ...baseEnv,
      AI_API_ENABLED: "true",
      KARV_INTERNAL_API_TOKEN: "secret"
    });
    expect(response.status).toBe(401);
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
        ...baseEnv,
        AI_API_ENABLED: "true",
        KARV_INTERNAL_API_TOKEN: "secret",
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
        ...baseEnv,
        AI_API_ENABLED: "true",
        KARV_ANALYTICS: { writeDataPoint },
        KARV_INTERNAL_API_TOKEN: "secret",
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
      new Request("https://api.k-arv.com/api/internal/reports/summary") ,
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

function postAi(env: Env, headers: HeadersInit = {}): Promise<Response> {
  return worker.fetch(
    new Request("https://api.k-arv.com/api/internal/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        provider: "openai",
        task: "catalog_summary",
        input: "Coleção de teste"
      })
    }),
    env
  );
}
