# Arquitetura inicial

## Escopo

Este repositório centraliza somente infraestrutura compartilhada. `karv-lps`, `KV_COLLAB_BLING` e `3D` continuam independentes.

## Repositórios KARV

- `karv-lps`: landing pages e sites.
- `KV_COLLAB_BLING`: integração e colaboração com Bling.
- `3D`: experiência e recursos 3D.
- `karv-cloud-platform`: APIs, segurança e conectividade compartilhada com IA.

## Fluxo

1. Um serviço interno autorizado chama `POST /api/internal/ai`.
2. O Worker valida ativação, token, tipo de conteúdo, tamanho e tarefa permitida.
3. O adaptador selecionado envia a solicitação ao Cloudflare AI Gateway.
4. O gateway aplica autenticação, observabilidade, rate limit e limite financeiro.
5. O provedor responde e o Worker retorna somente o texto necessário.

## Separação de responsabilidades

- Cloudflare Edge: TLS, DDoS, WAF e regras de tráfego.
- Worker: autenticação, validação e roteamento.
- AI Gateway: custo, rate limit, métricas e fallback futuro.
- Analytics Engine: métricas agregadas por projeto sem prompts ou dados pessoais.
- Workers Observability: erros, latência, traces amostrados e execuções agendadas.
- KARV Sentinel: classificação de incidentes e proposta estruturada de correção.
- Codex Action: preparação isolada da correção, limitada a PR draft após acionamento humano.
- OpenAI/Anthropic: inferência.
- R2 futuro: apenas GLB web, texturas web e catálogo público.
- Arquivos industriais e masters: fora da infraestrutura pública.

## Controles antes da produção

- Criar gateway e preencher `AI_GATEWAY_BASE_URL`.
- Armazenar chaves via BYOK/Secrets Store ou Worker Secrets.
- Definir limite financeiro mensal e rate limit.
- Proteger previews com Cloudflare Access.
- Configurar WAF e Turnstile para qualquer futura rota pública.
- Manter `AI_API_ENABLED=false` até testes e aprovação.
- Validar que logs não contenham prompts ou dados pessoais.
- Configurar o token analítico de leitura e validar os relatórios de 7 e 30 dias.
- Aprovar o destino antes de habilitar a entrega semanal ou mensal.
