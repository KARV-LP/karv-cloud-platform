const DEFAULT_ATTEMPTS = 12;
const DEFAULT_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;

const securityHeaders = new Map([
  ["cache-control", "no-store"],
  [
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  ],
  ["referrer-policy", "no-referrer"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"]
]);

const baseUrl = resolveBaseUrl(process.env.SMOKE_BASE_URL);
const attempts = positiveInteger(
  process.env.SMOKE_MAX_ATTEMPTS,
  DEFAULT_ATTEMPTS,
  "SMOKE_MAX_ATTEMPTS"
);
const delayMs = positiveInteger(
  process.env.SMOKE_RETRY_DELAY_MS,
  DEFAULT_DELAY_MS,
  "SMOKE_RETRY_DELAY_MS"
);

await main();

async function main() {
  console.log(`Running staging smoke tests against ${baseUrl.origin}`);

  const health = await waitForHealthyWorker();
  assertStatus(health.response, 200, "GET /health");
  assertSecurityHeaders(health.response, "GET /health");
  assertObject(health.body, "GET /health response body");
  assertEqual(health.body.status, "ok", "health.status");
  assertEqual(
    health.body.service,
    "karv-cloud-platform",
    "health.service"
  );
  assertRequestId(health.body.requestId, "health.requestId");
  pass("GET /health returned a secure 200 response");

  const ai = await requestJson("/api/internal/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      task: "catalog_summary",
      input: "Smoke test"
    })
  });
  assertStatus(ai.response, 503, "POST /api/internal/ai");
  assertSecurityHeaders(ai.response, "POST /api/internal/ai");
  assertObject(ai.body, "POST /api/internal/ai response body");
  assertEqual(ai.body.error, "AI API is disabled", "AI disabled error");
  assertRequestId(ai.body.requestId, "AI requestId");
  pass("POST /api/internal/ai remained disabled with HTTP 503");

  const missingPath = `/__smoke-test/not-found-${Date.now()}`;
  const missing = await requestJson(missingPath);
  assertStatus(missing.response, 404, `GET ${missingPath}`);
  assertSecurityHeaders(missing.response, `GET ${missingPath}`);
  assertObject(missing.body, `GET ${missingPath} response body`);
  assertEqual(missing.body.error, "Not found", "not-found error");
  assertRequestId(missing.body.requestId, "not-found requestId");
  pass("Unknown route returned a secure HTTP 404 response");

  console.log("All staging smoke tests passed.");
}

async function waitForHealthyWorker() {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await requestJson("/health");
      if (result.response.status === 200) return result;
      lastError = new Error(
        `GET /health returned HTTP ${result.response.status}`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      console.log(
        `Worker is not ready (attempt ${attempt}/${attempts}); retrying in ${delayMs} ms.`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Staging Worker did not become healthy after ${attempts} attempts: ${formatError(lastError)}`
  );
}

async function requestJson(pathname, init = {}) {
  const url = new URL(pathname, baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error(
        `${init.method ?? "GET"} ${url.pathname} returned non-JSON content-type ${contentType || "<missing>"}`
      );
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(
        `${init.method ?? "GET"} ${url.pathname} returned invalid JSON: ${formatError(error)}`
      );
    }

    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveBaseUrl(value) {
  if (!value?.trim()) {
    throw new Error("SMOKE_BASE_URL is required");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("SMOKE_BASE_URL must be an absolute HTTP(S) URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SMOKE_BASE_URL must use HTTP or HTTPS");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function assertStatus(response, expected, label) {
  assertEqual(response.status, expected, `${label} status`);
}

function assertSecurityHeaders(response, label) {
  for (const [name, expected] of securityHeaders) {
    assertEqual(response.headers.get(name), expected, `${label} header ${name}`);
  }
}

function assertRequestId(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
