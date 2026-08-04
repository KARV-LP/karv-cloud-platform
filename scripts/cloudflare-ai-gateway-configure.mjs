// Configura rate limit, Zero Data Retention (ZDR) e, opcionalmente, spend
// limit no AI Gateway staging via API Cloudflare (sem Terraform).
//
// Em vez de espalhar (`...current`) a configuração atual de volta na
// requisição PUT — o que reenviaria campos somente leitura como id,
// created_at, modified_at, account_id e account_tag — este script remove
// explicitamente esses campos e escreve apenas os controles que este
// workflow gerencia. Qualquer outro campo lido da API é preservado como
// veio, para não resetar configurações fora do escopo desta auditoria (cache,
// autenticação, logpush etc.) por omissão.
//
// collect_logs e zdr são sempre forçados aos valores exigidos pela issue #18
// (false e true, respectivamente) — não são inputs por execução. rate limit é
// sempre aplicado. spend limit só é aplicado se ambos
// AI_GATEWAY_SPEND_LIMIT_AMOUNT e AI_GATEWAY_SPEND_LIMIT_PERIOD estiverem
// presentes; se ausentes, o campo não é tocado nesta execução.
//
// Os nomes de campo (zdr, spend_limit_amount, spend_limit_period,
// rate_limiting_*, collect_logs) refletem os requisitos informados para este
// workflow. Cada valor gravado é lido de volta e comparado byte a byte com o
// solicitado; se a API não aceitar ou ignorar silenciosamente um campo, este
// script falha em vez de reportar sucesso indevido.

const READ_ONLY_FIELDS = ["id", "created_at", "modified_at", "account_id", "account_tag"];
const RATE_LIMITING_TECHNIQUE = "sliding";
const VALID_SPEND_LIMIT_PERIODS = new Set(["daily", "weekly", "monthly"]);

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

const spendLimitAmountRaw = process.env.AI_GATEWAY_SPEND_LIMIT_AMOUNT ?? "";
const spendLimitPeriodRaw = process.env.AI_GATEWAY_SPEND_LIMIT_PERIOD ?? "";
const spendLimitRequested = spendLimitAmountRaw !== "" || spendLimitPeriodRaw !== "";
let spendLimitAmount;
let spendLimitPeriod;

if (spendLimitRequested) {
  spendLimitAmount = Number(spendLimitAmountRaw);
  spendLimitPeriod = spendLimitPeriodRaw;

  if (!Number.isFinite(spendLimitAmount) || spendLimitAmount <= 0) {
    console.error("AI_GATEWAY_SPEND_LIMIT_AMOUNT deve ser um número maior que zero.");
    process.exit(1);
  }
  if (!VALID_SPEND_LIMIT_PERIODS.has(spendLimitPeriod)) {
    console.error("AI_GATEWAY_SPEND_LIMIT_PERIOD deve ser daily, weekly ou monthly.");
    process.exit(1);
  }
} else {
  console.log(
    "Spend limit não solicitado nesta execução (AI_GATEWAY_SPEND_LIMIT_AMOUNT/PERIOD ausentes) — campo não será tocado."
  );
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/karv-ai-gateway-staging`;

const current = await cloudflareRequest(baseUrl, "GET");
console.log(
  `Estado atual antes da mudança: rate_limit=${current.rate_limiting_limit ?? "não configurado"}/${current.rate_limiting_interval ?? "não configurado"}s, collect_logs=${current.collect_logs}, zdr=${current.zdr}, spend_limit=${current.spend_limit_amount ?? "não configurado"}/${current.spend_limit_period ?? "não configurado"}`
);

const payload = { ...current };
for (const field of READ_ONLY_FIELDS) delete payload[field];

payload.collect_logs = false;
payload.zdr = true;
payload.rate_limiting_limit = requests;
payload.rate_limiting_interval = periodSeconds;
payload.rate_limiting_technique = RATE_LIMITING_TECHNIQUE;

if (spendLimitRequested) {
  payload.spend_limit_amount = spendLimitAmount;
  payload.spend_limit_period = spendLimitPeriod;
}

const updated = await cloudflareRequest(baseUrl, "PUT", payload);

const mismatches = [];
if (updated.rate_limiting_limit !== requests || updated.rate_limiting_interval !== periodSeconds) {
  mismatches.push(
    `rate limit esperado ${requests}/${periodSeconds}s, obtido ${updated.rate_limiting_limit}/${updated.rate_limiting_interval}s`
  );
}
if (updated.collect_logs !== false) {
  mismatches.push(`collect_logs esperado false, obtido ${JSON.stringify(updated.collect_logs)}`);
}
if (updated.zdr !== true) {
  mismatches.push(`zdr esperado true, obtido ${JSON.stringify(updated.zdr)}`);
}
if (
  spendLimitRequested &&
  (updated.spend_limit_amount !== spendLimitAmount || updated.spend_limit_period !== spendLimitPeriod)
) {
  mismatches.push(
    `spend limit esperado ${spendLimitAmount}/${spendLimitPeriod}, obtido ${updated.spend_limit_amount}/${updated.spend_limit_period}`
  );
}

if (mismatches.length > 0) {
  console.error(
    `A API Cloudflare não retornou os valores esperados após a atualização: ${mismatches.join("; ")}. Isso pode indicar que os nomes de campo do AI Gateway mudaram — verificar manualmente antes de repetir.`
  );
  process.exit(1);
}

console.log(
  `AI Gateway staging atualizado: rate limit ${requests} req/${periodSeconds}s, collect_logs=false, zdr=true${spendLimitRequested ? `, spend limit ${spendLimitAmount}/${spendLimitPeriod}` : ""}.`
);

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
