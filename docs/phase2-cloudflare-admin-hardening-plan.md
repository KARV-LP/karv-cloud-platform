# Fase 2 — Hardening administrativo do staging Cloudflare

## Escopo

Este plano cobre os controles administrativos ainda pendentes da issue #18. A parte técnica da
Fase 2 — autenticação interna, CORS fail-closed, políticas por projeto, rate limiting no Worker,
testes negativos e validação remota — já foi incorporada nas PRs #19 e #22.

Este trabalho não altera `production` e não habilita `AI_API_ENABLED`,
`REPORTING_API_ENABLED` ou `REPORT_DELIVERY_ENABLED`.

## Controles implementados neste PR

O workflow manual `.github/workflows/harden-staging.yml` implementa e verifica:

- presença do secret `KARV_INTERNAL_API_TOKEN` no Worker de staging;
- `collect_logs=false` no AI Gateway de staging;
- `zdr=true` no AI Gateway de staging;
- rate limit do AI Gateway com quantidade, janela e técnica `sliding`;
- regra global opcional de spend limit;
- leitura pós-escrita estrita de todos os controles alterados;
- health check remoto do staging;
- confirmação de que as três feature flags críticas permanecem desativadas.

O workflow tem dois jobs:

1. `plan`: somente leitura. Valida os inputs antes de qualquer chamada de rede e publica
   `atual → proposto` no Job Summary.
2. `apply`: usa o Environment `staging-admin-hardening-apply`, requer aprovação humana e só
   executa depois do `plan`.

Nenhum workflow foi executado durante a implementação deste PR.

## Schema confirmado da API Cloudflare

Em 4 de agosto de 2026, o schema foi conferido na documentação oficial do endpoint:

`PUT /accounts/{account_id}/ai-gateway/gateways/{id}`

Os campos usados por este workflow são:

- `collect_logs`;
- `zdr`;
- `rate_limiting_limit`;
- `rate_limiting_interval`;
- `rate_limiting_technique`;
- `spend_limits.enabled`;
- `spend_limits.rules[]`, com `id`, `enabled`, `limit`, `limitType`, `window` e `technique`.

A implementação anterior que usava `spend_limit_amount` e `spend_limit_period` estava incorreta
e foi substituída pelo schema real `spend_limits.rules[]`.

Referências oficiais:

- https://developers.cloudflare.com/api/resources/ai_gateway/methods/update/
- https://developers.cloudflare.com/ai-gateway/features/spend-limits/

A referência da API define `window` como número positivo, mas não informa sua unidade na descrição
do campo. Por isso, o workflow recebe `ai_gateway_spend_limit_window` como valor numérico literal e
não converte automaticamente `daily`, `weekly` ou `monthly`. Antes do primeiro apply com spend
limit, o valor deve ser confirmado no painel Cloudflare ou em uma resposta real da API. Se os dois
inputs do spend limit não forem informados, o estado existente é preservado.

## Regra global de spend limit KARV

Quando solicitada, a regra gerenciada pelo workflow usa:

```text
{
  "id": "karv-staging-global-budget",
  "enabled": true,
  "limitType": "cost",
  "limit": <número informado>,
  "window": <inteiro informado>,
  "technique": "fixed"
}
```

A regra não contém dimensões de modelo, provedor ou metadata; portanto, representa um orçamento
global compartilhado pelo gateway. Regras externas existentes são preservadas. O script substitui
somente a regra com o ID acima e falha antes da escrita se a inclusão ultrapassaria o limite de 20
regras por gateway.

Spend limits são limites de custo estimado. Ao atingir o orçamento, o AI Gateway bloqueia novas
requisições aplicáveis com HTTP 429 até a janela reiniciar. O valor exato da cobrança deve continuar
sendo verificado no provedor de IA.

## Payload explícito e preservação segura

O `PUT` não reaproveita a resposta inteira da API. O payload é montado por lista branca com os
campos graváveis documentados.

Os campos obrigatórios `cache_invalidate_on_update` e `cache_ttl` são validados e preservados. Os
campos opcionais documentados são preservados apenas quando presentes. Campos somente leitura,
como `id`, `created_at` e `modified_at`, nunca são reenviados.

Se a resposta atual contiver configuração `stripe`, o script falha antes da mutação. A API exige o
campo sensível `stripe.authorization` em uma escrita desse objeto, e não é seguro presumir que uma
resposta de leitura contenha uma credencial reutilizável.

## Credenciais e GitHub Environments

### Environment `staging` — job `plan`

- secret `CLOUDFLARE_ADMIN_API_TOKEN`;
- variable `CLOUDFLARE_ACCOUNT_ID`.

### Environment `staging-admin-hardening-apply` — job `apply`

- required reviewer configurado;
- secret `CLOUDFLARE_ADMIN_API_TOKEN`;
- secret `KARV_INTERNAL_API_TOKEN`;
- variable `CLOUDFLARE_ACCOUNT_ID`;
- variable `STAGING_HEALTH_URL`.

O workflow falha explicitamente se qualquer requisito do job correspondente estiver ausente. Os
valores dos secrets nunca são impressos.

## Permissões mínimas do token administrativo

O `CLOUDFLARE_ADMIN_API_TOKEN` precisa somente de:

- AI Gateway Read;
- AI Gateway Write;
- Workers Scripts Write.

Este workflow não usa Access, Notifications, DNS, Billing ou permissão para editar o código-fonte
do Worker. Permissões não usadas devem ser removidas do token.

## Validação e comportamento fail-closed

Antes de qualquer chamada à API, o job `plan` valida:

- rate limit como inteiros positivos;
- spend limit como par completo `amount + window`, ou nenhum dos dois;
- amount como número positivo;
- window como inteiro positivo;
- confirmação literal `HARDEN-STAGING`;
- feature flags críticas desativadas.

A auditoria `post` falha se não confirmar:

- secret do Worker presente;
- `collect_logs=false`;
- `zdr=true`;
- rate limit idêntico ao solicitado;
- regra KARV de spend limit idêntica ao solicitado, quando aplicável.

Também falha se a API não puder ser lida, se o schema retornado for incompatível ou se uma
configuração Stripe impedir preservação segura.

## Controles ainda pendentes fora deste PR

Este PR não resolve e não deve declarar como concluídos:

- Cloudflare Access ou proteção administrativa equivalente;
- destinatário e canal do alerta de custo;
- lista de administradores autorizados da conta Cloudflare;
- escolha entre login humano e Service Auth;
- valores de negócio para rate limit;
- valor e janela do spend limit.

O staging atual em `workers.dev` exige uma decisão de infraestrutura antes de aplicar Access a um
hostname próprio. Essa decisão não é automatizada neste workflow.

## Critério de fechamento da issue #18

A issue #18 permanece aberta. Código implementado não é evidência de execução.

Ela só poderá ser encerrada quando houver evidência não sensível de:

1. workflow executado em staging;
2. auditoria pós-apply aprovada;
3. health check aprovado;
4. secret do Worker presente;
5. rate limit confirmado;
6. ZDR e payload logging confirmados;
7. spend limit confirmado, depois da decisão de orçamento;
8. Access ou proteção equivalente resolvida;
9. destinatário do alerta de custo resolvido.

Até lá, a IA, reporting e delivery permanecem desativados.

## Rollback

| Alteração | Rollback |
| --- | --- |
| `KARV_INTERNAL_API_TOKEN` no Worker | Excluir o secret com Wrangler ou restaurar o valor anterior conforme o runbook de rotação. |
| Rate limit, ZDR, logging e spend limit | Usar os valores registrados no Job Summary do `plan` e executar um rollback administrativo revisado. |
| Arquivos deste PR | Reverter o PR em uma alteração separada. |

O rollback não é automático porque pode envolver segredo anterior e decisões administrativas que
não devem ser inferidas pelo workflow.

## Validações executadas antes da PR

- sintaxe dos dois scripts Node.js;
- parsing YAML do workflow;
- mock de atualização bem-sucedida;
- preservação de regras de spend limit externas;
- ausência de campos somente leitura no payload;
- falha antes do PUT quando existe Stripe;
- falha antes da rede quando amount/window estão incompletos;
- auditoria `pre` com proposta sem mutação;
- auditoria `post` aprovada;
- auditoria `post` falhando estritamente para controles divergentes.

Nenhum token real foi usado e nenhuma mutação Cloudflare foi executada nesses testes.

## Decisões humanas necessárias antes do apply

- definir quantidade e janela do rate limit;
- definir valor e `window` do spend limit, após confirmar a unidade exibida pela Cloudflare;
- configurar ou confirmar os dois GitHub Environments;
- revisar o Job Summary do `plan`;
- aprovar separadamente o job `apply`;
- decidir Access/proteção equivalente e destinatário do alerta de custo.
