// Configura rate limit, Zero Data Retention (ZDR) e, opcionalmente, uma regra
// global de spend limit no AI Gateway staging via API Cloudflare.
//
// O payload do PUT é construído por lista branca a partir dos campos graváveis
// documentados pela API. Campos somente leitura ou desconhecidos nunca são
// reenviados. Configurações que contenham credenciais de Stripe ou autorização
// OpenTelemetry fazem o script falhar antes da mutação.

const AI_GATEWAY_ID = "karv-ai-gateway-staging";
const RATE_LIMITING_TECHNIQUE = "sliding";
const MANAGED_SPEND_LIMIT_RULE_ID = "karv-staging-global-budget";
const MANAGED_SPEND_LIMIT_TECHNIQUE = "fixed";
const REQUEST_TIMEOUT_MS = 30_000;

const OPTIONAL_WRITABLE_FIELDS_TO_PRESERVE = [
  "authentication",
  "dlp",
  "guardrails",
  "log_management",
  "log_management_strategy",
  "logpush",
  "logpush_public_key",
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
    "Spend limit não solicitado nesta execução — a configuração existente será preservada e verificada."
  );
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${AI_GATEWAY_ID}`;
const current = await cloudflareRequest(baseUrl, "GET");

validateRequiredCurrentFields(current);
validateSensitivePreservationConstraints(current);

console.log(
  `Estado atual antes da mudança: rate_limit=${formatRateLimit(current)}, collect_logs=${JSON.stringify(current.collect_logs)}, zdr=${JSON.stringify(current.zdr)}, spend_limit=${formatManagedSpendLimit(current.spend_limits)}`
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
    payload[field] = cloneJson(current[field]);
  }
}

if (Object.prototype.hasOwnProperty.call(current, "otel")) {
  payload.otel = sanitizeOtel(current.otel);
}

const currentSpendLimits = Object.prototype.hasOwnProperty.call(current, "spend_limits")
  ? sanitizeSpendLimits(current.spend_limits)
  : undefined;

if (spendLimitRequested) {
  payload.spend_limits = buildSpendLimitsPayload(
    currentSpendLimits,
    spendLimitAmount,
    spendLimitWindow
  );
} else if (currentSpendLimits !== undefined) {
  payload.spend_limits = currentSpendLimits;
}

const updated = await cloudflareRequest(baseUrl, "PUT", payload);
const mismatches = [];

compareField(mismatches, "cache_invalidate_on_update", payload.cache_invalidate_on_update, updated.cache_invalidate_on_update);
compareField(mismatches, "cache_ttl", payload.cache_ttl, updated.cache_ttl);
compareField(mismatches, "collect_logs", false, updated.collect_logs);
compareField(mismatches, "zdr", true, updated.zdr);
compareField(mismatches, "rate_limiting_limit", requests, updated.rate_limiting_limit);
compareField(mismatches, "rate_limiting_interval", rateWindowSeconds, updated.rate_limiting_interval);
compareField(
  mismatches,
  "rate_limiting_technique",
  RATE_LIMITING_TECHNIQUE,
  updated.rate_limiting_technique
);

for (const field of OPTIONAL_WRITABLE_FIELDS_TO_PRESERVE) {
  if (Object.prototype.hasOwnProperty.call(payload, field)) {
    compareField(mismatches, field, payload[field], updated[field]);
  }
}
if (Object.prototype.hasOwnProperty.call(payload, "otel")) {
  compareField(mismatches, "otel", payload.otel, sanitizeOtel(updated.otel));
}

if (Object.prototype.hasOwnProperty.call(payload, "spend_limits")) {
  const updatedSpendLimits = sanitizeSpendLimits(updated.spend_limits);
  if (!equalSpendLimits(payload.spend_limits, updatedSpendLimits)) {
    mismatches.push(
      `spend_limits esperado ${formatJson(payload.spend_limits)}, obtido ${formatJson(updatedSpendLimits)}`
    );
  }
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
      `regra KARV esperada ${spendLimitAmount}/window=${spendLimitWindow}, obtida ${formatManagedSpendLimit(updated.spend_limits)}`
    );
  }
}

if (mismatches.length > 0) {
  fail(
    `A API Cloudflare não retornou o estado esperado após a atualização: ${mismatches.join("; ")}. Não considerar o hardening concluído.`
  );
}

console.log(
  `AI Gateway staging atualizado e confirmado: rate limit ${requests} req/${rateWindowSeconds}s, collect_logs=false, zdr=true${spendLimitRequested ? `, spend limit ${spendLimitAmount}/window=${spendLimitWindow}` : ""}.`
);

function buildSpendLimitsPayload(currentSpendLimits, amount, window) {
  const rules = currentSpendLimits?.rules ?? [];
  const withoutManagedRule = rules.filter(
    (rule) => rule.id !== MANAGED_SPEND_LIMIT_RULE_ID
  );

  if (withoutManagedRule.length >= 20) {
    fail(
      "O AI Gateway já possui 20 regras de spend limit e não contém espaço para a regra KARV gerenciada. Nenhuma mutação foi executada."
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

function sanitizeSpendLimits(spendLimits) {
  if (spendLimits === null) return null;
  if (!isPlainObject(spendLimits)) {
    fail(`spend_limits inválido na resposta da API: ${formatJson(spendLimits)}`);
  }

  const sanitized = {};
  if (Object.prototype.hasOwnProperty.call(spendLimits, "enabled")) {
    if (typeof spendLimits.enabled !== "boolean") {
      fail(`spend_limits.enabled inválido: ${formatJson(spendLimits.enabled)}`);
    }
    sanitized.enabled = spendLimits.enabled;
  }

  if (Object.prototype.hasOwnProperty.call(spendLimits, "rules")) {
    if (!Array.isArray(spendLimits.rules)) {
      fail("spend_limits.rules retornado pela API não é uma lista.");
    }
    if (spendLimits.rules.length > 20) {
      fail("spend_limits.rules excede o limite documentado de 20 regras.");
    }
    sanitized.rules = spendLimits.rules.map((rule, index) =>
      sanitizeSpendLimitRule(rule, index)
    );
  }

  return sanitized;
}

function sanitizeSpendLimitRule(rule, index) {
  if (!isPlainObject(rule)) {
    fail(`spend_limits.rules[${index}] não é um objeto.`);
  }

  const sanitized = {
    limit: parseApiPositiveNumber(rule.limit, `spend_limits.rules[${index}].limit`),
    limitType: rule.limitType,
    window: parseApiPositiveInteger(rule.window, `spend_limits.rules[${index}].window`)
  };

  if (sanitized.limitType !== "cost") {
    fail(`spend_limits.rules[${index}].limitType deve ser "cost".`);
  }

  if (Object.prototype.hasOwnProperty.call(rule, "id")) {
    if (typeof rule.id !== "string" || rule.id.length === 0) {
      fail(`spend_limits.rules[${index}].id inválido.`);
    }
    sanitized.id = rule.id;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "enabled")) {
    if (typeof rule.enabled !== "boolean") {
      fail(`spend_limits.rules[${index}].enabled inválido.`);
    }
    sanitized.enabled = rule.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "metadata")) {
    sanitized.metadata = sanitizeMetadata(rule.metadata, `spend_limits.rules[${index}].metadata`);
  }
  if (Object.prototype.hasOwnProperty.call(rule, "model")) {
    sanitized.model = sanitizeFilter(rule.model, `spend_limits.rules[${index}].model`);
  }
  if (Object.prototype.hasOwnProperty.call(rule, "provider")) {
    sanitized.provider = sanitizeFilter(rule.provider, `spend_limits.rules[${index}].provider`);
  }
  if (Object.prototype.hasOwnProperty.call(rule, "technique")) {
    if (rule.technique !== "fixed" && rule.technique !== "sliding") {
      fail(`spend_limits.rules[${index}].technique inválida.`);
    }
    sanitized.technique = rule.technique;
  }

  return sanitized;
}

function sanitizeMetadata(metadata, path) {
  if (!isPlainObject(metadata)) fail(`${path} deve ser um objeto.`);
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!isPlainObject(value)) fail(`${path}.${key} deve ser um objeto.`);
    if (value.mode === "partition") {
      sanitized[key] = { mode: "partition" };
    } else if (value.mode === "filter") {
      sanitized[key] = sanitizeFilter(value, `${path}.${key}`);
    } else {
      fail(`${path}.${key}.mode deve ser "partition" ou "filter".`);
    }
  }
  return sanitized;
}

function sanitizeFilter(filter, path) {
  if (!isPlainObject(filter) || filter.mode !== "filter" || !Array.isArray(filter.values)) {
    fail(`${path} deve conter mode="filter" e values como lista.`);
  }
  if (!filter.values.every((value) => typeof value === "string")) {
    fail(`${path}.values deve conter somente strings.`);
  }
  return { mode: "filter", values: [...filter.values] };
}

function sanitizeOtel(otel) {
  if (otel === null) return null;
  if (!Array.isArray(otel)) fail("otel retornado pela API não é uma lista.");

  return otel.map((entry, index) => {
    if (!isPlainObject(entry)) fail(`otel[${index}] não é um objeto.`);
    if (
      Object.prototype.hasOwnProperty.call(entry, "authorization") &&
      entry.authorization != null &&
      entry.authorization !== ""
    ) {
      fail(
        `otel[${index}] contém authorization. O script recusou o PUT para não reenviar ou substituir credenciais.`
      );
    }
    if (!isPlainObject(entry.headers)) fail(`otel[${index}].headers deve ser um objeto.`);
    if (typeof entry.url !== "string" || entry.url.length === 0) {
      fail(`otel[${index}].url inválida.`);
    }

    const sanitized = {
      headers: cloneJson(entry.headers),
      url: entry.url
    };
    if (Object.prototype.hasOwnProperty.call(entry, "content_type")) {
      if (entry.content_type !== "json" && entry.content_type !== "protobuf") {
        fail(`otel[${index}].content_type inválido.`);
      }
      sanitized.content_type = entry.content_type;
    }
    return sanitized;
  });
}

function validateSensitivePreservationConstraints(current) {
  if (current.stripe != null) {
    fail(
      "O AI Gateway possui configuração Stripe. O script recusou o PUT para não reenviar ou substituir credenciais por leitura-escrita."
    );
  }
  if (Object.prototype.hasOwnProperty.call(current, "otel")) {
    sanitizeOtel(current.otel);
  }
}

function findManagedSpendLimitRule(spendLimits) {
  if (!Array.isArray(spendLimits?.rules)) return null;
  return (
    spendLimits.rules.find((rule) => rule?.id === MANAGED_SPEND_LIMIT_RULE_ID) ?? null
  );
}

function formatManagedSpendLimit(spendLimits) {
  const rule = findManagedSpendLimitRule(spendLimits);
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
  if (!isPlainObject(current)) {
    fail("Resposta do AI Gateway não contém um objeto result válido.");
  }
  if (current.id !== AI_GATEWAY_ID) {
    fail(`Gateway retornado é ${JSON.stringify(current.id)}, esperado ${AI_GATEWAY_ID}.`);
  }
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
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    fail(`Chamada Cloudflare ${method} falhou antes de receber resposta: ${error?.message ?? error}`);
  }

  const parsed = await response.json().catch(() => null);
  if (!response.ok || !parsed?.success) {
    fail(
      `Chamada Cloudflare (${method} ${new URL(url).pathname}) falhou com status ${response.status}: ${JSON.stringify(parsed?.errors ?? parsed)}`
    );
  }
  return parsed.result;
}

function compareField(mismatches, name, expected, actual) {
  if (!deepEqual(expected, actual)) {
    mismatches.push(`${name} esperado ${formatJson(expected)}, obtido ${formatJson(actual)}`);
  }
}

function equalSpendLimits(left, right) {
  if (left === null || right === null) return left === right;
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  if (left.enabled !== right.enabled) return false;

  const leftRules = [...(left.rules ?? [])].map(canonicalString).sort();
  const rightRules = [...(right.rules ?? [])].map(canonicalString).sort();
  return deepEqual(leftRules, rightRules);
}

function deepEqual(left, right) {
  return canonicalString(left) === canonicalString(right);
}

function canonicalString(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatJson(value) {
  return JSON.stringify(value);
}

function parseApiPositiveNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${name} deve ser um número maior que zero.`);
  }
  return value;
}

function parseApiPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${name} deve ser um inteiro seguro maior que zero.`);
  }
  return value;
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
