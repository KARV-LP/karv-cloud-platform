# Cloudflare staging

Este procedimento cria somente o Worker de staging. Produção não possui workflow de deploy.

## Proteções permanentes

- o workflow aceita apenas acionamento manual (`workflow_dispatch`);
- a confirmação deve ser exatamente `DEPLOY-STAGING`;
- o job usa o GitHub Environment `staging`;
- todos os testes e o dry-run executam antes do deploy;
- `AI_API_ENABLED`, relatórios e entregas permanecem desativados;
- nenhuma chave pode ser gravada no repositório ou enviada em issues, PRs ou logs.

## Configuração no GitHub

Em **Settings → Environments → staging**, configure:

### Variable

- `CLOUDFLARE_ACCOUNT_ID`: identificador não secreto da conta Cloudflare KARV.

### Secret

- `CLOUDFLARE_API_TOKEN`: token exclusivo de CI, criado pelo template **Edit Cloudflare Workers** e limitado à conta KARV.

Não reutilize o token do AI Gateway como token de deploy.

## Credenciais de IA — etapa posterior

Depois que o Worker de staging existir, configure como secrets do Worker:

- `AI_GATEWAY_TOKEN`: token do gateway com permissão `Run`;
- `OPENAI_API_KEY`: chave do projeto OpenAI KARV;
- `ANTHROPIC_API_KEY`: chave do projeto Anthropic KARV;
- `KARV_INTERNAL_API_TOKEN`: token exclusivo para os clientes internos autorizados.

O token do gateway possui escopo de conta. Não o reutilize fora da KARV Cloud Platform e faça rotação se houver suspeita de exposição.

## Primeiro deploy

O deploy só pode ocorrer após aprovação explícita da direção KARV.

1. Abra **Actions → Deploy Cloudflare staging**.
2. Selecione **Run workflow**.
3. Digite `DEPLOY-STAGING`.
4. Aguarde testes, dry-run e deploy.
5. Valide somente `GET /health`; não habilite IA neste momento.

O ambiente de produção continuará sem deploy até existir aprovação separada.
