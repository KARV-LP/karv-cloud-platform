# Etapa 3 — Baseline administrativa e preparação operacional

## Objetivo

Definir os valores e o protocolo seguro para concluir o hardening administrativo do staging após o
merge da PR #23, sem ativar IA, reporting ou report delivery e sem tocar em produção.

## Baseline do staging

### Rate limit do AI Gateway

- limite: `10` requisições;
- janela: `60` segundos;
- técnica: `sliding`.

Os valores permanecem visíveis e editáveis no formulário do workflow, mas a execução prevista para
a issue #18 usa exatamente `10/60`.

### Spend limit

- orçamento global: `USD 5`;
- janela: `86400` segundos (`24` horas);
- técnica: `fixed`;
- comportamento ao atingir o limite: bloqueio com HTTP `429`.

A Cloudflare documenta `window` como uma janela de tempo em segundos nos controles de rate/budget
limit. Portanto, a janela diária adotada é:

```text
24 × 60 × 60 = 86400 segundos
```

O workflow rejeita qualquer valor diferente de `86400` quando um spend limit é solicitado.

Referências:

- https://developers.cloudflare.com/ai-gateway/features/spend-limits/
- https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/json-configuration/
- https://developers.cloudflare.com/api/resources/ai_gateway/methods/update/

### Alerta de custo da conta

O alerta proposto de `USD 10` por ciclo não será criado por decisão explícita do operador em
`2026-08-04`.

Consequência aceita:

- não haverá aviso informativo por e-mail quando o gasto da conta se aproximar de `USD 10`;
- o spend limit de `USD 5/24h` do AI Gateway continua sendo o mecanismo técnico de bloqueio;
- a dispensa deve ser registrada como exceção operacional na issue #18.

Essa dispensa não pode ser registrada como “alerta configurado”.

## Separação obrigatória entre plan e apply

O workflow usa o input `execution_mode`:

- `plan` — somente leitura; gera o Job Summary e não agenda mutação;
- `apply` — executa primeiro o plan e depois agenda o job protegido.

Confirmações literais:

- `PLAN-STAGING` para `plan`;
- `APPLY-STAGING` para `apply`.

Nenhum apply pode ocorrer antes de um plan real aprovado.

## GitHub Environments

### `staging`

Uso: auditoria somente leitura.

Variável:

- `CLOUDFLARE_ACCOUNT_ID`.

Secret:

- `CLOUDFLARE_AUDIT_API_TOKEN`.

Permissões mínimas:

- AI Gateway Read;
- Workers Scripts Read.

O secret legado `CLOUDFLARE_API_TOKEN` permanece temporariamente presente e não deve ser removido
sem validação posterior.

### `staging-admin-hardening-apply`

Uso: mutação administrativa explicitamente aprovada.

Proteções configuradas:

- required reviewer: `kv-manager`;
- `Prevent self-review` habilitado;
- wait timer desabilitado;
- bypass de administradores desabilitado;
- somente a branch `main` pode usar o Environment;
- nenhuma tag autorizada.

Exceção temporária:

`kv-manager` é uma conta GitHub distinta, mas está sob controle do mesmo operador. O gate técnico
funciona e impede self-review pela mesma conta que iniciou a execução, porém não representa revisão
humana independente plena. A issue #18 deve registrar essa limitação sem declarar independência.

Variáveis:

- `CLOUDFLARE_ACCOUNT_ID`;
- `STAGING_HEALTH_URL`, com HTTPS e caminho `/health`.

Secrets:

- `CLOUDFLARE_ADMIN_API_TOKEN`;
- `KARV_INTERNAL_API_TOKEN`;
- `CLOUDFLARE_ACCESS_CLIENT_ID`;
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`.

Permissões mínimas do token administrativo:

- AI Gateway Read;
- AI Gateway Write;
- Workers Scripts Write.

## Cloudflare Access

O Worker `karv-cloud-platform-staging` está protegido diretamente em `workers.dev`.

Configuração validada:

- aplicação Self-hosted para o Worker de staging;
- política humana `Allow` limitada a `commercial.karv.sp@gmail.com`;
- Service Token `karv-staging-github-actions`;
- política `Service Auth` vinculada;
- Client ID e Client Secret armazenados somente no Environment protegido.

O health check envia:

- `CF-Access-Client-Id`;
- `CF-Access-Client-Secret`.

O `curl` do health check não segue redirects. Isso impede que os headers personalizados do Service
Token sejam reenviados para outro destino. Qualquer resposta diferente de `200` encerra o job com
falha.

## Sequência operacional depois do merge

### Execução 1 — plan sem spend limit

```text
execution_mode=plan
confirmation=PLAN-STAGING
ai_gateway_rate_limit_requests=10
ai_gateway_rate_limit_period_seconds=60
ai_gateway_spend_limit_amount=
ai_gateway_spend_limit_window=
```

Objetivo: ler o estado real do Worker e do AI Gateway sem mutação e confirmar o conteúdo sanitizado
do Job Summary.

### Execução 2 — plan com spend limit

```text
execution_mode=plan
confirmation=PLAN-STAGING
ai_gateway_rate_limit_requests=10
ai_gateway_rate_limit_period_seconds=60
ai_gateway_spend_limit_amount=5
ai_gateway_spend_limit_window=86400
```

Objetivo: revisar a proposta completa antes de qualquer escrita.

### Execução 3 — apply protegido

Usar os mesmos valores da Execução 2, alterando somente:

```text
execution_mode=apply
confirmation=APPLY-STAGING
```

O job deve aguardar a aprovação no Environment. A aprovação é um gate técnico entre contas, com a
exceção de independência operacional descrita acima.

Após a aprovação, o workflow:

1. cadastra `KARV_INTERNAL_API_TOKEN` no Worker de staging;
2. configura rate limit, `collect_logs=false`, `zdr=true` e spend limit;
3. executa auditoria pós-escrita estrita;
4. testa `/health` através do Cloudflare Access;
5. confirma que produção e feature flags críticas permaneceram intactas.

## Evidências permitidas

Registrar na issue #18 somente:

- IDs e conclusões dos runs;
- presença ou ausência de secrets por nome;
- rate limit `10/60` e técnica;
- spend limit `USD 5`, `window=86400` e técnica `fixed`;
- `collect_logs=false`;
- `zdr=true`;
- HTTP status do health check;
- confirmação de Access ativo;
- e-mail humano autorizado;
- dispensa explícita do Budget Alert;
- exceção temporária de revisão não independente.

Nunca registrar tokens, Client Secret, valores de headers ou qualquer credencial.

## Critério de encerramento da issue #18

A issue só pode ser encerrada depois de evidência real de:

1. plan sem spend limit executado e revisado;
2. plan com `USD 5/86400` executado e revisado;
3. apply executado após aprovação do Environment;
4. secret interno presente;
5. rate limit `10/60` confirmado;
6. `collect_logs=false`;
7. `zdr=true`;
8. spend limit confirmado;
9. `/health` retornando `200` via Access;
10. IA, reporting e delivery desativados;
11. produção não alterada;
12. Budget Alert registrado como dispensado, não como configurado;
13. exceção de revisão sob o mesmo operador registrada explicitamente.
