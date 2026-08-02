import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./types";

const baseEnv: Env = {
  AI_API_ENABLED: "false",
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway",
  ALLOWED_ORIGINS: "https://personalize.k-arv.com",
  ANTHROPIC_MODEL: "claude-sonnet-4-5",
  OPENAI_MODEL: "gpt-5.6-terra"
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

