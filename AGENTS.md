# KARV Cloud Platform

## Regras permanentes

- Nunca grave chaves, tokens ou credenciais em arquivos versionados, issues, pull requests ou logs.
- Use `.dev.vars` somente para desenvolvimento local e Cloudflare Secrets para ambientes remotos.
- Trabalhe exclusivamente em branch `agent/<objetivo>` e abra a pull request inicialmente como draft.
- Nunca altere `main` diretamente, nunca faça force push e nunca exclua a branch padrão.
- Merge exige checks aprovados, conversas de revisão resolvidas, pelo menos uma aprovação humana e decisão explícita da direção KARV.
- Não habilite auto-merge para mudanças de infraestrutura, segurança, cobrança, IA ou deploy.
- Não execute deploy de produção sem aprovação explícita da direção KARV.
- Produção não deve possuir gatilho automático por push, pull request ou merge.
- Antes de concluir qualquer alteração, execute `npm ci`, `npm run check`, `npm ci --prefix monitoring-agent`, `npm run check --prefix monitoring-agent` e `git diff --check`.
- Mantenha `karv-lps`, `KV_COLLAB_BLING`, `3D` e `karv-cloud-platform` como repositórios independentes, com responsabilidades separadas.
- APIs de IA devem exigir autenticação, limitar entrada e nunca registrar prompts ou dados pessoais em logs.
- Relatórios devem usar somente metadados agregados; nunca incluir prompts, respostas, pedidos ou contatos.
- O KARV Sentinel pode preparar correções somente em `src/`, branch `agent/*` e PR draft; nunca pode fazer merge ou deploy.
- Branches mergeadas só podem ser excluídas depois de confirmar que a PR correspondente foi incorporada e que não existem commits posteriores ao head da PR.
- Se houver divergência, evidência insuficiente ou limitação de permissão, preserve o recurso e documente o bloqueio; não improvise operações administrativas.

## Validação mínima da pull request

Os checks obrigatórios esperados são:

- `CI / validate` — instala dependências e executa `npm run check` no Worker.
- `CI / validate-sentinel` — instala dependências e executa `npm run check` no `monitoring-agent`.

A documentação operacional completa está em `docs/repository-governance.md`.
