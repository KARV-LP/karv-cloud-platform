import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanAddedLines } from "../../scripts/scan-added-lines-for-secrets.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const mockLoader = join(testDirectory, "mock-cloudflare-fetch.mjs");
const configureScript = join(
  repositoryRoot,
  "scripts/cloudflare-ai-gateway-configure.mjs"
);
const auditScript = join(repositoryRoot, "scripts/cloudflare-admin-audit.mjs");

const baseCloudflareEnv = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token"
};

const configureEnv = {
  ...baseCloudflareEnv,
  AI_GATEWAY_RATE_LIMIT_REQUESTS: "20",
  AI_GATEWAY_RATE_LIMIT_PERIOD_SECONDS: "60",
  AI_GATEWAY_SPEND_LIMIT_AMOUNT: "5",
  AI_GATEWAY_SPEND_LIMIT_WINDOW: "86400"
};

const auditPreEnv = {
  ...baseCloudflareEnv,
  AUDIT_MODE: "pre",
  PROPOSED_RATE_LIMIT_REQUESTS: "20",
  PROPOSED_RATE_LIMIT_PERIOD_SECONDS: "60",
  PROPOSED_SPEND_LIMIT_AMOUNT: "5",
  PROPOSED_SPEND_LIMIT_WINDOW: "86400"
};

const auditPostEnv = {
  ...baseCloudflareEnv,
  AUDIT_MODE: "post",
  EXPECTED_RATE_LIMIT_REQUESTS: "20",
  EXPECTED_RATE_LIMIT_PERIOD_SECONDS: "60",
  EXPECTED_SPEND_LIMIT_AMOUNT: "5",
  EXPECTED_SPEND_LIMIT_WINDOW: "86400"
};

test("configure applies only whitelisted fields and preserves valid external rules", () => {
  const execution = runScript(configureScript, "configure-success", configureEnv);
  assert.equal(execution.status, 0, execution.output);

  const calls = readCalls(execution.logPath);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "PUT"]
  );

  const payload = calls.find((call) => call.method === "PUT").body;
  assert.equal(payload.collect_logs, false);
  assert.equal(payload.zdr, true);
  assert.equal(payload.rate_limiting_limit, 20);
  assert.equal(payload.rate_limiting_interval, 60);
  assert.equal(payload.rate_limiting_technique, "sliding");
  assert.equal(Object.hasOwn(payload, "id"), false);
  assert.equal(Object.hasOwn(payload, "account_id"), false);
  assert.equal(Object.hasOwn(payload, "created_at"), false);
  assert.equal(Object.hasOwn(payload, "server_only"), false);

  const externalRule = payload.spend_limits.rules.find(
    (rule) => rule.id === "external-provider-budget"
  );
  assert.ok(externalRule);
  assert.deepEqual(externalRule.provider, {
    mode: "filter",
    values: ["openai"]
  });
  assert.equal(Object.hasOwn(externalRule, "server_only"), false);

  const managedRule = payload.spend_limits.rules.find(
    (rule) => rule.id === "karv-staging-global-budget"
  );
  assert.deepEqual(managedRule, {
    id: "karv-staging-global-budget",
    enabled: true,
    limit: 5,
    limitType: "cost",
    window: 86400,
    technique: "fixed"
  });
});

test("configure fails before PUT when Stripe credentials exist", () => {
  const execution = runScript(configureScript, "configure-stripe", configureEnv);
  assert.notEqual(execution.status, 0);
  assert.match(execution.output, /configuração Stripe/i);
  assert.deepEqual(
    readCalls(execution.logPath).map((call) => call.method),
    ["GET"]
  );
});

test("configure fails before PUT when OpenTelemetry authorization exists", () => {
  const execution = runScript(configureScript, "configure-otel-auth", configureEnv);
  assert.notEqual(execution.status, 0);
  assert.match(execution.output, /authorization/i);
  assert.deepEqual(
    readCalls(execution.logPath).map((call) => call.method),
    ["GET"]
  );
});

test("configure rejects incomplete spend-limit input before any network call", () => {
  const execution = runScript(configureScript, "configure-success", {
    ...configureEnv,
    AI_GATEWAY_SPEND_LIMIT_WINDOW: ""
  });
  assert.notEqual(execution.status, 0);
  assert.match(execution.output, /devem ser informados juntos/i);
  assert.deepEqual(readCalls(execution.logPath), []);
});

test("pre audit reports current to proposed state without mutation", () => {
  const execution = runScript(auditScript, "audit-pre", auditPreEnv);
  assert.equal(execution.status, 0, execution.output);
  assert.match(execution.output, /\[proposta\] rate_limit:/);
  assert.match(execution.output, /\[proposta\] spend_limit:/);
  assert.match(execution.output, /Modo pre:/);
  assert.deepEqual(
    readCalls(execution.logPath).map((call) => call.method),
    ["GET", "GET"]
  );
});

test("post audit succeeds only when every requested control matches", () => {
  const execution = runScript(auditScript, "audit-post-success", auditPostEnv);
  assert.equal(execution.status, 0, execution.output);
  assert.match(execution.output, /\[ok\] Rate limit/);
  assert.match(execution.output, /\[ok\] Regra global de spend limit/);
});

test("post audit fails closed when a control diverges", () => {
  const execution = runScript(auditScript, "audit-post-mismatch", auditPostEnv);
  assert.notEqual(execution.status, 0);
  assert.match(execution.output, /Auditoria pós-apply estrita/i);
});

test("secret scanner inspects added lines without exposing matched values", () => {
  const benignDiff = [
    "diff --git a/example.txt b/example.txt",
    "--- a/example.txt",
    "+++ b/example.txt",
    "+CLOUDFLARE_API_TOKEN=${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "-ghp_removed_value_is_not_scanned"
  ].join("\n");
  assert.deepEqual(scanAddedLines(benignDiff), []);

  const syntheticToken = "gh" + "p_" + "A".repeat(36);
  const unsafeDiff = [
    "diff --git a/example.txt b/example.txt",
    "--- a/example.txt",
    "+++ b/example.txt",
    `+token=${syntheticToken}`
  ].join("\n");
  const findings = scanAddedLines(unsafeDiff);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].detector, "GitHub classic token");
  assert.equal(JSON.stringify(findings).includes(syntheticToken), false);
});

function runScript(scriptPath, scenario, extraEnv) {
  const directory = mkdtempSync(join(tmpdir(), "karv-admin-hardening-"));
  const logPath = join(directory, "requests.jsonl");
  const result = spawnSync(
    process.execPath,
    ["--import", mockLoader, scriptPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...extraEnv,
        MOCK_REQUEST_LOG: logPath,
        MOCK_SCENARIO: scenario
      },
      timeout: 10_000
    }
  );

  return {
    logPath,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    signal: result.signal,
    status: result.status
  };
}

function readCalls(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line));
}
