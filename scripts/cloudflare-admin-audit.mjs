// Auditoria somente leitura dos controles administrativos do staging Cloudflare.
// Nunca imprime valores de secret, apenas nomes e status de configuração.
// Requer CLOUDFLARE_API_TOKEN (token administrativo de privilégio mínimo) e
// CLOUDFLARE_ACCOUNT_ID no ambiente. Falha (exit 1) se um controle não puder
// ser confirmado, em vez de presumir que está ativo.

const WORKER_NAME = "karv-cloud-platform-staging";
const REQUIRED_SECRET_NAMES = ["KARV_INTERNAL_API_TOKEN"];

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");

const findings = [];
let hasBlocker = false;

await auditWorkerSecrets();

for (const finding of findings) {
  console.log(finding);
}

if (hasBlocker) {
  console.error(
    "Um ou mais controles administrativos não puderam ser confirmados. Ver detalhes acima."
  );
  process.exit(1);
}

async function auditWorkerSecrets() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`;
  const response = await cloudflareGet(url);

  if (!response) {
    hasBlocker = true;
    return;
  }

  const names = new Set((response.result ?? []).map((secret) => secret.name));

  for (const secretName of REQUIRED_SECRET_NAMES) {
    if (names.has(secretName)) {
      findings.push(`[ok] Secret "${secretName}" está presente no Worker ${WORKER_NAME}.`);
    } else {
      findings.push(
        `[bloqueio] Secret "${secretName}" NÃO foi encontrado no Worker ${WORKER_NAME}.`
      );
      hasBlocker = true;
    }
  }
}

async function cloudflareGet(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    }
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    findings.push(
      `[bloqueio] Chamada Cloudflare falhou (${response.status}) ao consultar ${new URL(url).pathname}. Verifique se o token administrativo tem a permissão "Workers Scripts: Read".`
    );
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
