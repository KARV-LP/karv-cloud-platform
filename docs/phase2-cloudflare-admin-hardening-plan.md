# Fase 2 — Plano de hardening administrativo do staging Cloudflare

## Escopo

Este plano cobre somente os controles **administrativos** pendentes da Fase 2 (issue #18).
A Fase 2 técnica (autenticação interna, rotação de token, CORS fail-closed, políticas por
projeto, rate limiting no Worker e testes negativos) já foi mergeada nas PRs #19 e #22.
Nenhuma ação deste plano altera `production`, habilita `AI_API_ENABLED`,
`REPORTING_API_ENABLED` ou `REPORT_DELIVERY_ENABLED`.

Histórico de revisão neste PR (ainda não aberta):

1. Removido o uso de Terraform (backend remoto inexistente, schema do AI Gateway não
   comprovado) em favor de chamadas diretas à API Cloudflare e Wrangler dentro do workflow.
2. Incorporados Zero Data Retention (ZDR) e spend limit do AI Gateway como controles reais,
   implementados e validados — não mais tratados como "não confirmados". O payload de escrita
   passou a ser montado explicitamente, removendo campos somente leitura em vez de espalhar
   (`...current`) a resposta da API. O job `plan` agora valida os números informados e mostra
   "atual → proposto" para cada controle, sem nenhuma mutação.

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

O token candidato cobre cinco permissões:

- AI Gateway Read
- AI Gateway Write
- Access: Apps and Policies Write
- Workers Scripts Write
- Notifications Write

**Uso real neste workflow:**

| Permissão | Usada? | Onde |
| --- | --- | --- |
| AI Gateway Read | **Sim** | Auditoria pré/pós-apply lê rate limit, ZDR, collect_logs e spend limit (`GET .../ai-gateway/gateways/{id}`); leitura também ocorre antes do PUT para preservar campos existentes. |
| AI Gateway Write | **Sim** | `scripts/cloudflare-ai-gateway-configure.mjs` grava rate limit, ZDR e (quando solicitado) spend limit (`PUT .../ai-gateway/gateways/{id}`). |
| Workers Scripts Write | **Sim** | Listagem de nomes de secret (`GET .../workers/scripts/{name}/secrets`) e `wrangler secret put KARV_INTERNAL_API_TOKEN --env staging`. |
| Access: Apps and Policies Write | **Não** | Cloudflare Access não é implementado nesta fase (ver "Bloqueios administrativos" abaixo). **Remover esta permissão do token** até uma decisão futura reintroduzir Access. |
| Notifications Write | **Não** | Spend limit é um campo do próprio recurso AI Gateway (coberto por AI Gateway Write), não do produto Notifications. O destinatário do alerta de custo não é implementado nesta fase. **Remover esta permissão do token** até isso mudar. |

Recomendação final de escopo do `CLOUDFLARE_ADMIN_API_TOKEN`: apenas **AI Gateway Read**,
**AI Gateway Write** e **Workers Scripts Write**, restrito à conta KARV. Sem
**Workers Scripts: Edit de código-fonte** (não há deploy neste workflow), sem **DNS**, sem
**Billing**, sem **Access** e sem **Notifications**.

## O que o workflow implementa de fato

Dois jobs em `.github/workflows/harden-staging.yml`:

1. **`plan`** (Environment `staging`, somente leitura, sem mutação):
   - Confirma a string literal `HARDEN-STAGING`.
   - Confirma que as três feature flags críticas continuam `false` em `wrangler.jsonc`.
   - Valida os inputs numéricos (`ai_gateway_rate_limit_requests`,
     `ai_gateway_rate_limit_period_seconds` e, se informado, `ai_gateway_spend_limit_amount`/
     `ai_gateway_spend_limit_period`) antes de qualquer chamada à API — inteiros positivos para
     rate limit, par completo (amount + period) ou nenhum dos dois para spend limit.
   - Executa `scripts/cloudflare-admin-audit.mjs` em modo `pre`: relata a presença/ausência do
     secret `KARV_INTERNAL_API_TOKEN`, e para cada controle do AI Gateway staging (rate limit,
     ZDR, collect_logs, spend limit) mostra explicitamente **atual → proposto** com os valores
     desta execução — sem gravar nada. Spend limit só aparece como proposta se os dois inputs
     tiverem sido informados; caso contrário é reportado como "não solicitado nesta execução".
   - **Não falha** só porque o secret ainda não existe, ZDR ainda não está ativo, ou o rate
     limit ainda não foi configurado — esse é exatamente o estado inicial esperado antes do
     apply. Falha somente se a própria chamada à API Cloudflare falhar (token insuficiente,
     rede, etc.), porque nesse caso não há como confirmar nada.
   - Publica o relatório sanitizado no Job Summary.

2. **`apply`** (Environment `staging-admin-hardening-apply`, com required reviewer):
   - Confirma presença de todos os secrets/variables exigidos (falha com mensagem clara se
     faltar algum, sem presumir).
   - Confirma de novo que as três feature flags críticas continuam `false`.
   - `wrangler secret put KARV_INTERNAL_API_TOKEN --env staging`, com o valor lido do GitHub
     Secret via variável de ambiente e nunca impresso (`printf '%s' "$TOKEN" | wrangler secret put ...`).
   - `scripts/cloudflare-ai-gateway-configure.mjs`: lê a configuração atual do AI Gateway
     staging, monta um payload **explícito** removendo campos somente leitura conhecidos
     (`id`, `created_at`, `modified_at`, `account_id`, `account_tag`) em vez de espalhar a
     resposta inteira, sobrepõe `collect_logs=false`, `zdr=true`, `rate_limiting_limit`,
     `rate_limiting_interval`, `rate_limiting_technique` (fixo em `sliding`, decisão de
     implementação) e, se solicitado nesta execução, `spend_limit_amount`/`spend_limit_period` —
     e grava de volta. Confirma por leitura pós-escrita que cada valor gravado corresponde ao
     solicitado; se algum não corresponder, falha com erro explícito em vez de reportar sucesso
     indevido.
   - `scripts/cloudflare-admin-audit.mjs` em modo `post`: **estrito**. Falha se o secret
     continuar ausente, se o rate limit não corresponder ao valor solicitado, se ZDR não estiver
     ativo, se `collect_logs` estiver `true`, ou se um spend limit solicitado nesta execução não
     tiver sido aplicado.
   - Health check remoto (`GET /health` em `STAGING_HEALTH_URL`, espera `200`).
   - Confirma novamente que as três feature flags críticas continuam `false`.

Nenhum passo em nenhum dos dois jobs referencia o Worker de produção (`karv-cloud-platform`)
ou `env.production`.

## Mitigação da incerteza de schema da API do AI Gateway

Os nomes de campo usados (`collect_logs`, `zdr`, `rate_limiting_limit`, `rate_limiting_interval`,
`rate_limiting_technique`, `spend_limit_amount`, `spend_limit_period`) refletem os requisitos
informados para este workflow, incluindo suporte a spend limit reportado como adicionado à API
pública do AI Gateway após o conhecimento desta assistente (corte em janeiro de 2026). Como não
há `terraform validate` nem acesso à documentação viva da API neste ambiente para confirmar os
nomes exatos antes da execução, a mitigação é: o script sempre lê antes de escrever, sempre lê
de novo depois de escrever, e compara byte a byte o valor lido com o valor solicitado — se a API
ignorar um campo desconhecido, usar outro nome, ou rejeitar a requisição, a leitura pós-escrita
não vai corresponder (ou a chamada falha diretamente) e o job para imediatamente, em vez de
reportar sucesso incorretamente. Nenhuma mutação incorreta fica "encoberta" por uma auditoria
otimista. Recomenda-se confirmar os nomes de campo na documentação atual da API Cloudflare antes
do primeiro disparo real.

## Bloqueios administrativos registrados, não implementados nesta fase

Estes controles **não têm implementação nem validação real** neste workflow e não devem ser
declarados concluídos na issue #18 até que isso mude:

- **Cloudflare Access / proteção administrativa equivalente**: o staging usa domínio
  `workers.dev`, que pertence à zona da própria Cloudflare — uma Access Application self-hosted
  não pode proteger esse hostname sem antes anexar um domínio próprio ao Worker, o que é uma
  mudança de infraestrutura maior, fora deste escopo. Requer decisão humana separada.
- **Destinatário do alerta de custo**: o spend limit em si agora é implementado e validado (ver
  seção anterior), mas este workflow não configura nenhum canal/destinatário de notificação —
  não há evidência de que o campo `spend_limit_*` do AI Gateway dispare um alerta para alguém.
  Se a direção KARV precisar de notificação ativa (e-mail/webhook), isso é um controle adicional,
  ainda não implementado.
- **Lista de administradores autorizados (quem pode gerenciar o staging)**: sem automação;
  precisa ser verificada manualmente nos membros da conta Cloudflare (Account Members) e
  comparada com a decisão da direção KARV sobre quem deve ter acesso.
- **Login humano vs. Service Auth**: não decidido; não há Access implementado para aplicar essa
  escolha.

## Critério de fechamento da issue #18

A issue #18 exige evidência não sensível de: secret interno, Access/proteção equivalente, rate
limit, ZDR, spend limit e alerta de custo. Este PR faz rate limit e ZDR e spend limit terem uma
implementação real e auto-verificada — mas **implementação em código não é evidência de
execução**. A issue só pode ser considerada concluída depois que o workflow tiver sido
efetivamente disparado em staging, com o Job Summary do `apply` mostrando a auditoria pós-apply
estrita aprovada (secret presente, rate limit correspondente, ZDR ativo, spend limit aplicado se
solicitado) e o health check com sucesso. Enquanto isso não ocorrer, e enquanto Access e
destinatário do alerta de custo permanecerem sem implementação, a issue #18 **não deve ser
encerrada como concluída** — nem automaticamente por este agente, nem por decisão implícita.
Qualquer comentário preparado para a issue deve listar esses itens como pendentes, não como
resolvidos.

## Armazenamento seguro dos secrets

- Nenhum novo secret é criado por este plano. `KARV_INTERNAL_API_TOKEN` já existe como GitHub
  Environment secret; este workflow apenas o copia para o Worker staging via `wrangler secret
  put`, sem gravá-lo em nenhum arquivo do repositório, log de CI ou artifact.
- Sem Terraform, não há state a proteger.
- Nenhum token, client id ou client secret é escrito em `wrangler.jsonc`, código, logs ou nesta
  issue/PR.

## Rollback por alteração

| Alteração | Rollback |
| --- | --- |
| Secret `KARV_INTERNAL_API_TOKEN` no Worker staging | `wrangler secret delete KARV_INTERNAL_API_TOKEN --env staging`, ou substituir pelo valor anterior se a rotação documentada em `docs/staging-security.md` estiver em andamento. |
| Rate limit / ZDR / spend limit do AI Gateway staging | Rodar `scripts/cloudflare-ai-gateway-configure.mjs` novamente com os valores anteriores, capturados no relatório da auditoria pré-apply (job `plan`) daquela execução. |
| Workflow `harden-staging.yml` e scripts | Apenas arquivos adicionados; reverter é excluí-los em um PR separado. |

Todo `apply` só ocorre em um job separado, gated por aprovação humana no GitHub Environment
`staging-admin-hardening-apply`, nunca automático.

## Testes de validação

- Validação numérica dos inputs no job `plan`, antes de qualquer chamada à API.
- Auditoria pré-apply (modo `pre`) publicada no Job Summary do job `plan`, mostrando atual →
  proposto para rate limit, ZDR e spend limit.
- Auditoria pós-apply (modo `post`, estrita) publicada no Job Summary do job `apply` — falha o
  job se qualquer controle não for confirmado.
- Leitura pós-escrita de cada campo gravado no AI Gateway, comparada byte a byte com o valor
  solicitado.
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
- `scripts/cloudflare-admin-audit.mjs` — auditoria pré/pós-apply (modos `pre`/`post`), inclui
  rate limit, ZDR, collect_logs e spend limit.
- `scripts/cloudflare-ai-gateway-configure.mjs` — grava rate limit, ZDR e spend limit do AI
  Gateway staging via API Cloudflare, com payload explícito e leitura de confirmação.

Nenhum arquivo Terraform faz parte desta PR.

## Decisões ainda pendentes

- Quantidade de requisições e janela do rate limit do AI Gateway (decisão B) — inputs
  obrigatórios do workflow, sem valor fixado no código.
- Valor e período do spend limit (decisão C) — inputs opcionais do workflow; se não informados,
  o controle não é tocado nesta execução e permanece pendente.
- Destinatário do alerta de custo (decisão D), quem administra o staging (decisão A) e método
  de autenticação administrativa (decisão E) — registrados como bloqueios administrativos não
  implementados nesta fase (ver seção dedicada), porque não há implementação real para
  consumi-los.
