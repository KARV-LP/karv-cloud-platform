// Auditoria dos controles administrativos do staging Cloudflare (issue #18).
// Nunca imprime valores de secret, apenas nomes e status de configuração.
//
// Modos (env AUDIT_MODE):
//   pre  — usado antes do apply. Registra o estado inicial (inclusive ausência
//          de secret, ZDR desligado ou rate limit ainda não configurado) sem
//          falhar por isso, e mostra "atual → proposto" para cada controle com
//          valor de entrada disponível nesta execução, sem nenhuma mutação.
//          Falha somente se a própria chamada à API Cloudflare falhar (token
//          insuficiente, rede, etc.) — não presume que um controle está ativo
//          nem que a API está acessível.
//   post — usado depois do apply. É estrito: falha se o secret continuar
//          ausente, se o rate limit não corresponder ao valor esperado, se ZDR
//          não estiver ativo, se payload logging estiver habilitado, ou se um
//          spend limit solicitado nesta execução não tiver sido aplicado.
//
// Requer CLOUDFLARE_API_TOKEN (token administrativo de privilégio mínimo) e
// CLOUDFLARE_ACCOUNT_ID no ambiente.
//
// Em ambos os modos, os valores propostos/esperados de rate limit são lidos de
// PROPOSED_*/EXPECTED_* (pre/post respectivamente). Spend limit é opcional por
// execução: se AI_GATEWAY_SPEND_LIMIT_AMOUNT/PERIOD (ou o par
// EXPECTED_SPEND_LIMIT_*) não forem informados, o controle é reportado como
// "não solicitado nesta execução", nunca como concluído.

const WORKER_NAME = "karv-cloud-platform-staging";
const AI_GATEWAY_ID = "karv-ai-gateway-staging";
const REQUIRED_SECRET_NAMES = ["KARV_INTERNAL_API_TOKEN"];
const VALID_SPEND_LIMIT_PERIODS = new Set(["daily", "weekly", "monthly"]);

const mode = requireEnv("AUDIT_MODE");
if (mode !== "pre" && mode !== "post") {
  console.error(`AUDIT_MODE inválido: "${mode}". Use "pre" ou "post".`);
  process.exit(1);
}

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");

const prefix = mode === "pre" ? "PROPOSED" : "EXPECTED";
const rateLimitRequests = Number(requireEnv(`${prefix}_RATE_LIMIT_REQUESTS`));
const rateLimitPeriodSeconds = Number(requireEnv(`${prefix}_RATE_LIMIT_PERIOD_SECONDS`));

if (!Number.isInteger(rateLimitRequests) || rateLimitRequests <= 0) {
  console.error(`${prefix}_RATE_LIMIT_REQUESTS deve ser um inteiro maior que zero.`);
  process.exit(1);
}
if (!Number.isInteger(rateLimitPeriodSeconds) || rateLimitPeriodSeconds <= 0) {
  console.error(`${prefix}_RATE_LIMIT_PERIOD_SECONDS deve ser um inteiro maior que zero.`);
  process.exit(1);
}

const spendLimitAmountRaw = process.env[`${prefix}_SPEND_LIMIT_AMOUNT`] ?? "";
const spendLimitPeriodRaw = process.env[`${prefix}_SPEND_LIMIT_PERIOD`] ?? "";
const spendLimitRequested = spendLimitAmountRaw !== "" || spendLimitPeriodRaw !== "";
let spendLimitAmount;
let spendLimitPeriod;

if (spendLimitRequested) {
  spendLimitAmount = Number(spendLimitAmountRaw);
  spendLimitPeriod = spendLimitPeriodRaw;

  if (!Number.isFinite(spendLimitAmount) || spendLimitAmount <= 0) {
    console.error(`${prefix}_SPEND_LIMIT_AMOUNT deve ser um número maior que zero.`);
    process.exit(1);
  }
  if (!VALID_SPEND_LIMIT_PERIODS.has(spendLimitPeriod)) {
    console.error(`${prefix}_SPEND_LIMIT_PERIOD deve ser daily, weekly ou monthly.`);
    process.exit(1);
  }
}

const findings = [];
let hasBlocker = false;
let hasApiFailure = false;

const secretNames = await auditWorkerSecrets();
const gateway = await auditAiGateway();

console.log(`\n=== Auditoria administrativa do staging — modo "${mode}" ===\n`);
for (const finding of findings) console.log(finding);

if (gateway) {
  console.log("\nEstado bruto retornado pela API do AI Gateway (não sensível):");
  console.log(
    JSON.stringify(
      {
        id: gateway.id,
        collect_logs: gateway.collect_logs,
        zdr: gateway.zdr,
        rate_limiting_limit: gateway.rate_limiting_limit,
        rate_limiting_interval: gateway.rate_limiting_interval,
        rate_limiting_technique: gateway.rate_limiting_technique,
        spend_limit_amount: gateway.spend_limit_amount,
        spend_limit_period: gateway.spend_limit_period
      },
      null,
      2
    )
  );
}

if (hasApiFailure) {
  console.error(
    "\nA auditoria não pôde ler o estado real na API Cloudflare. Interrompendo — não presumir que os controles estão ativos."
  );
  process.exit(1);
}

if (mode === "post" && hasBlocker) {
  console.error(
    "\nAuditoria pós-apply estrita: um ou mais controles administrativos não foram confirmados. Ver detalhes acima."
  );
  process.exit(1);
}

if (mode === "pre" && hasBlocker) {
  console.log(
    "\nModo pre: estado inicial registrado com pendências (esperado antes do apply). Revisar antes de aprovar o job apply."
  );
}

async function auditWorkerSecrets() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`;
  const body = await cloudflareGet(url, "Workers Scripts");
  if (!body) return null;

  const names = new Set((body.result ?? []).map((secret) => secret.name));

  for (const secretName of REQUIRED_SECRET_NAMES) {
    const present = names.has(secretName);
    if (present) {
      findings.push(`[ok] Secret "${secretName}" está presente no Worker ${WORKER_NAME}.`);
    } else if (mode === "pre") {
      findings.push(
        `[pendente] Secret "${secretName}" ainda não está presente no Worker ${WORKER_NAME}.`
      );
      hasBlocker = true;
    } else {
      findings.push(
        `[bloqueio] Secret "${secretName}" continua ausente no Worker ${WORKER_NAME} após o apply.`
      );
      hasBlocker = true;
    }
  }

  return names;
}

async function auditAiGateway() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${AI_GATEWAY_ID}`;
  const body = await cloudflareGet(url, "AI Gateway");
  if (!body) return null;

  const gateway = body.result;

  auditCollectLogs(gateway);
  auditZdr(gateway);
  auditRateLimit(gateway);
  auditSpendLimit(gateway);

  return gateway;
}

function auditCollectLogs(gateway) {
  if (gateway.collect_logs === false) {
    findings.push("[ok] Payload logging (collect_logs) está desativado no AI Gateway staging.");
  } else if (gateway.collect_logs === true) {
    const tag = mode === "pre" ? "pendente" : "bloqueio";
    findings.push(
      `[${tag}] Payload logging (collect_logs) está ATIVADO no AI Gateway staging — viola docs/staging-security.md.`
    );
    hasBlocker = true;
  } else {
    findings.push(
      `[bloqueio] Campo collect_logs não retornou um booleano esperado (valor: ${JSON.stringify(gateway.collect_logs)}). Verificar manualmente no painel Cloudflare.`
    );
    hasBlocker = true;
  }
}

function auditZdr(gateway) {
  if (gateway.zdr === true) {
    findings.push("[ok] Zero Data Retention (zdr) está ativo no AI Gateway staging.");
    return;
  }

  if (gateway.zdr === false || gateway.zdr === undefined) {
    if (mode === "pre") {
      findings.push(
        `[proposta] zdr: atual=${JSON.stringify(gateway.zdr ?? "não configurado")} → proposto=true`
      );
      hasBlocker = true;
    } else {
      findings.push(
        "[bloqueio] Zero Data Retention (zdr) continua desativado no AI Gateway staging após o apply — exigido pela issue #18."
      );
      hasBlocker = true;
    }
    return;
  }

  findings.push(
    `[bloqueio] Campo zdr não retornou um booleano esperado (valor: ${JSON.stringify(gateway.zdr)}). Verificar manualmente no painel Cloudflare.`
  );
  hasBlocker = true;
}

function auditRateLimit(gateway) {
  const hasRateLimit =
    typeof gateway.rate_limiting_limit === "number" &&
    typeof gateway.rate_limiting_interval === "number";

  if (mode === "pre") {
    const current = hasRateLimit
      ? `${gateway.rate_limiting_limit} req/${gateway.rate_limiting_interval}s`
      : "não configurado";
    findings.push(
      `[proposta] rate_limit: atual=${current} → proposto=${rateLimitRequests} req/${rateLimitPeriodSeconds}s`
    );
    if (!hasRateLimit) hasBlocker = true;
    return;
  }

  if (!hasRateLimit) {
    findings.push("[bloqueio] Rate limit do AI Gateway staging não está configurado após o apply.");
    hasBlocker = true;
    return;
  }

  const matches =
    gateway.rate_limiting_limit === rateLimitRequests &&
    gateway.rate_limiting_interval === rateLimitPeriodSeconds;

  if (matches) {
    findings.push("[ok] Rate limit do AI Gateway staging corresponde ao valor solicitado.");
  } else {
    findings.push(
      `[bloqueio] Rate limit do AI Gateway staging (${gateway.rate_limiting_limit}/${gateway.rate_limiting_interval}s) não corresponde ao solicitado (${rateLimitRequests}/${rateLimitPeriodSeconds}s).`
    );
    hasBlocker = true;
  }
}

function auditSpendLimit(gateway) {
  const hasSpendLimit =
    typeof gateway.spend_limit_amount === "number" && Boolean(gateway.spend_limit_period);

  if (!spendLimitRequested) {
    findings.push(
      `[info] Spend limit não solicitado nesta execução (estado atual: ${hasSpendLimit ? `${gateway.spend_limit_amount}/${gateway.spend_limit_period}` : "não configurado"}). Decisão C permanece pendente até uma execução informar o valor.`
    );
    return;
  }

  if (mode === "pre") {
    const current = hasSpendLimit
      ? `${gateway.spend_limit_amount}/${gateway.spend_limit_period}`
      : "não configurado";
    findings.push(
      `[proposta] spend_limit: atual=${current} → proposto=${spendLimitAmount}/${spendLimitPeriod}`
    );
    return;
  }

  const matches =
    hasSpendLimit &&
    gateway.spend_limit_amount === spendLimitAmount &&
    gateway.spend_limit_period === spendLimitPeriod;

  if (matches) {
    findings.push("[ok] Spend limit do AI Gateway staging corresponde ao valor solicitado.");
  } else {
    findings.push(
      `[bloqueio] Spend limit do AI Gateway staging (${hasSpendLimit ? `${gateway.spend_limit_amount}/${gateway.spend_limit_period}` : "não configurado"}) não corresponde ao solicitado (${spendLimitAmount}/${spendLimitPeriod}).`
    );
    hasBlocker = true;
  }
}

async function cloudflareGet(url, permissionLabel) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    }
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    findings.push(
      `[falha-api] Chamada Cloudflare falhou (${response.status}) ao consultar ${new URL(url).pathname}. Verifique se o token administrativo tem a permissão "${permissionLabel}".`
    );
    hasApiFailure = true;
    return null;
  }

  return body;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variável obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return value;
}
