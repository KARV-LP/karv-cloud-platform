# KARV Cloud Platform

## Regras permanentes

- Nunca grave chaves, tokens ou credenciais em arquivos versionados.
- Use `.dev.vars` somente para desenvolvimento local e Cloudflare Secrets para produção.
- Trabalhe em branch `agent/*` e abra PR draft; não altere `main` diretamente.
- Não execute deploy de produção sem aprovação explícita da direção KARV.
- Mantenha `karv-lps`, `KV_COLLAB_BLING`, `3D` e `karv-cloud-platform` como repositórios independentes, com responsabilidades separadas.
- APIs de IA devem exigir autenticação, limitar entrada e nunca registrar prompts ou dados pessoais em logs.
- Relatórios devem usar somente metadados agregados; nunca incluir prompts, respostas, pedidos ou contatos.
- O KARV Sentinel pode preparar correções somente em `src/`, branch `agent/*` e PR draft; nunca pode fazer merge ou deploy.
- Execute `npm run check` antes de publicar qualquer branch.
