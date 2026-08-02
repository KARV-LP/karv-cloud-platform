# KARV Cloud Platform

Infraestrutura independente para APIs, segurança e conectividade com GPT e Claude nos sites KARV.

## Estado atual

- Cloudflare Worker em TypeScript.
- Endpoint de saúde: `GET /health`.
- Endpoint interno de IA: `POST /api/internal/ai`.
- OpenAI Responses API e Anthropic Messages API via Cloudflare AI Gateway.
- IA desativada por padrão.
- Autenticação interna obrigatória.
- Limites de corpo e tarefas permitidas.
- Nenhum segredo em código ou GitHub.
- Nenhum deploy automático de produção.
- Métricas seguras por projeto no Workers Analytics Engine.
- Relatórios internos de 7 e 30 dias, desativados por padrão.
- Agendamento semanal e mensal preparado, sem destino ativo.
- KARV Sentinel para triagem de incidentes e preparação controlada de correções em PR draft.

## Desenvolvimento local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Preencha `.dev.vars` somente no ambiente local. O arquivo é ignorado pelo Git.

## Segredos necessários

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `KARV_INTERNAL_API_TOKEN`
- `AI_GATEWAY_TOKEN` quando o gateway autenticado estiver habilitado
- `CLOUDFLARE_ANALYTICS_TOKEN` com permissão somente de leitura analítica
- `REPORT_WEBHOOK_URL` e `REPORT_WEBHOOK_TOKEN` somente quando a entrega automática for aprovada

Em produção, configure esses valores como Cloudflare Secrets. Nunca coloque valores secretos em `wrangler.jsonc`, commits, issues ou mensagens de PR.

## Configuração não secreta

Defina em `wrangler.jsonc`:

- `AI_GATEWAY_BASE_URL`: `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}`
- `OPENAI_MODEL`: rota equilibrada para as tarefas internas
- `ANTHROPIC_MODEL`: modelo Anthropic aprovado
- `ALLOWED_ORIGINS`: origens oficiais da KARV
- `AI_API_ENABLED`: permanece `false` até a validação do gateway, limites financeiros e autenticação
- `KARV_PROJECTS`: identificadores aceitos para separar consumo por projeto
- `REPORTING_API_ENABLED`: permanece `false` até configurar o token analítico
- `REPORT_DELIVERY_ENABLED`: permanece `false` até aprovar o destino dos relatórios

Detalhes operacionais: [`docs/reporting.md`](docs/reporting.md).

Agente de monitoramento: [`monitoring-agent/README.md`](monitoring-agent/README.md).

## Comandos

```bash
npm run typecheck
npm test
npm run check
```

O comando `npm run deploy` existe para operação manual, mas não deve ser executado sem aprovação explícita da direção KARV.
