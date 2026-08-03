# Segurança de staging

## Objetivo

Este documento define os controles obrigatórios antes de ativar IA, relatórios ou entrega automática no ambiente `staging`. Nenhuma configuração de produção é alterada nesta fase.

## Estado seguro padrão

As seguintes variáveis devem permanecer como `false` até uma aprovação específica da direção KARV:

- `AI_API_ENABLED`
- `REPORTING_API_ENABLED`
- `REPORT_DELIVERY_ENABLED`

A ausência de configuração deve sempre bloquear a operação, nunca liberar por padrão.

## Autenticação interna

A API interna usa bearer token server-to-server.

Secrets aceitos:

- `KARV_INTERNAL_API_TOKEN`: token atual.
- `KARV_INTERNAL_API_TOKEN_NEXT`: token temporário usado somente durante rotação controlada.

### Rotação sem indisponibilidade

1. Criar um novo valor aleatório em um gerenciador de credenciais aprovado.
2. Cadastrar o novo valor como `KARV_INTERNAL_API_TOKEN_NEXT` em staging.
3. Validar uma chamada autenticada com o token novo.
4. Atualizar os consumidores autorizados para usar o token novo.
5. Substituir `KARV_INTERNAL_API_TOKEN` pelo novo valor.
6. Remover `KARV_INTERNAL_API_TOKEN_NEXT`.
7. Revogar e eliminar o token anterior no gerenciador de credenciais.
8. Registrar somente data, responsável e resultado; nunca registrar valores.

Se nenhum dos dois secrets existir, a API responde `503`.

## CORS e acesso por navegador

O padrão de staging é server-to-server. `ALLOWED_ORIGINS` fica vazio.

Uma origem de navegador só pode ser adicionada após revisão explícita de arquitetura e segurança. Origens não autorizadas recebem `403` no preflight e não recebem headers CORS.

CORS não substitui autenticação.

## Políticas por projeto

`KARV_PROJECT_POLICIES` define tarefas e tamanho máximo da entrada por projeto no ambiente de staging.

Política inicial:

- `karv-lps`: `catalog_summary`, `order_summary`, `seo_draft`; máximo 8.000 caracteres.
- `KV_COLLAB_BLING`: `order_summary`; máximo 6.000 caracteres.
- `3D`: `catalog_summary`; máximo 4.000 caracteres.
- `karv-cloud-platform`: `catalog_summary`; máximo 4.000 caracteres.

Uma política ausente ou inválida bloqueia a operação com `503`.

## Rate limiting

Toda chamada à API de IA em staging deve passar pelo binding `AI_RATE_LIMITER` antes de alcançar o provedor.

Configuração inicial de staging:

- 10 requisições por minuto por combinação `projeto:tarefa`.

Sem binding válido, a API responde `503`. Quando o limite é excedido, responde `429`.

A configuração equivalente de produção fica adiada para a fase específica de readiness de produção.

O AI Gateway deve possuir limite adicional independente, configurado no painel Cloudflare, para proteção em profundidade.

## Privacidade e logs

- prompts e respostas não devem ser gravados nos logs do Worker;
- o header de coleta de payload do AI Gateway deve permanecer desativado;
- métricas devem conter somente metadados agregados;
- Zero Data Retention deve ser habilitado no AI Gateway antes da ativação real;
- secrets, tokens, prompts, contatos, pedidos e dados pessoais nunca devem aparecer em issues, PRs ou logs.

## Controles administrativos no Cloudflare

Antes da ativação da IA em staging, confirmar sem revelar valores:

- `KARV_INTERNAL_API_TOKEN` cadastrado como Worker secret em staging;
- token do AI Gateway cadastrado como secret quando o gateway autenticado for habilitado;
- política do Cloudflare Access ou proteção administrativa equivalente;
- rate limiting do AI Gateway;
- Zero Data Retention;
- payload logging desativado;
- orçamento e alerta de custo;
- credenciais de provedores armazenadas como secrets ou BYOK, nunca como vars.

## Resposta a incidente

Quando houver suspeita de exposição ou abuso:

1. manter IA e relatórios desativados;
2. revogar o token afetado;
3. gerar token substituto;
4. revisar logs somente por metadados e request IDs;
5. verificar rate limits e custos;
6. bloquear origens ou consumidores afetados;
7. abrir registro de incidente sem dados sensíveis;
8. reativar somente após validação e aprovação humana.

## Validação obrigatória

Antes de qualquer merge:

```bash
npm ci
npm run audit:security
npm run check
npm run dry-run:staging
npm ci --prefix monitoring-agent
npm audit --audit-level=high --prefix monitoring-agent
npm run check --prefix monitoring-agent
git diff --check
```

Testes negativos obrigatórios incluem `401`, `403`, `413`, `415`, `429` e `503` para as condições documentadas na issue da Fase 2.
