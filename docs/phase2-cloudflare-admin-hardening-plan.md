# Fase 2 — Plano de hardening administrativo do staging Cloudflare

## Escopo

Este plano cobre somente os controles **administrativos** pendentes da Fase 2 (issue #18).
A Fase 2 técnica (autenticação interna, rotação de token, CORS fail-closed, políticas por
projeto, rate limiting no Worker e testes negativos) já foi mergeada nas PRs #19 e #22.
Nenhuma ação deste plano altera `production`, habilita `AI_API_ENABLED`,
`REPORTING_API_ENABLED` ou `REPORT_DELIVERY_ENABLED`.

Revisão externa ao commit `f4f7a65` removeu o uso de Terraform deste escopo: o backend
remoto não existia, `backend.hcl` seria sempre ignorado pelo Git, e o schema exato do recurso
Terraform para AI Gateway não estava comprovado. Para este tamanho de escopo, os controles são
implementados diretamente via API Cloudflare e Wrangler dentro do workflow, sem IaC.

## Credenciais disponíveis

Definidas em dois GitHub Environments, nunca lidas ou impressas por este plano:

**Environment `staging`** (usado pelo job `plan`, somente leitura):
- `CLOUDFLARE_ADMIN_API_TOKEN` (secret).
- `CLOUDFLARE_ACCOUNT_ID` (variable, não secreta).

**Environment `staging-admin-hardening-apply`** (usado pelo job `apply`, com required
reviewer; secrets/variables próprios, nunca herdados por presunção de outro Environment):
- `CLOUDFLARE_ADMIN_API_TOKEN` (secret) — mesmo valor do token administrativo.
- `KARV_INTERNAL_API_TOKEN` (secret) — valor a ser cadastrado no Worker staging.
- `CLOUDFLARE_ACCOUNT_ID` (variable, não secreta).
- `STAGING_HEALTH_URL` (variable, não secreta) — URL pública de `/health` do staging, usada só
  para validação remota pós-apply.

O workflow falha explicitamente, com mensagem clara, se qualquer um destes estiver ausente —
nunca presume um valor herdado de outro Environment (ver `harden-staging.yml`, steps
"Require ...").

`CLOUDFLARE_API_TOKEN` (uso exclusivo de `deploy-staging.yml`) não é usado por este workflow.

## Permissões do token administrativo — alinhadas ao que é realmente usado

O token candidato mencionado na revisão externa cobre cinco permissões:

- AI Gateway Read
- AI Gateway Write
- Access: Apps and Policies Write
- Workers Scripts Write
- Notifications Write

**Uso real neste workflow:**

| Permissão | Usada? | Onde |
| --- | --- | --- |
| AI Gateway Read | **Sim** | Auditoria pré/pós-apply lê a configuração do gateway (`GET .../ai-gateway/gateways/{id}`); leitura também ocorre antes do PUT para preservar campos existentes. |
| AI Gateway Write | **Sim** | `scripts/cloudflare-ai-gateway-configure.mjs` grava o rate limit (`PUT .../ai-gateway/gateways/{id}`). |
| Workers Scripts Write | **Sim** | Listagem de nomes de secret (`GET .../workers/scripts/{name}/secrets`) e `wrangler secret put KARV_INTERNAL_API_TOKEN --env staging`. |
| Access: Apps and Policies Write | **Não** | Cloudflare Access não é implementado nesta fase (ver "Bloqueios administrativos" abaixo). **Remover esta permissão do token** até uma decisão futura reintroduzir Access. |
| Notifications Write | **Não** | Spend limit e alerta de custo não são implementados nesta fase (ver abaixo). **Remover esta permissão do token.** |

Recomendação final de escopo do `CLOUDFLARE_ADMIN_API_TOKEN`: apenas **AI Gateway Read**,
**AI Gateway Write** e **Workers Scripts Write**, restrito à conta KARV. Sem
**Workers Scripts: Edit de código-fonte** (não há deploy neste workflow), sem **DNS**, sem
**Billing**.

## O que o workflow implementa de fato

Dois jobs em `.github/workflows/harden-staging.yml`:

1. **`plan`** (Environment `staging`, somente leitura):
   - Confirma a string literal `HARDEN-STAGING`.
   - Confirma que as três feature flags críticas continuam `false` em `wrangler.jsonc`.
   - Executa `scripts/cloudflare-admin-audit.mjs` em modo `pre`: relata a presença/ausência do
     secret `KARV_INTERNAL_API_TOKEN` no Worker e o estado atual do rate limit e do
     `collect_logs` do AI Gateway staging. **Não falha** só porque o secret ainda não existe ou
     o rate limit ainda não foi configurado — esse é exatamente o estado inicial esperado antes
     do apply. Falha somente se a própria chamada à API Cloudflare falhar (token insuficiente,
     rede, etc.), porque nesse caso não há como confirmar nada.
   - Publica o relatório sanitizado no Job Summary.

2. **`apply`** (Environment `staging-admin-hardening-apply`, com required reviewer):
   - Confirma presença de todos os secrets/variables exigidos (falha com mensagem clara se
     faltar algum, sem presumir).
   - Confirma de novo que as três feature flags críticas continuam `false`.
   - `wrangler secret put KARV_INTERNAL_API_TOKEN --env staging`, com o valor lido do GitHub
     Secret via variável de ambiente e nunca impresso (`printf '%s' "$TOKEN" | wrangler secret put ...`).
   - `scripts/cloudflare-ai-gateway-configure.mjs`: lê a configuração atual do AI Gateway
     staging, sobrepõe somente `rate_limiting_limit`, `rate_limiting_interval` e
     `rate_limiting_technique` (fixo em `sliding`, decisão de implementação, não de negócio) e
     grava de volta — preservando os demais campos, incluindo `collect_logs`. Confirma por
     leitura pós-escrita que os valores gravados correspondem ao solicitado; se não
     corresponderem (por exemplo, por divergência no nome real do campo na API), falha com
     erro explícito em vez de reportar sucesso indevido.
   - `scripts/cloudflare-admin-audit.mjs` em modo `post`: **estrito**. Falha se o secret
     continuar ausente, se o rate limit não corresponder ao valor solicitado, ou se
     `collect_logs` estiver `true`.
   - Health check remoto (`GET /health` em `STAGING_HEALTH_URL`, espera `200`).
   - Confirma novamente que as três feature flags críticas continuam `false`.

Nenhum passo em nenhum dos dois jobs referencia o Worker de produção (`karv-cloud-platform`)
ou `env.production`.

## Mitigação da incerteza de schema da API do AI Gateway

Os nomes de campo usados (`collect_logs`, `rate_limiting_limit`, `rate_limiting_interval`,
`rate_limiting_technique`) refletem o melhor entendimento atual da API pública de AI Gateway.
Como não há `terraform validate` para pegar um nome de campo errado antes da execução, a
mitigação é: o script sempre lê antes de escrever, sempre lê de novo depois de escrever, e
compara o valor lido com o valor solicitado byte a byte — se a API ignorar um campo
desconhecido ou usar outro nome, a leitura pós-escrita não vai corresponder e o job falha
imediatamente, em vez de reportar sucesso incorretamente. Nenhuma mutação incorreta fica
"encoberta" por uma auditoria otimista.

## Bloqueios administrativos registrados, não implementados nesta fase

Estes controles **não têm implementação nem validação real** neste workflow e não devem ser
declarados concluídos na issue #18 até que isso mude:

- **Cloudflare Access / proteção administrativa equivalente**: o staging usa domínio
  `workers.dev`, que pertence à zona da própria Cloudflare — uma Access Application self-hosted
  não pode proteger esse hostname sem antes anexar um domínio próprio ao Worker, o que é uma
  mudança de infraestrutura maior, fora deste escopo. Requer decisão humana separada.
- **Spend limit / orçamento**: não confirmado se a Cloudflare AI Gateway ou a conta Cloudflare
  expõe um limite de gasto nativo via API. O gasto real de tokens de IA ocorre nas contas
  OpenAI/Anthropic (a AI Gateway é passthrough), então este controle pode pertencer a essas
  contas, fora do Cloudflare.
- **Alerta de custo e seu destinatário**: sem implementação; depende do item anterior.
- **Lista de administradores autorizados (quem pode gerenciar o staging)**: sem automação;
  precisa ser verificada manualmente nos membros da conta Cloudflare (Account Members) e
  comparada com a decisão da direção KARV sobre quem deve ter acesso.
- **Login humano vs. Service Auth**: não decidido; não há Access implementado para aplicar essa
  escolha.

Estes cinco itens entram na lista de "controles que não puderam ser comprovados" no relatório
final e no comentário da issue #18 — não serão apresentados como resolvidos.

## Armazenamento seguro dos secrets

- Nenhum novo secret é criado por este plano. `KARV_INTERNAL_API_TOKEN` já existe como GitHub
  Environment secret; este workflow apenas o copia para o Worker staging via `wrangler secret
  put`, sem gravá-lo em nenhum arquivo do repositório, log de CI, artifact ou state.
- Sem Terraform, não há state a proteger.
- Nenhum token, client id ou client secret é escrito em `wrangler.jsonc`, código, logs ou nesta
  issue/PR.

## Rollback por alteração

| Alteração | Rollback |
| --- | --- |
| Secret `KARV_INTERNAL_API_TOKEN` no Worker staging | `wrangler secret delete KARV_INTERNAL_API_TOKEN --env staging`, ou substituir pelo valor anterior se a rotação documentada em `docs/staging-security.md` estiver em andamento. |
| Rate limit do AI Gateway staging | Rodar `scripts/cloudflare-ai-gateway-configure.mjs` novamente com os valores anteriores, capturados no relatório da auditoria pré-apply (job `plan`). |
| Workflow `harden-staging.yml` e scripts | Apenas arquivos adicionados; reverter é excluí-los em um PR separado. |

Todo `apply` só ocorre em um job separado, gated por aprovação humana no GitHub Environment
`staging-admin-hardening-apply`, nunca automático.

## Testes de validação

- Auditoria pré-apply (modo `pre`) publicada no Job Summary do job `plan`.
- Auditoria pós-apply (modo `post`, estrita) publicada no Job Summary do job `apply` — falha o
  job se qualquer controle não for confirmado.
- Leitura pós-escrita do rate limit do AI Gateway, comparada byte a byte com o valor solicitado.
- `GET /health` do staging responde `200` depois do apply.
- Confirmação textual de que `AI_API_ENABLED`, `REPORTING_API_ENABLED` e
  `REPORT_DELIVERY_ENABLED` continuam `false` em `wrangler.jsonc`, antes e depois do apply.
- Nenhuma chamada do workflow referencia `karv-cloud-platform` (produção) ou `env.production`.

## Configuração manual necessária no GitHub antes do primeiro disparo

Nenhuma destas ações é feita por este PR — são pré-requisitos para o workflow funcionar:

- Criar o Environment `staging-admin-hardening-apply` em **Settings → Environments**, com
  "required reviewers" (pelo menos uma pessoa da direção KARV) e os secrets/variables listados
  na seção "Credenciais disponíveis".
- Confirmar que o Environment `staging` já tem `CLOUDFLARE_ADMIN_API_TOKEN` (secret) e
  `CLOUDFLARE_ACCOUNT_ID` (variable) — usados pelo job `plan`.

## Arquivos desta PR

- `docs/phase2-cloudflare-admin-hardening-plan.md` (este arquivo).
- `.github/workflows/harden-staging.yml` — workflow manual com dois jobs (`plan` somente
  leitura, `apply` com aprovação humana separada).
- `scripts/cloudflare-admin-audit.mjs` — auditoria pré/pós-apply (modos `pre`/`post`).
- `scripts/cloudflare-ai-gateway-configure.mjs` — grava o rate limit do AI Gateway staging via
  API Cloudflare, com leitura de confirmação.

Nenhum arquivo Terraform faz parte desta PR.

## Decisões ainda pendentes

- Quantidade de requisições e janela do rate limit do AI Gateway (decisão B) — inputs
  obrigatórios do workflow, sem valor fixado no código.
- Quem administra o staging, spend limit, destinatário de alerta e método de autenticação
  administrativa (decisões A, C, D, E) — registrados como bloqueios administrativos não
  implementados nesta fase (ver seção dedicada), não como inputs do workflow, porque não há
  implementação real para consumi-los.
