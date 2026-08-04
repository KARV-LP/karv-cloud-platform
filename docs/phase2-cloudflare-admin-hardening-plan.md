# Fase 2 — Plano de hardening administrativo do staging Cloudflare

## Escopo

Este plano cobre somente os controles **administrativos** pendentes da Fase 2 (issue #18).
A Fase 2 técnica (autenticação interna, rotação de token, CORS fail-closed, políticas por
projeto, rate limiting no Worker e testes negativos) já foi mergeada nas PRs #19 e #22.
Nenhuma ação deste plano altera `production`, habilita `AI_API_ENABLED`,
`REPORTING_API_ENABLED` ou `REPORT_DELIVERY_ENABLED`.

## Credenciais disponíveis

Definidas no GitHub Environment `staging`, nunca lidas ou impressas por este plano:

- `CLOUDFLARE_API_TOKEN` (secret) — uso exclusivo do workflow de deploy existente.
- `CLOUDFLARE_ADMIN_API_TOKEN` (secret) — uso exclusivo do novo workflow de hardening
  administrativo. Não deve ser reutilizado para deploy.
- `KARV_INTERNAL_API_TOKEN` (secret) — credencial interna do Worker; usada apenas para
  confirmar existência via listagem de nomes de secret, nunca lida por valor.
- `CLOUDFLARE_ACCOUNT_ID` (variable, não secreta).

## Permissões mínimas propostas para `CLOUDFLARE_ADMIN_API_TOKEN`

O token deve ser escopado por API Token do Cloudflare (não Global API Key), restrito à conta
KARV, com apenas as permissões abaixo. Qualquer permissão além destas deve ser reportada como
excesso e a execução deve ser interrompida:

- **Workers Scripts: Read** — listar nomes de secrets do Worker staging (nunca ler valores).
- **Account Settings: Read** — verificar membros/roles da conta para evidência de acesso
  administrativo.
- **AI Gateway: Edit** — ler e ajustar rate limit e configuração de retenção/log do gateway
  `karv-ai-gateway-staging`.
- **Zero Trust: Access: Edit** — somente se a decisão de Access (ver seção "Cloudflare Access")
  confirmar a necessidade.

Sem permissão de **Workers Scripts: Edit/Write**, **DNS: Edit** ou **Billing**. Se o token
fornecido tiver escopo além do necessário, o workflow deve abortar e reportar o excesso em vez
de seguir.

## Categorização dos recursos (Terraform vs. API/Wrangler vs. ação humana)

| Controle | Mecanismo | Motivo |
| --- | --- | --- |
| Confirmar existência de `KARV_INTERNAL_API_TOKEN` | Cloudflare API (`GET .../workers/scripts/{name}/secrets`), leitura de nomes apenas | Terraform não deve gerenciar nem ler valores de secret; evita gravar segredo em state. |
| Rate limit do AI Gateway | Terraform (`cloudflare_ai_gateway`, se o provider expuser os campos de rate limit) ou, se o schema não suportar, chamada direta à API do AI Gateway no workflow | A ser confirmado em `terraform validate`; ver "Riscos e incertezas". |
| Spend limit / orçamento e alerta de custo | Provável **ação humana fora do Cloudflare** — o gasto real ocorre nas contas OpenAI/Anthropic (a AI Gateway é passthrough); Cloudflare pode não expor limite de gasto nativo | Ver "Riscos e incertezas". Se existir endpoint Cloudflare equivalente, tratar como API, não Terraform. |
| Payload logging / Zero Data Retention no AI Gateway | Cloudflare API (leitura da configuração do gateway) | Confirma que `cf-aig-collect-log-payload` está desativado e que não há retenção de prompts/respostas. |
| Cloudflare Access / proteção administrativa | **Ação humana + evidência** (ver seção dedicada) | O staging usa domínio `workers.dev`, que pertence à zona da própria Cloudflare — Access self-hosted não pode proteger esse hostname sem antes anexar um domínio próprio, o que está fora do escopo atual. |

## Cloudflare Access — limitação identificada

`wrangler.jsonc` define `env.staging` com `workers_dev: true` e sem `routes` em zona própria.
Cloudflare Access (self-hosted application) protege hostnames em zonas que a conta possui;
`*.workers.dev` é uma zona da própria Cloudflare e não pode receber uma Access Application do
cliente. Portanto "Cloudflare Access ou proteção administrativa equivalente" não pode ser
implementado como um gate de SSO na frente do tráfego HTTP sem primeiro anexar um domínio
próprio ao Worker de staging — o que é uma mudança de infraestrutura maior, não solicitada
neste momento.

**Proposta (proteção administrativa equivalente):** controlar quem pode **gerenciar** o recurso
no Cloudflare (dashboard/API), não quem pode chamar o Worker:

1. Evidência dos membros da conta Cloudflare com acesso de escrita (via API, somente leitura),
   comparado com a lista de pessoas autorizadas pela decisão A.
2. Confirmação de que o único endpoint sensível (`/api/internal/ai`) já exige bearer token
   (`requireInternalAuth`) e permanece com `AI_API_ENABLED=false` — ou seja, tráfego não
   autenticado já é bloqueado independentemente de Access.
3. Se a direção KARV decidir que é necessário Access de fato (SSO na frente do tráfego), isso
   fica registrado como bloqueio documentado nesta fase, exigindo uma decisão separada sobre
   anexar domínio próprio ao staging.

Esta proposta evita inventar uma configuração que a topologia atual não suporta. Se a decisão
A/E indicar outra expectativa, este plano precisa ser revisado antes da Fase C.

## Rate limit do AI Gateway

Nenhum valor é definido neste plano — conforme instrução explícita, nenhum número foi
inventado. O workflow de hardening (`harden-staging.yml`) recebe a quantidade de requisições e
a janela como **inputs obrigatórios de `workflow_dispatch`**, decididos no momento do disparo
pela direção KARV. O valor final aparece no `terraform plan` sanitizado antes de qualquer
`apply`.

## Spend limit / orçamento

Mesma lógica: nenhum valor nem período foi definido aqui. Ver "Riscos e incertezas" — é preciso
confirmar primeiro se este controle existe nativamente no Cloudflare AI Gateway/conta, ou se
pertence às contas OpenAI/Anthropic. Enquanto não confirmado, o workflow trata este item como
**não comprovável via Cloudflare** e o relatório final listará isso explicitamente como bloqueio,
a menos que a direção KARV informe o mecanismo correto.

## Destinatário do alerta de custo

Não definido neste plano. Será um input do workflow (e-mail ou webhook), fornecido no momento
do disparo, nunca hardcoded no código ou no Terraform.

## Login humano vs. Service Auth

Não decidido neste plano. Um input de `workflow_dispatch` (`access_auth_method`, com opções
`human_login` / `service_token` / `both`) documenta a escolha no momento da execução, sem
presumir um padrão.

## Armazenamento seguro dos secrets

- Nenhum novo secret é criado por este plano. `KARV_INTERNAL_API_TOKEN` já existe como
  GitHub Environment secret e (presumivelmente) como Worker secret em staging — sua existência
  no Worker será confirmada por leitura de nomes, nunca de valores.
- Nenhum token, client id ou client secret é escrito em arquivos `.tf`, `terraform.tfvars`
  versionado, logs de CI ou nesta issue/PR.
- Caso a Fase C precise de um novo token de serviço (ex.: para Access), ele será criado como
  Cloudflare Access Service Token e armazenado apenas como GitHub Secret — nunca em
  `terraform.tfvars` versionado nem exposto em `terraform plan`. Se o provider Terraform
  gravar esse valor no state, o recurso correspondente **não será criado via Terraform**, e sim
  via API/Wrangler fora do state, conforme regra explícita do projeto.

## Backend remoto do Terraform

Não existe backend remoto hoje (Fase A confirmou: nenhum arquivo `.tf` no repositório). Duas
opções ficam propostas para decisão, nenhuma aplicada ainda:

1. **Terraform Cloud (app.terraform.io)** — workspace dedicado, execução remota opcional,
   state com lock nativo, sem credenciais Cloudflare adicionais. Requer criar uma organização/
   workspace e um `TF_API_TOKEN` como novo GitHub Secret.
2. **Cloudflare R2 (S3-compatible) como backend `s3`** — mantém o state dentro da própria conta
   Cloudflare, mas exige criar um bucket R2 e credenciais S3-compatíveis (Access Key/Secret),
   que também precisariam virar GitHub Secrets novos.

Ambas as opções exigem uma mutação (criar workspace ou criar bucket) antes do primeiro
`terraform init`. Nenhuma será executada sem autorização explícita e escolha entre as duas.

## Rollback por alteração

| Alteração | Rollback |
| --- | --- |
| Rate limit do AI Gateway | Reverter para o valor anterior via `terraform apply` do estado anterior, ou remover o bloco de rate limit e reaplicar. |
| Configuração de payload logging/ZDR | Reverter o campo correspondente para o valor original documentado antes da mudança. |
| Access/IAM (se decidido) | Remover a policy/application criada; nenhuma alteração em produção; staging sem Access equivale ao estado atual (bearer token continua sendo o gate funcional). |
| Workflow `harden-staging.yml` | Arquivo apenas adicionado; reverter é excluir o arquivo em um PR separado. |

Todo `apply` só ocorre em um job separado, gated por aprovação humana no GitHub Environment,
nunca automático.

## Testes de validação

- `terraform fmt -check`, `terraform validate`, `terraform plan` (sem apply) no job de plan.
- Leitura pós-apply (job separado, também manual) confirmando por API: nomes de secrets
  presentes, configuração de rate limit do AI Gateway, configuração de payload logging.
- `GET /health` do staging continua respondendo `200` (Worker saudável, sem regressão).
- Confirmação de que `AI_API_ENABLED`, `REPORTING_API_ENABLED` e `REPORT_DELIVERY_ENABLED`
  continuam `false` em `wrangler.jsonc` (diff de texto, não runtime).
- Confirmação de que nenhum arquivo sob `env.production` foi tocado.

## Arquivos a adicionar nesta PR (Fase B, sem mutação Cloudflare)

- `docs/phase2-cloudflare-admin-hardening-plan.md` (este arquivo).
- `.github/workflows/harden-staging.yml` (workflow manual, plan-only até aprovação separada
  para apply).
- `scripts/cloudflare-admin-audit.mjs` (auditoria somente leitura: confirma nomes de secret
  sem ler valores; falha se não puder confirmar em vez de presumir).
- `terraform/versions.tf`, `terraform/variables.tf`, `terraform/main.tf`, `terraform/outputs.tf`
  (esqueleto; recurso do AI Gateway usa bloco `import` para trazer o gateway já existente ao
  state em vez de recriá-lo).
- `terraform/backend.hcl.example` (modelo não secreto; `terraform/backend.hcl` real fica
  ignorado pelo Git e só é criado após a decisão do backend remoto).
- `.gitignore` atualizado para ignorar `terraform/.terraform/`, `terraform/*.tfstate*`,
  `terraform/backend.hcl` e `terraform/tfplan.bin`.

O job de plan em `harden-staging.yml` falha explicitamente em "Require provisioned remote
backend" se `terraform/backend.hcl` não existir — isso é intencional: sem essa decisão tomada,
o workflow não deve cair em backend local dentro do runner efêmero do GitHub Actions.

## Configuração manual necessária no GitHub antes do primeiro disparo

Nenhuma destas ações é feita por este PR — são pré-requisitos para o workflow funcionar,
listados aqui para transparência:

- Criar o Environment `staging-admin-hardening-apply` em **Settings → Environments**, com
  "required reviewers" configurado (pelo menos uma pessoa da direção KARV). Sem isso, o job de
  apply falha ao iniciar por falta de ambiente, em vez de aplicar sem aprovação.
- Adicionar a variable `STAGING_HEALTH_URL` (não secreta) ao Environment `staging`, com a URL
  pública de `/health` do Worker staging, usada apenas para validação remota pós-apply.
- Criar `terraform/backend.hcl` localmente (fora do Git) somente após a decisão do backend
  remoto, seguindo `terraform/backend.hcl.example`.

## Riscos e incertezas — controles que podem não ser comprováveis via Cloudflare

- **Spend limit/orçamento**: não há confirmação de que a Cloudflare AI Gateway ou a conta
  Cloudflare exponha um limite de gasto nativo via API/Terraform. Pode ser um controle que
  pertence às contas OpenAI/Anthropic, fora do Cloudflare. Isso será verificado no início da
  Fase C (chamada de leitura à API, sem mutação) e reportado como bloqueio se não existir.
- **Rate limit do AI Gateway via Terraform**: o provider Cloudflare pode não expor os campos de
  rate limit do AI Gateway como atributos do recurso `cloudflare_ai_gateway`. Será confirmado em
  `terraform validate`/documentação do provider na versão fixada; se não suportado, o controle
  será implementado via chamada direta à API do AI Gateway dentro do workflow, documentado como
  tal (não Terraform).
- **Cloudflare Access em `workers.dev`**: confirmado como não suportado diretamente (ver seção
  dedicada). Requer decisão humana adicional se a direção KARV insistir nesse controle
  específico.

## Decisões ainda pendentes (inputs do workflow, não valores fixos no código)

- Lista de e-mails/domínios autorizados a administrar o staging (decisão A).
- Quantidade de requisições e janela do rate limit do AI Gateway (decisão B).
- Valor e período do spend limit, condicionado à confirmação de que o controle existe (decisão C).
- Destinatário do alerta de custo (decisão D).
- Login humano, Service Auth ou ambos para administração (decisão E).
- Escolha do backend remoto Terraform (Terraform Cloud ou R2).

Nenhuma dessas decisões foi presumida. O workflow em `harden-staging.yml` exige esses valores
como entrada explícita no momento do disparo manual.
