# Relatórios KARV

## Fontes oficiais

- Cloudflare Web Analytics: tráfego, visitantes e Core Web Vitals das LPs.
- Cloudflare Security Analytics/WAF: ameaças, bloqueios e regras acionadas.
- Workers Observability: disponibilidade, erros, latência e execuções agendadas.
- AI Gateway Analytics: solicitações, tokens, erros, cache e custo estimado de GPT/Claude.
- Workers Analytics Engine: consolidação por projeto KARV, provedor, tarefa e status.

## Identificação por projeto

Cada chamada interna de IA pode enviar `X-KARV-Project`. Valores aceitos são definidos em `KARV_PROJECTS`; quando ausente, o Worker usa `KARV_DEFAULT_PROJECT`.

O dataset `karv_platform_metrics` armazena somente metadados operacionais:

- projeto;
- provedor, tarefa e modelo;
- resultado e código HTTP;
- quantidade e duração.

Prompts, respostas, pedidos, contatos e outros dados pessoais nunca entram nesse dataset. O Worker também envia `cf-aig-collect-log-payload: false` ao AI Gateway para preservar tokens, custo, status e duração sem armazenar os conteúdos.

## Relatório consolidado

Rota interna:

```text
GET /api/internal/reports/summary?period=7d
GET /api/internal/reports/summary?period=30d
```

A rota exige o mesmo bearer token interno e permanece desativada com `REPORTING_API_ENABLED=false`.

Para ativar em produção:

1. definir `CLOUDFLARE_ACCOUNT_ID` como variável;
2. criar um token Cloudflare limitado a `Account Analytics Read` e armazená-lo como `CLOUDFLARE_ANALYTICS_TOKEN` em Secrets;
3. confirmar que `KARV_INTERNAL_API_TOKEN` está configurado;
4. mudar `REPORTING_API_ENABLED` para `true` somente após validar o acesso.

## Entrega automática

Os Cron Triggers estão preparados para:

- semanal: segunda-feira às 12:00 UTC (09:00 em Brasília);
- mensal: dia 1 às 12:00 UTC (09:00 em Brasília).

A entrega permanece desativada com `REPORT_DELIVERY_ENABLED=false`. Para ativar, armazene `REPORT_WEBHOOK_URL` e, quando necessário, `REPORT_WEBHOOK_TOKEN` como Secrets, valide o destino e somente então altere a flag para `true`.

## Painéis por LP

Cada nova LP em `karv-lps` deverá receber Cloudflare Web Analytics e usar seu identificador estável nas chamadas ao Worker. Essa integração permite separar resultados sem duplicar a infraestrutura central.
