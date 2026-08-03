# Governança do repositório

## Escopo

Este documento registra a Fase 0 de higienização e define as regras operacionais do repositório `KARV-LP/karv-cloud-platform`. A `main` permanece como fonte da verdade. Nenhuma ação desta fase autoriza deploy, merge automático, alteração de secrets ou mudança funcional na API.

## Auditoria inicial — 2026-08-03

### Estado da `main`

- Branch padrão: `main`.
- Commit observado no início da auditoria: `900082890bbe22c576d9769ee69b770ed84e069d`.
- Commit: `Prepara deploy manual e seguro do staging Cloudflare (#7)`.
- Não havia pull request aberta ou draft no momento da auditoria.
- A única issue aberta era a issue #8, referente a esta fase de governança.
- O workflow de produção continua inexistente; o único workflow de deploy identificado é manual e exclusivo para staging.

### Branches históricas

| Branch | PR | PR mergeada | Head atual igual ao head da PR | Decisão |
| --- | ---: | --- | --- | --- |
| `agent/cloudflare-platform-foundation` | #1 | Sim | Sim — `8b4b5ebaac0d5bbc6b33babf388881117749f489` | Segura para exclusão |
| `agent/sentinel-issue-message` | #3 | Sim | Sim — `9011a55be3dda544490b2738e17b4974650762f0` | Segura para exclusão |
| `agent/cloudflare-wrangler-hardening` | #5 | Sim | Sim — `a0f2e19f8df14045290b7433fd1d38126c4c88b7` | Segura para exclusão |
| `agent/configure-staging-ai-gateway` | #6 | Sim | Sim — `41139d39dfac1c0fd56eb27ecb62a6db2ae65c47` | Segura para exclusão |
| `agent/manual-cloudflare-staging-deploy` | #7 | Sim | Sim — `2cd473b45f070756723c7ac8407550d838330f19` | Segura para exclusão |

As comparações entre cada branch e o head registrado na PR correspondente retornaram `identical`, com `ahead_by: 0` e `behind_by: 0`. Portanto, não há commits posteriores ao fechamento das PRs nessas branches.

As branches foram preservadas durante esta execução porque o conector disponível não expõe exclusão de referências remotas. A exclusão pode ser feita manualmente após a aprovação desta PR, sem risco identificado de perda de trabalho.

### Issues de teste do KARV Sentinel

- Issue #2: teste controlado, encerrado como `completed`. Não houve incidente de produção. A melhoria de mensagem resultante foi incorporada pela PR #3 e não existe ação corretiva pendente.
- Issue #4: segundo teste controlado, encerrado como `completed`. Os guardrails de `observe` e bloqueio por baixa confiança foram validados. Não houve incidente de produção nem ação corretiva pendente.
- Ambas receberam comentário final de higienização em 2026-08-03.

## Regras operacionais

1. Toda alteração começa em branch `agent/<objetivo>` criada a partir da `main` atualizada.
2. Toda pull request começa como draft.
3. `main` não recebe push direto, force push ou exclusão.
4. Merge exige checks aprovados, conversas resolvidas, pelo menos uma aprovação humana e decisão explícita da direção KARV.
5. Deploy de produção exige aprovação explícita e nunca deve ser acionado automaticamente por push, PR ou merge.
6. Secrets, tokens, credenciais e dados pessoais não entram em commits, issues, pull requests ou logs.
7. Branch mergeada só é excluída após confirmar o merge e comparar o head remoto com o head da PR.
8. Divergência ou evidência insuficiente bloqueia a exclusão e deve ser documentada.
9. Alterações administrativas não suportadas pela integração devem ser realizadas manualmente; não se deve improvisar por outro mecanismo.

## Checks obrigatórios

A proteção da `main` deve exigir estes checks do workflow `CI`:

- `validate` — `npm ci` e `npm run check` na raiz.
- `validate-sentinel` — `npm ci` e `npm run check` em `monitoring-agent`.

Antes da conclusão local de qualquer trabalho, execute:

```bash
npm ci
npm run check
npm ci --prefix monitoring-agent
npm run check --prefix monitoring-agent
git diff --check
```

## Configuração manual da proteção da `main`

O conector usado nesta fase não permite consultar ou alterar branch protection/rulesets. No GitHub, criar ou revisar um ruleset direcionado exclusivamente à branch `main` com as seguintes regras:

- exigir pull request antes do merge;
- exigir pelo menos 1 aprovação;
- descartar aprovações antigas quando novos commits forem enviados;
- exigir aprovação do último push por pessoa diferente do autor, quando disponível;
- exigir resolução de todas as conversas antes do merge;
- exigir os checks `validate` e `validate-sentinel` antes do merge;
- exigir branch atualizada antes do merge;
- bloquear force push;
- bloquear exclusão da branch;
- restringir atualizações diretas da `main`;
- não permitir bypass, exceto conta administrativa de emergência formalmente definida;
- manter auto-merge desabilitado para infraestrutura, segurança, cobrança, IA e deploy.

## Limpeza manual pendente

Após aprovação desta PR, excluir somente estas branches históricas já validadas:

```text
agent/cloudflare-platform-foundation
agent/sentinel-issue-message
agent/cloudflare-wrangler-hardening
agent/configure-staging-ai-gateway
agent/manual-cloudflare-staging-deploy
```

Não excluir `agent/phase-0-repository-governance` antes do merge e da validação final desta fase.

## Resultado e limitações da execução

- Nenhum deploy foi executado.
- Nenhum secret, token, credencial ou configuração de cobrança foi alterado.
- Nenhuma mudança funcional foi feita na API.
- Nenhum workflow de produção foi criado ou habilitado.
- As validações locais não puderam ser executadas no ambiente do agente porque o acesso de rede ao GitHub/npm e o GitHub CLI não estavam disponíveis.
- A PR desta documentação deve ser validada pelos jobs `CI / validate` e `CI / validate-sentinel` antes de qualquer merge.
