# Fase 2 — Hardening administrativo do staging Cloudflare

## Escopo

Este plano cobre os controles administrativos restantes da issue #18. A parte técnica anterior —
autenticação interna, CORS fail-closed, políticas por projeto, rate limiting no Worker, testes
negativos e validação remota — já foi incorporada nas PRs #19 e #22.

Este trabalho:

- não altera produção;
- não habilita `AI_API_ENABLED`;
- não habilita `REPORTING_API_ENABLED`;
- não habilita `REPORT_DELIVERY_ENABLED`;
- não executa apply antes de plan e aprovação.

A baseline operacional detalhada está em:

- `docs/phase2-admin-operational-baseline.md`.

## Estado administrativo validado

### GitHub Environments

Criados:

- `staging`;
- `staging-admin-hardening-apply`.

O Environment de apply possui:

- required reviewer `kv-manager`;
- `Prevent self-review` ativo;
- wait timer desativado;
- bypass de administradores desativado;
- autorização somente para a branch `main`;
- zero tags autorizadas.

`kv-manager` é uma conta distinta, mas está sob controle do mesmo operador. O gate é tecnicamente
válido, porém não representa revisão humana independente plena. Essa exceção deve permanecer
registrada na PR e na issue #18.

### Tokens Cloudflare

Token de auditoria:

- Workers Scripts Read;
- AI Gateway Read.

Token administrativo:

- Workers Scripts Write;
- AI Gateway Read;
- AI Gateway Write.

### Cloudflare Access

O Worker `karv-cloud-platform-staging` está protegido por uma aplicação Self-hosted com:

- política humana `Allow` limitada a `commercial.karv.sp@gmail.com`;
- Service Token `karv-staging-github-actions`;
- política `Service Auth` vinculada.

Um Service Token anterior cujo Client Secret apareceu em captura foi excluído e substituído. Ele
não pode ser reutilizado.

### Budget Alert

O alerta de conta proposto de `USD 10` por ciclo foi dispensado por decisão explícita do operador em
`2026-08-04`.

A ausência do alerta deve ser registrada como exceção aceita. Não declarar o alerta como criado.
O controle técnico de bloqueio continua sendo o spend limit do AI Gateway.

## Controles implementados pela PR #23

O workflow `.github/workflows/harden-staging.yml` implementa e verifica:

- presença do secret `KARV_INTERNAL_API_TOKEN` no Worker de staging;
- `collect_logs=false`;
- `zdr=true`;
- rate limit do AI Gateway;
- regra global opcional de spend limit;
- preservação sanitizada de campos existentes;
- bloqueio preventivo para Stripe e OpenTelemetry com credenciais;
- existência de required reviewer antes da mutação;
- health check protegido por Cloudflare Access;
- feature flags críticas desativadas;
- ausência de comandos direcionados à produção.

O health check não segue redirects. Os headers do Service Token são enviados somente ao hostname
configurado em `STAGING_HEALTH_URL`.

## Separação entre plan e apply

O workflow é acionado somente por `workflow_dispatch`.

### `plan`

- modo padrão;
- confirmação literal `PLAN-STAGING`;
- usa apenas `CLOUDFLARE_AUDIT_API_TOKEN`;
- executa somente leituras;
- publica estado atual e proposta no Job Summary;
- não agenda mutação quando `execution_mode=plan`.

### `apply`

- exige seleção explícita;
- exige confirmação literal `APPLY-STAGING`;
- executa o plan antes;
- agenda o job protegido somente se o plan passar;
- exige aprovação no Environment `staging-admin-hardening-apply`;
- exige Service Token do Cloudflare Access para o health check.

O workflow só poderá ser acionado manualmente após existir na branch padrão, portanto após merge
explícito da PR #23.

## Baseline técnica

### Rate limit

- limite: `10` requisições;
- janela: `60` segundos;
- técnica: `sliding`.

### Spend limit

- limite: `USD 5`;
- janela: `86400` segundos;
- técnica: `fixed`;
- bloqueio esperado: HTTP `429`.

A Cloudflare documenta `window` em segundos nos controles de rate/budget limit. Uma janela de 24
horas corresponde a:

```text
24 × 60 × 60 = 86400
```

O workflow rejeita um spend limit quando `window` é diferente de `86400`.

Referências oficiais:

- https://developers.cloudflare.com/ai-gateway/features/spend-limits/
- https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/json-configuration/
- https://developers.cloudflare.com/api/resources/ai_gateway/methods/update/

## Regra global KARV

Quando solicitada, a regra gerenciada usa:

```json
{
  "id": "karv-staging-global-budget",
  "enabled": true,
  "limitType": "cost",
  "limit": 5,
  "window": 86400,
  "technique": "fixed"
}
```

A regra não contém filtro por modelo, provedor ou metadata. Ela representa um orçamento global
compartilhado pelo gateway.

Regras externas válidas são reconstruídas por lista branca, preservadas e comparadas depois da
escrita. O script gerencia somente a regra com o ID acima.

## Payload e comportamento fail-closed

O `PUT` é montado por lista branca. Campos somente leitura ou desconhecidos não são reenviados.

Campos obrigatórios preservados:

- `cache_invalidate_on_update`;
- `cache_ttl`.

O script falha antes do `PUT` quando:

- a resposta atual contém Stripe;
- OpenTelemetry contém `authorization`;
- o schema é incompatível;
- spend limit foi informado parcialmente;
- a janela do spend limit não é `86400` no workflow;
- o limite de regras seria excedido;
- a API não pode ser lida.

A auditoria pós-apply falha quando qualquer controle diverge do solicitado.

## Sequência operacional

1. concluir a revisão da PR #23;
2. aguardar o CI do head final;
3. marcar a PR como pronta para revisão;
4. fazer merge explícito na `main` somente após validação;
5. executar plan sem spend limit:

```text
execution_mode=plan
confirmation=PLAN-STAGING
ai_gateway_rate_limit_requests=10
ai_gateway_rate_limit_period_seconds=60
ai_gateway_spend_limit_amount=
ai_gateway_spend_limit_window=
```

6. revisar integralmente o Job Summary;
7. executar plan com spend limit:

```text
execution_mode=plan
confirmation=PLAN-STAGING
ai_gateway_rate_limit_requests=10
ai_gateway_rate_limit_period_seconds=60
ai_gateway_spend_limit_amount=5
ai_gateway_spend_limit_window=86400
```

8. revisar novamente o Job Summary;
9. executar apply com os mesmos valores e:

```text
execution_mode=apply
confirmation=APPLY-STAGING
```

10. aprovar o Environment pela conta revisora, registrando que ela está sob o mesmo operador;
11. validar auditoria pós-escrita e health check;
12. registrar evidências sanitizadas na issue #18.

## Critério de fechamento da issue #18

A issue permanece aberta até existir evidência não sensível de:

1. plan sem spend limit executado e revisado;
2. plan com `USD 5/86400` executado e revisado;
3. apply executado após aprovação do Environment;
4. health check através do Access retornando `200`;
5. Worker secret presente;
6. rate limit `10/60` com técnica `sliding`;
7. `zdr=true`;
8. `collect_logs=false`;
9. spend limit `USD 5`, `window=86400`, técnica `fixed`;
10. Access ativo e política humana restrita;
11. produção não alterada;
12. IA, reporting e delivery desativados;
13. Budget Alert registrado como dispensado por decisão do operador;
14. exceção de revisão não independente registrada explicitamente.

## Evidências permitidas

Registrar somente:

- IDs de runs e conclusões dos jobs;
- presença de secrets por nome, nunca por valor;
- valores não sensíveis de rate limit e spend limit;
- `collect_logs=false`;
- `zdr=true`;
- HTTP status do health check;
- nomes de políticas e contas autorizadas;
- dispensa do Budget Alert;
- exceção temporária do reviewer sob o mesmo operador.

Nunca registrar tokens, Client Secret, headers de autenticação, prompts ou respostas.

## Rollback

| Alteração | Rollback |
| --- | --- |
| Worker secret | Excluir ou restaurar conforme o runbook de rotação. |
| Rate limit, ZDR, logging e spend limit | Restaurar os valores registrados no Job Summary do plan. |
| Access | Substituir a política por versão aprovada ou desabilitar somente após revisão de incidente. |
| Service Token | Revogar o token e remover os secrets do Environment. |
| Arquivos da PR | Reverter em alteração separada. |

O rollback não é automático porque pode envolver credenciais e decisões administrativas que não
devem ser inferidas pelo workflow.
