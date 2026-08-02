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
- As respostas de IA são rascunhos e não executam publicação, mudança de preço ou envio de pedido.

## Divulgação

Relate vulnerabilidades de forma privada para `comercial@k-arv.com`. Não abra uma issue pública com detalhes exploráveis.

