// Configura rate limit, Zero Data Retention (ZDR) e, opcionalmente, uma regra
// global de spend limit no AI Gateway staging via API Cloudflare.
//
// O payload do PUT é construído por lista branca a partir dos campos graváveis
// documentados pela API. Campos somente leitura ou desconhecidos nunca são
// reenviados. A configuração Stripe não é reenviada: se estiver presente, o
// script falha antes da mutação porque a preservação segura de credenciais não
// pode ser garantida por uma leitura seguida de escrita.

const AI_GATEWAY_ID = "karv-ai-gateway-staging";
const RATE_LIMITING_TECHNIQUE = "sliding";
const MANAGED_SPEND_LIMIT_RULE_ID = "karv-staging-global-budget";
const MANAGED_SPEND_LIMIT_TECHNIQUE = "fixed";

const OPTIONAL_WRITABLE_FIELDS_TO_PRESERVE = [
  "authentication",
  "dlp",
  "guardrails",
  "log_management",
  "log_management_strategy",
  "logpush",
  "logpush_public_key",
  "otel",
  "retry_backoff",
  "retry_delay",
  "retry_max_attempts",
  "store_id",
  "workers_ai_billing_mode"
];

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
const requests = parsePositiveInteger(
  requireEnv("AI_GATEWAY_RATE_LIMIT_REQUESTS"),
  "AI_GATEWAY_RATE_LIMIT_REQUESTS"
);
const rateWindowSeconds = parsePositiveInteger(
  requireEnv("AI_GATEWAY_RATE_LIMIT_PERIOD_SECONDS"),
  "AI_GATEWAY_RATE_LIMIT_PERIOD_SECONDS"
);

const spendLimitAmountRaw = process.env.AI_GATEWAY_SPEND_LIMIT_AMOUNT ?? "";
const spendLimitWindowRaw = process.env.AI_GATEWAY_SPEND_LIMIT_WINDOW ?? "";
const spendLimitRequested = spendLimitAmountRaw !== "" || spendLimitWindowRaw !== "";
let spendLimitAmount;
let spendLimitWindow;

if (spendLimitRequested) {
  if (spendLimitAmountRaw === "" || spendLimitWindowRaw === "") {
    fail(
      "AI_GATEWAY_SPEND_LIMIT_AMOUNT e AI_GATEWAY_SPEND_LIMIT_WINDOW devem ser informados juntos."
    );
  }
  spendLimitAmount = parsePositiveNumber(
    spendLimitAmountRaw,
    "AI_GATEWAY_SPEND_LIMIT_AMOUNT"
  );
  spendLimitWindow = parsePositiveInteger(
    spendLimitWindowRaw,
    "AI_GATEWAY_SPEND_LIMIT_WINDOW"
  );
} else {
  console.log(
    "Spend limit não solicitado nesta execução — a configuração existente será preservada."
  );
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${AI_GATEWAY_ID}`;
const current = await cloudflareRequest(baseUrl, "GET");

validateRequiredCurrentFields(current);
if (current.stripe != null) {
  fail(
    "O AI Gateway possui configuração Stripe. O script recusou o PUT para não reenviar ou substituir credenciais por leitura-escrita. Tratar essa configuração separadamente."
  );
}

console.log(
  `Estado atual antes da mudança: rate_limit=${formatRateLimit(current)}, collect_logs=${JSON.stringify(current.collect_logs)}, zdr=${JSON.stringify(current.zdr)}, spend_limit=${formatManagedSpendLimit(current)}`
);

const payload = {
  cache_invalidate_on_update: current.cache_invalidate_on_update,
  cache_ttl: current.cache_ttl,
  collect_logs: false,
  rate_limiting_interval: rateWindowSeconds,
  rate_limiting_limit: requests,
  rate_limiting_technique: RATE_LIMITING_TECHNIQUE,
  zdr: true
};

for (const field of OPTIONAL_WRITABLE_FIELDS_TO_PRESERVE) {
  if (Object.prototype.hasOwnProperty.call(current, field)) {
    payload[field] = current[field];
  }
}

if (spendLimitRequested) {
  payload.spend_limits = buildSpendLimitsPayload(
    current.spend_limits,
    spendLimitAmount,
    spendLimitWindow
  );
} else if (Object.prototype.hasOwnProperty.call(current, "spend_limits")) {
  payload.spend_limits = current.spend_limits;
}

const updated = await cloudflareRequest(baseUrl, "PUT", payload);
const mismatches = [];

if (
  updated.rate_limiting_limit !== requests ||
  updated.rate_limiting_interval !== rateWindowSeconds ||
  updated.rate_limiting_technique !== RATE_LIMITING_TECHNIQUE
) {
  mismatches.push(
    `rate limit esperado ${requests}/${rateWindowSeconds}s (${RATE_LIMITING_TECHNIQUE}), obtido ${updated.rate_limiting_limit}/${updated.rate_limiting_interval}s (${updated.rate_limiting_technique})`
  );
}
if (updated.collect_logs !== false) {
  mismatches.push(`collect_logs esperado false, obtido ${JSON.stringify(updated.collect_logs)}`);
}
if (updated.zdr !== true) {
  mismatches.push(`zdr esperado true, obtido ${JSON.stringify(updated.zdr)}`);
}
if (spendLimitRequested) {
  const rule = findManagedSpendLimitRule(updated.spend_limits);
  if (
    updated.spend_limits?.enabled !== true ||
    !rule ||
    rule.enabled !== true ||
    rule.limitType !== "cost" ||
    rule.limit !== spendLimitAmount ||
    rule.window !== spendLimitWindow ||
    rule.technique !== MANAGED_SPEND_LIMIT_TECHNIQUE
  ) {
    mismatches.push(
      `spend limit esperado ${spendLimitAmount}/window=${spendLimitWindow}, obtido ${formatManagedSpendLimit(updated)}`
    );
  }
}

if (mismatches.length > 0) {
  fail(
    `A API Cloudflare não retornou os valores esperados após a atualização: ${mismatches.join("; ")}. Não considerar o hardening concluído.`
  );
}

console.log(
  `AI Gateway staging atualizado e confirmado: rate limit ${requests} req/${rateWindowSeconds}s, collect_logs=false, zdr=true${spendLimitRequested ? `, spend limit ${spendLimitAmount}/window=${spendLimitWindow}` : ""}.`
);

function buildSpendLimitsPayload(currentSpendLimits, amount, window) {
  const existingRules = currentSpendLimits?.rules;
  if (existingRules !== undefined && !Array.isArray(existingRules)) {
    fail("spend_limits.rules retornado pela API não é uma lista; recusando a mutação.");
  }

  const rules = Array.isArray(existingRules) ? existingRules : [];
  const withoutManagedRule = rules.filter(
    (rule) => rule?.id !== MANAGED_SPEND_LIMIT_RULE_ID
  );

  if (withoutManagedRule.length >= 20) {
    fail(
      "O AI Gateway já possui 20 regras de spend limit e não contém a regra KARV gerenciada. Nenhuma mutação foi executada."
    );
  }

  return {
    enabled: true,
    rules: [
      ...withoutManagedRule,
      {
        id: MANAGED_SPEND_LIMIT_RULE_ID,
        enabled: true,
        limit: amount,
        limitType: "cost",
        window,
        technique: MANAGED_SPEND_LIMIT_TECHNIQUE
      }
    ]
  };
}

function findManagedSpendLimitRule(spendLimits) {
  if (!Array.isArray(spendLimits?.rules)) return null;
  return (
    spendLimits.rules.find((rule) => rule?.id === MANAGED_SPEND_LIMIT_RULE_ID) ?? null
  );
}

function formatManagedSpendLimit(gateway) {
  const rule = findManagedSpendLimitRule(gateway?.spend_limits);
  if (!rule) return "não configurado";
  return `${rule.limit}/window=${rule.window} (${rule.technique ?? "sem técnica"}, enabled=${JSON.stringify(rule.enabled)})`;
}

function formatRateLimit(gateway) {
  if (
    typeof gateway?.rate_limiting_limit !== "number" ||
    typeof gateway?.rate_limiting_interval !== "number"
  ) {
    return "não configurado";
  }
  return `${gateway.rate_limiting_limit}/${gateway.rate_limiting_interval}s (${gateway.rate_limiting_technique ?? "sem técnica"})`;
}

function validateRequiredCurrentFields(current) {
  if (typeof current.cache_invalidate_on_update !== "boolean") {
    fail(
      `cache_invalidate_on_update inválido na resposta da API: ${JSON.stringify(current.cache_invalidate_on_update)}`
    );
  }
  if (!(current.cache_ttl === null || typeof current.cache_ttl === "number")) {
    fail(`cache_ttl inválido na resposta da API: ${JSON.stringify(current.cache_ttl)}`);
  }
}

async function cloudflareRequest(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const parsed = await response.json().catch(() => null);
  if (!response.ok || !parsed?.success) {
    fail(
      `Chamada Cloudflare (${method} ${new URL(url).pathname}) falhou com status ${response.status}: ${JSON.stringify(parsed?.errors ?? parsed)}`
    );
  }
  return parsed.result;
}

function parsePositiveInteger(raw, name) {
  if (!/^\d+$/.test(raw)) fail(`${name} deve ser um inteiro maior que zero.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${name} deve ser um inteiro seguro maior que zero.`);
  }
  return value;
}

function parsePositiveNumber(raw, name) {
  if (!/^\d+(\.\d+)?$/.test(raw)) fail(`${name} deve ser um número positivo.`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail(`${name} deve ser maior que zero.`);
  return value;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`Variável obrigatória ausente: ${name}`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
