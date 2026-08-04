import { appendFileSync } from "node:fs";

const scenario = process.env.MOCK_SCENARIO ?? "";
const requestLogPath = process.env.MOCK_REQUEST_LOG ?? "";
const AI_GATEWAY_ID = "karv-ai-gateway-staging";

const currentGateway = {
  id: AI_GATEWAY_ID,
  account_id: "server-account-id",
  created_at: "2026-08-04T00:00:00Z",
  modified_at: "2026-08-04T00:00:00Z",
  cache_invalidate_on_update: true,
  cache_ttl: 120,
  collect_logs: true,
  zdr: false,
  rate_limiting_limit: 5,
  rate_limiting_interval: 60,
  rate_limiting_technique: "fixed",
  authentication: false,
  log_management: null,
  otel: [
    {
      headers: { "x-karv-test": "enabled" },
      url: "https://otel.invalid/v1/logs",
      content_type: "json"
    }
  ],
  spend_limits: {
    enabled: true,
    rules: [
      {
        id: "external-provider-budget",
        enabled: true,
        limit: 25,
        limitType: "cost",
        window: 3600,
        technique: "sliding",
        provider: { mode: "filter", values: ["openai"] },
        server_only: "must-not-be-written"
      }
    ]
  },
  server_only: "must-not-be-written"
};

const hardenedGateway = {
  ...currentGateway,
  collect_logs: false,
  zdr: true,
  rate_limiting_limit: 20,
  rate_limiting_interval: 60,
  rate_limiting_technique: "sliding",
  spend_limits: {
    enabled: true,
    rules: [
      currentGateway.spend_limits.rules[0],
      {
        id: "karv-staging-global-budget",
        enabled: true,
        limit: 5,
        limitType: "cost",
        window: 86400,
        technique: "fixed"
      }
    ]
  }
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = String(init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : null;
  logRequest({ body, method, pathname: url.pathname });

  if (url.pathname.endsWith("/secrets")) {
    const hasSecret = scenario === "audit-post-success" || scenario === "audit-post-mismatch";
    return jsonResponse({
      success: true,
      result: hasSecret ? [{ name: "KARV_INTERNAL_API_TOKEN", type: "secret_text" }] : []
    });
  }

  if (!url.pathname.endsWith(`/ai-gateway/gateways/${AI_GATEWAY_ID}`)) {
    return jsonResponse({ success: false, errors: [{ message: "unexpected path" }] }, 404);
  }

  if (method === "GET") {
    return jsonResponse({ success: true, result: gatewayForScenario() });
  }

  if (method === "PUT") {
    if (scenario !== "configure-success" && scenario !== "configure-mismatch") {
      return jsonResponse(
        { success: false, errors: [{ message: "unexpected mutation" }] },
        409
      );
    }
    const result = {
      id: AI_GATEWAY_ID,
      created_at: currentGateway.created_at,
      modified_at: "2026-08-04T00:01:00Z",
      ...body
    };
    if (scenario === "configure-mismatch") result.zdr = false;
    return jsonResponse({ success: true, result });
  }

  return jsonResponse({ success: false, errors: [{ message: "unexpected method" }] }, 405);
};

function gatewayForScenario() {
  if (scenario === "configure-stripe") {
    return { ...currentGateway, stripe: { authorization: "redacted", usage_events: [] } };
  }
  if (scenario === "configure-otel-auth") {
    return {
      ...currentGateway,
      otel: [
        {
          headers: {},
          url: "https://otel.invalid/v1/logs",
          authorization: "redacted"
        }
      ]
    };
  }
  if (scenario === "audit-post-success") return hardenedGateway;
  if (scenario === "audit-post-mismatch") return { ...hardenedGateway, zdr: false };
  return currentGateway;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function logRequest(entry) {
  if (!requestLogPath) return;
  appendFileSync(requestLogPath, `${JSON.stringify(entry)}\n`);
}
