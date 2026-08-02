# Segurança

## Credenciais

- Nunca publique chaves de OpenAI, Anthropic, Cloudflare ou tokens internos.
- Use `.dev.vars` localmente e Cloudflare Secrets em produção.
- Revogue imediatamente qualquer chave exposta em logs, commits, issues ou mensagens.

## Endpoint de IA

- A rota é interna e permanece desativada por padrão.
- O token interno não deve ser usado em JavaScript executado no navegador.
- O gateway deve aplicar rate limit e limite financeiro antes da ativação.
- Prompts, pedidos e dados pessoais não devem aparecer nos logs.
- O AI Gateway deve manter apenas metadados, usando `cf-aig-collect-log-payload: false` para não armazenar prompts ou respostas.
- As respostas de IA são rascunhos e não executam publicação, mudança de preço ou envio de pedido.

## Relatórios

- O dataset analítico armazena somente projeto, provedor, tarefa, modelo, status, volume e duração.
- O endpoint de relatório exige autenticação interna e fica desativado por padrão.
- O token de Analytics deve ter somente a permissão `Account Analytics Read`.
- Webhooks de entrega devem usar HTTPS e autenticação própria.

## Divulgação

Relate vulnerabilidades de forma privada para `comercial@k-arv.com`. Não abra uma issue pública com detalhes exploráveis.
