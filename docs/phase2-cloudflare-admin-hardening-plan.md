# Fase 2 — Hardening administrativo do staging Cloudflare

## Escopo

Este plano cobre os controles administrativos ainda pendentes da issue #18. A parte técnica da
Fase 2 — autenticação interna, CORS fail-closed, políticas por projeto, rate limiting no Worker,
testes negativos e validação remota — já foi incorporada nas PRs #19 e #22.

Este trabalho não altera `production` e não habilita `AI_API_ENABLED`,
`REPORTING_API_ENABLED` ou `REPORT_DELIVERY_ENABLED`.

A baseline operacional detalhada está em:

- `docs/phase2-admin-operational-baseline.md`.

## Estado atual

A PR #23 contém:

- workflow manual de auditoria e apply administrativo;
- auditoria read-only do Worker e do AI Gateway;
- configuração por lista branca;
- leitura pós-escrita estrita;
- testes mockados reproduzíveis;
- CI especializado sem secrets;
- baseline de rate limit, custo, Access e GitHub Environments.

Nenhum workflow administrativo foi executado. Nenhuma mutação Cloudflare foi realizada.

## Controles implementados

O workflow `.github/workflows/harden-staging.yml` implementa e verifica:

- presença do secret `KARV_INTERNAL_API_TOKEN` no Worker de staging;
- `collect_logs=false`;
- `zdr=true`;
- rate limit do AI Gateway;
- regra global opcional de spend limit;
- preservação sanitizada dos campos existentes;
- bloqueio de Stripe e OpenTelemetry com credenciais;
- required reviewer antes da mutação;
- health check protegido por Cloudflare Access;
- feature flags críticas permanecendo desativadas.

## Separação entre plan e apply

O workflow é acionado somente por `workflow_dispatch` e recebe `execution_mode`.

### `plan`

- modo padrão;
- confirmação literal `PLAN-STAGING`;
- usa somente `CLOUDFLARE_AUDIT_API_TOKEN`;
- não agenda o job de mutação;
- publica estado atual e proposta no Job Summary.

### `apply`

- deve ser selecionado explicitamente;
- confirmação literal `APPLY-STAGING`;
- executa o plan antes;
- agenda o job protegido somente se o plan passar;
- exige aprovação no Environment `staging-admin-hardening-apply`;
- exige Cloudflare Access Service Token para o health check.

O evento `workflow_dispatch` só pode ser executado quando o workflow existe na branch padrão.
Portanto, qualquer run administrativo ocorrerá somente após merge explícito da PR.

## Baseline administrativa da Etapa 3

### Rate limit

- `10` requisições;
- `60` segundos;
- técnica `sliding`.

Esses valores são defaults visíveis no formulário do workflow.

### Spend limit

Baseline proposta:

- `USD 5`;
- janela diária;
- técnica `fixed`;
- bloqueio HTTP `429`.

A API define `spend_limits.rules[].window` como inteiro positivo, mas a documentação do schema não
informa a unidade. O workflow não supõe uma conversão.

O primeiro plan deve manter spend limit vazio. O valor numérico da janela diária deve ser
confirmado no painel ou em resposta real da API antes de qualquer apply com orçamento.

### Alerta de custo

Baseline:

- nome `KARV staging usage warning`;
- threshold `USD 10` por ciclo;
- destinatário `comercial@k-arv.com`.

O alerta é account-wide e informativo. O spend limit do gateway continua sendo o mecanismo de
bloqueio.

## Schema da API Cloudflare

O workflow usa:

- `collect_logs`;
- `zdr`;
- `rate_limiting_limit`;
- `rate_limiting_interval`;
- `rate_limiting_technique`;
- `spend_limits.enabled`;
- `spend_limits.rules[]`.

Cada regra preservável pode conter:

- `id`;
- `enabled`;
- `limit`;
- `limitType`;
- `window`;
- `metadata`;
- `model`;
- `provider`;
- `technique`.

Referências oficiais:

- https://developers.cloudflare.com/api/resources/ai_gateway/methods/update/
- https://developers.cloudflare.com/ai-gateway/features/spend-limits/
- https://developers.cloudflare.com/ai-gateway/features/rate-limiting/

## Regra global KARV

Quando solicitada, a regra gerenciada usa:

```text
{
  "id": "karv-staging-global-budget",
  "enabled": true,
  "limitType": "cost",
  "limit": <número confirmado>,
  "window": <inteiro confirmado>,
  "technique": "fixed"
}
```

A regra não possui dimensão de modelo, provedor ou metadata. Ela representa um orçamento global
compartilhado pelo gateway.

Regras externas válidas são reconstruídas por lista branca, preservadas e comparadas após a
escrita. O script altera somente a regra com o ID acima.

## Payload e comportamento fail-closed

O `PUT` é montado por lista branca. Campos somente leitura ou desconhecidos não são reenviados.

Campos obrigatórios preservados:

- `cache_invalidate_on_update`;
- `cache_ttl`.

Campos opcionais documentados são preservados somente quando presentes e comparados após a
escrita.

O script falha antes do `PUT` quando:

- a resposta atual contém Stripe;
- OpenTelemetry contém `authorization`;
- o schema é incompatível;
- spend limit foi informado parcialmente;
- o limite de regras seria excedido;
- a API não pode ser lida.

A auditoria pós-apply falha se qualquer controle não corresponder ao solicitado.

## Cloudflare Access

O Worker `karv-cloud-platform-staging` pode ser protegido diretamente em `workers.dev`; não é
necessário migrar primeiro para domínio próprio.

A configuração recomendada é:

- Access habilitado no Worker;
- política humana Allow somente para administradores autorizados;
- política `Service Auth`;
- Service Token exclusivo `karv-staging-github-actions`;
- Client ID e Client Secret armazenados somente no Environment protegido.

O health check envia:

- `CF-Access-Client-Id`;
- `CF-Access-Client-Secret`.

Referências:

- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/
- https://developers.cloudflare.com/workers/local-development/

## GitHub Environments

### `staging`

Variável:

- `CLOUDFLARE_ACCOUNT_ID`.

Secret:

- `CLOUDFLARE_AUDIT_API_TOKEN`.

Permissões mínimas:

- AI Gateway Read;
- Workers Scripts Read.

### `staging-admin-hardening-apply`

Proteções:

- required reviewer;
- `Prevent self-review`;
- branch `main`;
- sem bypass operacional normal.

Variáveis:

- `CLOUDFLARE_ACCOUNT_ID`;
- `STAGING_HEALTH_URL`.

Secrets:

- `CLOUDFLARE_ADMIN_API_TOKEN`;
- `KARV_INTERNAL_API_TOKEN`;
- `CLOUDFLARE_ACCESS_CLIENT_ID`;
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`.

Permissões mínimas do token administrativo:

- AI Gateway Read;
- AI Gateway Write;
- Workers Scripts Write.

Com `Prevent self-review`, um segundo GitHub user com acesso de leitura é obrigatório. O iniciador
do workflow não pode ser o único revisor.

## CI pré-merge

O workflow `.github/workflows/admin-hardening-ci.yml` executa sem secrets e valida:

- checkout do SHA exato;
- sintaxe dos módulos Node;
- parsing YAML;
- oito testes mockados;
- auditoria npm;
- tipagem e 26 testes do Worker;
- dry-run de staging;
- tipagem e sete testes do Monitoring Agent;
- `git diff --check`;
- scanner das linhas adicionadas.

Os mocks cobrem:

- payload por lista branca;
- preservação de regra externa;
- bloqueio de Stripe;
- bloqueio de OpenTelemetry com autorização;
- validação antes da rede;
- auditoria pre;
- auditoria post;
- falha fechada em divergência;
- scanner sem exposição do valor detectado.

## Sequência operacional

1. revisar e aprovar a PR #23;
2. fazer merge explícito;
3. configurar os dois GitHub Environments;
4. criar tokens Cloudflare com privilégio mínimo;
5. habilitar Access no Worker;
6. criar Service Token e política `Service Auth`;
7. criar alerta de orçamento;
8. executar `plan` com `10/60` e spend limit vazio;
9. confirmar o valor numérico da janela diária;
10. executar novo `plan` com `USD 5` e a janela confirmada;
11. revisar o Job Summary;
12. executar `apply`;
13. obter aprovação do revisor independente;
14. registrar evidência sanitizada na issue #18.

## Critério de fechamento da issue #18

A issue permanece aberta até existir evidência não sensível de:

1. plan real aprovado;
2. apply real aprovado;
3. health check através do Access;
4. Worker secret presente;
5. rate limit confirmado;
6. `zdr=true`;
7. `collect_logs=false`;
8. spend limit confirmado;
9. Access ativo;
10. alerta de orçamento configurado;
11. administradores autorizados revisados.

Até lá, IA, reporting e delivery permanecem desativados.

## Rollback

| Alteração | Rollback |
| --- | --- |
| Worker secret | Excluir ou restaurar conforme o runbook de rotação. |
| Rate limit, ZDR, logging e spend limit | Restaurar os valores registrados no Job Summary do plan. |
| Access | Desabilitar somente após incidente revisado ou substituir a política por uma versão aprovada. |
| Service Token | Revogar o token e remover os secrets do Environment. |
| Arquivos da PR | Reverter em alteração separada. |

O rollback não é automático porque pode envolver secrets e decisões administrativas que não devem
ser inferidas pelo workflow.
