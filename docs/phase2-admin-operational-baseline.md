# Etapa 3 — Baseline administrativa e preparação operacional

## Objetivo

Definir os valores iniciais e o protocolo seguro para executar o hardening administrativo do
staging após o merge da PR #23, sem ativar IA, reporting ou delivery e sem tocar em produção.

Esta etapa prepara a operação. Ela não cria secrets, não altera a conta Cloudflare e não executa o
workflow administrativo.

## Decisões adotadas para staging

### Rate limit do AI Gateway

Baseline inicial:

- limite: `10` requisições;
- janela: `60` segundos;
- técnica: `sliding`.

Essa baseline replica o limite já usado no binding do Worker e mantém duas camadas independentes de
proteção. Os valores são defaults do workflow, mas permanecem visíveis e editáveis antes de cada
execução.

### Spend limit

Baseline proposta:

- orçamento global: `USD 5`;
- janela de negócio: diária;
- técnica: `fixed`;
- comportamento ao atingir o limite: bloquear com HTTP `429`.

A documentação funcional da Cloudflare descreve janelas diárias, semanais e mensais, mas o schema
da API publica `spend_limits.rules[].window` apenas como inteiro positivo e não documenta sua
unidade. Portanto:

1. o primeiro `plan` deve manter `amount` e `window` vazios;
2. a janela diária deve ser criada ou inspecionada no painel Cloudflare;
3. o valor numérico real retornado pela API deve ser registrado;
4. somente depois o workflow pode receber `amount=5` e o `window` confirmado.

O workflow não converte `daily` para um número por suposição.

Referências:

- https://developers.cloudflare.com/ai-gateway/features/spend-limits/
- https://developers.cloudflare.com/api/resources/ai_gateway/methods/update/

### Alerta de custo

Criar um alerta de orçamento da conta com:

- nome: `KARV staging usage warning`;
- threshold inicial: `USD 10` no ciclo de cobrança;
- destinatário: `comercial@k-arv.com`.

O alerta de orçamento é informativo e considera o gasto usage-based da conta; ele não substitui o
spend limit do AI Gateway e não interrompe uso.

Referência:

- https://developers.cloudflare.com/billing/manage/budget-alerts/

## Separação obrigatória entre plan e apply

O workflow passa a ter o input `execution_mode`:

- `plan` — padrão; executa somente leituras e gera o Job Summary;
- `apply` — executa o mesmo plan e, somente depois, agenda o job protegido de mutação.

Confirmações literais:

- `PLAN-STAGING` para `plan`;
- `APPLY-STAGING` para `apply`.

Selecionar `plan` faz o job `apply` ser ignorado. Selecionar `apply` ainda exige aprovação do
Environment `staging-admin-hardening-apply`.

## GitHub Environments

O repositório é público, portanto required reviewers podem ser usados no Environment.

### `staging`

Uso: auditoria somente leitura.

Variável:

- `CLOUDFLARE_ACCOUNT_ID`.

Secret:

- `CLOUDFLARE_AUDIT_API_TOKEN`.

Permissões mínimas do token:

- AI Gateway Read;
- Workers Scripts Read.

Não cadastrar token de escrita neste Environment.

### `staging-admin-hardening-apply`

Uso: mutação administrativa explicitamente aprovada.

Proteções:

- required reviewer configurado;
- `Prevent self-review` habilitado;
- somente branch `main`;
- nenhum bypass operacional normal.

Como o iniciador não pode aprovar a própria execução, é necessário um segundo GitHub user com
acesso de leitura ao repositório. O apply não deve ser executado enquanto esse revisor independente
não existir.

Variáveis:

- `CLOUDFLARE_ACCOUNT_ID`;
- `STAGING_HEALTH_URL`, incluindo `/health` e usando HTTPS.

Secrets:

- `CLOUDFLARE_ADMIN_API_TOKEN`;
- `KARV_INTERNAL_API_TOKEN`;
- `CLOUDFLARE_ACCESS_CLIENT_ID`;
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`.

Permissões mínimas do token administrativo:

- AI Gateway Read;
- AI Gateway Write;
- Workers Scripts Write.

## Cloudflare Access no Worker de staging

O Worker em `workers.dev` pode ser protegido diretamente pelo Cloudflare Access. Não é necessário
migrar primeiro para um domínio próprio.

Procedimento administrativo:

1. abrir Workers & Pages;
2. selecionar `karv-cloud-platform-staging`;
3. abrir Domains ou Settings > Domains & Routes;
4. habilitar Cloudflare Access para a URL `workers.dev`;
5. manter política deny-by-default;
6. criar uma política humana Allow apenas para administradores autorizados;
7. criar um Service Token exclusivo chamado `karv-staging-github-actions`;
8. adicionar uma política `Service Auth` para esse token;
9. armazenar Client ID e Client Secret somente no Environment protegido do apply.

O health check do workflow envia os headers:

- `CF-Access-Client-Id`;
- `CF-Access-Client-Secret`.

Sem os dois secrets, o apply falha antes da mutação.

Referências:

- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/
- https://developers.cloudflare.com/workers/local-development/

## Sequência operacional depois do merge

### Execução 1 — plan sem spend limit

Inputs:

```text
execution_mode=plan
confirmation=PLAN-STAGING
ai_gateway_rate_limit_requests=10
ai_gateway_rate_limit_period_seconds=60
ai_gateway_spend_limit_amount=
ai_gateway_spend_limit_window=
```

Objetivo: confirmar leitura da conta, estado do secret, logging, ZDR, rate limit e configuração de
spend limits sem mutação.

### Execução 2 — plan com orçamento confirmado

Executar somente depois de confirmar o número usado pela API para a janela diária:

```text
execution_mode=plan
confirmation=PLAN-STAGING
ai_gateway_rate_limit_requests=10
ai_gateway_rate_limit_period_seconds=60
ai_gateway_spend_limit_amount=5
ai_gateway_spend_limit_window=<valor confirmado>
```

Objetivo: revisar no Job Summary o estado atual e a proposta completa.

### Execução 3 — apply aprovado

Repetir os mesmos valores da Execução 2 com:

```text
execution_mode=apply
confirmation=APPLY-STAGING
```

O job de apply deve aguardar o revisor independente. Após aprovação, ele cadastra o Worker secret,
configura o AI Gateway, executa auditoria pós-escrita e testa `/health` através do Access.

## Evidências permitidas

Registrar na issue #18 apenas:

- IDs de runs;
- conclusões dos jobs;
- presença ou ausência de secrets por nome;
- valores não sensíveis de rate limit e spend limit;
- `collect_logs=false`;
- `zdr=true`;
- HTTP status do health check;
- confirmação de Access ativo;
- nome do alerta e threshold;
- lista de administradores por login, sem credenciais.

Nunca registrar tokens, Client Secret, headers de autenticação, prompts ou respostas.

## Bloqueios administrativos que permanecem manuais

A integração disponível não permite:

- criar ou editar GitHub Environments;
- cadastrar environment secrets;
- criar tokens Cloudflare;
- habilitar Access no painel;
- criar Service Tokens;
- criar alertas de orçamento;
- revisar membros administradores da conta Cloudflare.

Esses itens devem ser executados no painel por uma pessoa autorizada. O código permanece
fail-closed até que todos estejam configurados e comprovados.
