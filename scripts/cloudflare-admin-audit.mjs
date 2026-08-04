// Auditoria dos controles administrativos do staging Cloudflare (issue #18).
// Nunca imprime valores de secret, apenas nomes e estado não sensível.
//
// AUDIT_MODE=pre: leitura somente; mostra atual → proposto e não falha apenas
// porque o controle ainda não existe. AUDIT_MODE=post: estrito; falha se a
// escrita não estiver confirmada.

const WORKER_NAME = "karv-cloud-platform-staging";
const AI_GATEWAY_ID = "karv-ai-gateway-staging";
const REQUIRED_SECRET_NAMES = ["KARV_INTERNAL_API_TOKEN"];
const MANAGED_SPEND_LIMIT_RULE_ID = "karv-staging-global-budget";
const EXPECTED_RATE_LIMITING_TECHNIQUE = "sliding";
const EXPECTED_SPEND_LIMIT_TECHNIQUE = "fixed";
const REQUEST_TIMEOUT_MS = 30_000;

const mode = requireEnv("AUDIT_MODE");
if (mode !== "pre" && mode !== "post") {
  fail(`AUDIT_MODE inválido: "${mode}". Use "pre" ou "post".`);
}

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
const prefix = mode === "pre" ? "PROPOSED" : "EXPECTED";

const rateLimitRequests = parsePositiveInteger(
  requireEnv(`${prefix}_RATE_LIMIT_REQUESTS`),
  `${prefix}_RATE_LIMIT_REQUESTS`
);
const rateLimitPeriodSeconds = parsePositiveInteger(
  requireEnv(`${prefix}_RATE_LIMIT_PERIOD_SECONDS`),
  `${prefix}_RATE_LIMIT_PERIOD_SECONDS`
);

const spendLimitAmountRaw = process.env[`${prefix}_SPEND_LIMIT_AMOUNT`] ?? "";
const spendLimitWindowRaw = process.env[`${prefix}_SPEND_LIMIT_WINDOW`] ?? "";
const spendLimitRequested = spendLimitAmountRaw !== "" || spendLimitWindowRaw !== "";
let spendLimitAmount;
let spendLimitWindow;

if (spendLimitRequested) {
  if (spendLimitAmountRaw === "" || spendLimitWindowRaw === "") {
    fail(
      `${prefix}_SPEND_LIMIT_AMOUNT e ${prefix}_SPEND_LIMIT_WINDOW devem ser informados juntos.`
    );
  }
  spendLimitAmount = parsePositiveNumber(
    spendLimitAmountRaw,
    `${prefix}_SPEND_LIMIT_AMOUNT`
  );
  spendLimitWindow = parsePositiveInteger(
    spendLimitWindowRaw,
    `${prefix}_SPEND_LIMIT_WINDOW`
  );
}

const findings = [];
let hasBlocker = false;
let hasApiFailure = false;

await auditWorkerSecrets();
const gateway = await auditAiGateway();

console.log(`\n=== Auditoria administrativa do staging — modo "${mode}" ===\n`);
for (const finding of findings) console.log(finding);

if (gateway) {
  const managedRule = findManagedSpendLimitRule(gateway.spend_limits);
  console.log("\nEstado sanitizado retornado pela API do AI Gateway:");
  console.log(
    JSON.stringify(
      {
        id: gateway.id,
        collect_logs: gateway.collect_logs,
        zdr: gateway.zdr,
        rate_limiting_limit: gateway.rate_limiting_limit,
        rate_limiting_interval: gateway.rate_limiting_interval,
        rate_limiting_technique: gateway.rate_limiting_technique,
        spend_limits_enabled: gateway.spend_limits?.enabled,
        managed_spend_limit_rule: managedRule
          ? {
              id: managedRule.id,
              enabled: managedRule.enabled,
              limit: managedRule.limit,
              limitType: managedRule.limitType,
              window: managedRule.window,
              technique: managedRule.technique
            }
          : null
      },
      null,
      2
    )
  );
}

if (hasApiFailure) {
  fail(
    "A auditoria não pôde ler o estado real na API Cloudflare. Não presumir que os controles estão ativos."
  );
}
if (mode === "post" && hasBlocker) {
  fail(
    "Auditoria pós-apply estrita: um ou mais controles administrativos não foram confirmados."
  );
}
if (mode === "pre" && hasBlocker) {
  console.log(
    "\nModo pre: estado inicial registrado com pendências; revisar a proposta antes de aprovar o apply."
  );
}

async function auditWorkerSecrets() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`;
  const body = await cloudflareGet(url, "Workers Scripts Read");
  if (!body) return;

  if (!Array.isArray(body.result)) {
    findings.push("[falha-api] A API de Workers não retornou uma lista de secrets.");
    hasApiFailure = true;
    return;
  }

  const names = new Set(body.result.map((secret) => secret?.name).filter(Boolean));
  for (const secretName of REQUIRED_SECRET_NAMES) {
    if (names.has(secretName)) {
      findings.push(`[ok] Secret "${secretName}" está presente no Worker ${WORKER_NAME}.`);
    } else {
      const tag = mode === "pre" ? "pendente" : "bloqueio";
      findings.push(
        `[${tag}] Secret "${secretName}" ${mode === "pre" ? "ainda não está presente" : "continua ausente"} no Worker ${WORKER_NAME}.`
      );
      hasBlocker = true;
    }
  }
}

async function auditAiGateway() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${AI_GATEWAY_ID}`;
  const body = await cloudflareGet(url, "AI Gateway Read");
  if (!body) return null;

  const gateway = body.result;
  if (!isPlainObject(gateway) || gateway.id !== AI_GATEWAY_ID) {
    findings.push(
      `[falha-api] Gateway retornado é ${JSON.stringify(gateway?.id)}, esperado ${AI_GATEWAY_ID}.`
    );
    hasApiFailure = true;
    return null;
  }

  auditSensitivePreservationConstraints(gateway);
  auditCollectLogs(gateway);
  auditZdr(gateway);
  auditRateLimit(gateway);
  auditSpendLimit(gateway);
  return gateway;
}

function auditSensitivePreservationConstraints(gateway) {
  if (gateway.stripe != null) {
    findings.push(
      "[bloqueio] O gateway possui configuração Stripe; o PUT administrativo não pode preservá-la com segurança por leitura-escrita."
    );
    hasBlocker = true;
  }

  const otelEntries = gateway.otel;
  if (otelEntries != null && !Array.isArray(otelEntries)) {
    findings.push("[bloqueio] O campo otel retornado pela API não é uma lista.");
    hasBlocker = true;
    return;
  }

  if (
    Array.isArray(otelEntries) &&
    otelEntries.some(
      (entry) =>
        entry &&
        Object.prototype.hasOwnProperty.call(entry, "authorization") &&
        entry.authorization != null &&
        entry.authorization !== ""
    )
  ) {
    findings.push(
      "[bloqueio] O gateway possui OpenTelemetry com authorization; o PUT administrativo não pode reenviar essa credencial com segurança."
    );
    hasBlocker = true;
  }
}

function auditCollectLogs(gateway) {
  if (gateway.collect_logs === false) {
    findings.push("[ok] Payload logging (collect_logs) está desativado no AI Gateway staging.");
    return;
  }

  if (gateway.collect_logs === true) {
    const tag = mode === "pre" ? "proposta" : "bloqueio";
    findings.push(
      mode === "pre"
        ? `[${tag}] collect_logs: atual=true → proposto=false`
        : `[${tag}] Payload logging (collect_logs) continua ativo após o apply.`
    );
  } else {
    findings.push(
      `[bloqueio] collect_logs retornou valor inválido: ${JSON.stringify(gateway.collect_logs)}.`
    );
  }
  hasBlocker = true;
}

function auditZdr(gateway) {
  if (gateway.zdr === true) {
    findings.push("[ok] Zero Data Retention (zdr) está ativo no AI Gateway staging.");
    return;
  }

  if (mode === "pre" && (gateway.zdr === false || gateway.zdr === undefined)) {
    findings.push(
      `[proposta] zdr: atual=${JSON.stringify(gateway.zdr ?? "não configurado")} → proposto=true`
    );
  } else {
    findings.push(
      `[bloqueio] Zero Data Retention (zdr) não está ativo após o apply; valor=${JSON.stringify(gateway.zdr)}.`
    );
  }
  hasBlocker = true;
}

function auditRateLimit(gateway) {
  const hasRateLimit =
    typeof gateway.rate_limiting_limit === "number" &&
    typeof gateway.rate_limiting_interval === "number";
  const current = hasRateLimit
    ? `${gateway.rate_limiting_limit} req/${gateway.rate_limiting_interval}s (${gateway.rate_limiting_technique ?? "sem técnica"})`
    : "não configurado";

  if (mode === "pre") {
    findings.push(
      `[proposta] rate_limit: atual=${current} → proposto=${rateLimitRequests} req/${rateLimitPeriodSeconds}s (${EXPECTED_RATE_LIMITING_TECHNIQUE})`
    );
    if (!hasRateLimit) hasBlocker = true;
    return;
  }

  const matches =
    hasRateLimit &&
    gateway.rate_limiting_limit === rateLimitRequests &&
    gateway.rate_limiting_interval === rateLimitPeriodSeconds &&
    gateway.rate_limiting_technique === EXPECTED_RATE_LIMITING_TECHNIQUE;

  if (matches) {
    findings.push("[ok] Rate limit do AI Gateway staging corresponde ao solicitado.");
  } else {
    findings.push(
      `[bloqueio] Rate limit atual (${current}) não corresponde ao solicitado (${rateLimitRequests} req/${rateLimitPeriodSeconds}s, ${EXPECTED_RATE_LIMITING_TECHNIQUE}).`
    );
    hasBlocker = true;
  }
}

function auditSpendLimit(gateway) {
  const rule = findManagedSpendLimitRule(gateway.spend_limits);
  const current = formatManagedSpendLimit(gateway.spend_limits);

  if (!spendLimitRequested) {
    findings.push(
      `[info] Spend limit não solicitado nesta execução; regra KARV atual: ${current}. O estado não será alterado.`
    );
    return;
  }

  if (mode === "pre") {
    findings.push(
      `[proposta] spend_limit: atual=${current} → proposto=${spendLimitAmount}/window=${spendLimitWindow} (${EXPECTED_SPEND_LIMIT_TECHNIQUE})`
    );
    return;
  }

  const matches =
    gateway.spend_limits?.enabled === true &&
    rule?.enabled === true &&
    rule?.limitType === "cost" &&
    rule?.limit === spendLimitAmount &&
    rule?.window === spendLimitWindow &&
    rule?.technique === EXPECTED_SPEND_LIMIT_TECHNIQUE;

  if (matches) {
    findings.push("[ok] Regra global de spend limit KARV corresponde ao solicitado.");
  } else {
    findings.push(
      `[bloqueio] Regra global de spend limit KARV (${current}) não corresponde ao solicitado (${spendLimitAmount}/window=${spendLimitWindow}, ${EXPECTED_SPEND_LIMIT_TECHNIQUE}).`
    );
    hasBlocker = true;
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
  return `${rule.limit}/window=${rule.window} (${rule.technique ?? "sem técnica"}, enabled=${JSON.stringify(rule.enabled)}, gateway_enabled=${JSON.stringify(spendLimits?.enabled)})`;
}

async function cloudflareGet(url, permissionLabel) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    findings.push(
      `[falha-api] Consulta a ${new URL(url).pathname} falhou antes de receber resposta: ${error?.message ?? error}.`
    );
    hasApiFailure = true;
    return null;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    findings.push(
      `[falha-api] Consulta a ${new URL(url).pathname} falhou com HTTP ${response.status}. Verifique a permissão "${permissionLabel}".`
    );
    hasApiFailure = true;
    return null;
  }
  return body;
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
