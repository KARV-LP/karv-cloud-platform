// Configura o rate limit do AI Gateway staging via API Cloudflare (sem Terraform).
// Lê a configuração atual, sobrepõe somente os campos de rate limit e grava de
// volta — preserva collect_logs e demais campos existentes em vez de assumir o
// formato completo do recurso. Não imprime o token.
//
// Requer CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
// AI_GATEWAY_RATE_LIMIT_REQUESTS, AI_GATEWAY_RATE_LIMIT_PERIOD_SECONDS.
//
// A técnica de rate limit ("sliding") é um detalhe de implementação, não uma
// decisão de negócio, e por isso fica fixa aqui em vez de virar input do
// workflow.

const AI_GATEWAY_ID = "karv-ai-gateway-staging";
const RATE_LIMITING_TECHNIQUE = "sliding";

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
const requests = Number(requireEnv("AI_GATEWAY_RATE_LIMIT_REQUESTS"));
const periodSeconds = Number(requireEnv("AI_GATEWAY_RATE_LIMIT_PERIOD_SECONDS"));

if (!Number.isInteger(requests) || requests <= 0) {
  console.error("AI_GATEWAY_RATE_LIMIT_REQUESTS deve ser um inteiro maior que zero.");
  process.exit(1);
}
if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
  console.error("AI_GATEWAY_RATE_LIMIT_PERIOD_SECONDS deve ser um inteiro maior que zero.");
  process.exit(1);
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${AI_GATEWAY_ID}`;

const current = await cloudflareRequest(baseUrl, "GET");
console.log(
  `Rate limit atual antes da mudança: ${current.rate_limiting_limit ?? "não configurado"} / ${current.rate_limiting_interval ?? "não configurado"}s`
);

const updated = await cloudflareRequest(baseUrl, "PUT", {
  ...current,
  rate_limiting_limit: requests,
  rate_limiting_interval: periodSeconds,
  rate_limiting_technique: RATE_LIMITING_TECHNIQUE
});

if (
  updated.rate_limiting_limit !== requests ||
  updated.rate_limiting_interval !== periodSeconds
) {
  console.error(
    `A API Cloudflare não retornou o rate limit esperado após a atualização. Esperado ${requests}/${periodSeconds}s, obtido ${updated.rate_limiting_limit}/${updated.rate_limiting_interval}s. Isso pode indicar que os nomes de campo do AI Gateway mudaram — verificar manualmente antes de repetir.`
  );
  process.exit(1);
}

console.log(`Rate limit do AI Gateway staging atualizado para ${requests} req / ${periodSeconds}s.`);

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
    console.error(
      `Chamada Cloudflare (${method} ${new URL(url).pathname}) falhou com status ${response.status}: ${JSON.stringify(parsed?.errors ?? parsed)}`
    );
    process.exit(1);
  }

  return parsed.result;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variável obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return value;
}
