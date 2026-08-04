// Auditoria dos controles administrativos do staging Cloudflare (issue #18).
// Nunca imprime valores de secret, apenas nomes e status de configuração.
//
// Modos (env AUDIT_MODE):
//   pre  — usado antes do apply. Registra o estado inicial (inclusive ausência
//          de secret ou rate limit ainda não configurado) sem falhar por isso.
//          Falha somente se a própria chamada à API Cloudflare falhar (token
//          insuficiente, rede, etc.) — não presume que um controle está ativo
//          nem que a API está acessível.
//   post — usado depois do apply. É estrito: falha se o secret continuar
//          ausente, se o rate limit não corresponder ao valor esperado, ou se
//          payload logging estiver habilitado.
//
// Requer CLOUDFLARE_API_TOKEN (token administrativo de privilégio mínimo) e
// CLOUDFLARE_ACCOUNT_ID no ambiente. Em modo post, requer também
// EXPECTED_RATE_LIMIT_REQUESTS e EXPECTED_RATE_LIMIT_PERIOD_SECONDS.

const WORKER_NAME = "karv-cloud-platform-staging";
const AI_GATEWAY_ID = "karv-ai-gateway-staging";
const REQUIRED_SECRET_NAMES = ["KARV_INTERNAL_API_TOKEN"];

const mode = requireEnv("AUDIT_MODE");
if (mode !== "pre" && mode !== "post") {
  console.error(`AUDIT_MODE inválido: "${mode}". Use "pre" ou "post".`);
  process.exit(1);
}

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");

let expectedRequests;
let expectedPeriodSeconds;
if (mode === "post") {
  expectedRequests = Number(requireEnv("EXPECTED_RATE_LIMIT_REQUESTS"));
  expectedPeriodSeconds = Number(requireEnv("EXPECTED_RATE_LIMIT_PERIOD_SECONDS"));
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
        rate_limiting_limit: gateway.rate_limiting_limit,
        rate_limiting_interval: gateway.rate_limiting_interval,
        rate_limiting_technique: gateway.rate_limiting_technique
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

  if (gateway.collect_logs === false) {
    findings.push("[ok] Payload logging (collect_logs) está desativado no AI Gateway staging.");
  } else if (gateway.collect_logs === true) {
    findings.push(
      "[bloqueio] Payload logging (collect_logs) está ATIVADO no AI Gateway staging — viola docs/staging-security.md."
    );
    hasBlocker = true;
  } else {
    findings.push(
      `[bloqueio] Campo collect_logs não retornou um booleano esperado (valor: ${JSON.stringify(gateway.collect_logs)}). Verificar manualmente no painel Cloudflare.`
    );
    hasBlocker = true;
  }

  const hasRateLimit =
    typeof gateway.rate_limiting_limit === "number" &&
    typeof gateway.rate_limiting_interval === "number";

  if (!hasRateLimit) {
    if (mode === "pre") {
      findings.push("[pendente] Rate limit do AI Gateway staging ainda não está configurado.");
    } else {
      findings.push(
        "[bloqueio] Rate limit do AI Gateway staging não está configurado após o apply."
      );
    }
    hasBlocker = true;
  } else {
    findings.push(
      `[info] Rate limit atual do AI Gateway staging: ${gateway.rate_limiting_limit} req / ${gateway.rate_limiting_interval}s (técnica: ${gateway.rate_limiting_technique ?? "desconhecida"}).`
    );

    if (mode === "post") {
      const matches =
        gateway.rate_limiting_limit === expectedRequests &&
        gateway.rate_limiting_interval === expectedPeriodSeconds;

      if (matches) {
        findings.push("[ok] Rate limit do AI Gateway staging corresponde ao valor solicitado.");
      } else {
        findings.push(
          `[bloqueio] Rate limit do AI Gateway staging (${gateway.rate_limiting_limit}/${gateway.rate_limiting_interval}s) não corresponde ao solicitado (${expectedRequests}/${expectedPeriodSeconds}s).`
        );
        hasBlocker = true;
      }
    }
  }

  return gateway;
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
