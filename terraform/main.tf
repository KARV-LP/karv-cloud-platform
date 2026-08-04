# AI Gateway de staging já existe (criado manualmente antes deste plano — ver
# AI_GATEWAY_BASE_URL em wrangler.jsonc: .../karv-ai-gateway-staging). O bloco de
# import abaixo traz o recurso existente para o state em vez de tentar criar um
# gateway novo. NUNCA remover este bloco sem confirmar que o import já ocorreu,
# ou o próximo `terraform plan` vai propor recriar/duplicar o gateway.
#
# ATENÇÃO — incerteza documentada em docs/phase2-cloudflare-admin-hardening-plan.md:
# os nomes de atributo abaixo (rate_limiting_*, collect_logs) refletem o melhor
# entendimento do provider Cloudflare no momento em que este esqueleto foi escrito.
# Eles DEVEM ser confirmados por `terraform validate`/`terraform plan` na versão do
# provider fixada em versions.tf antes de qualquer apply. Se o schema real for
# diferente, a falha esperada é o `terraform validate` do job de plan — nunca uma
# mutação incorreta, porque nenhum apply roda sem o job de plan ter sucesso antes.

import {
  to = cloudflare_ai_gateway.staging
  id = "${var.cloudflare_account_id}/karv-ai-gateway-staging"
}

resource "cloudflare_ai_gateway" "staging" {
  account_id = var.cloudflare_account_id
  id         = "karv-ai-gateway-staging"

  # Mapeia para o toggle "Log payloads" do AI Gateway. Deve permanecer false —
  # ver SECURITY.md e docs/staging-security.md ("payload logging desativado").
  collect_logs = false

  rate_limiting_limit     = var.ai_gateway_rate_limit_requests
  rate_limiting_interval  = var.ai_gateway_rate_limit_period_seconds
  rate_limiting_technique = "sliding"
}

# Reservado para a Fase C, sem recurso ainda:
#
# - Cloudflare Access / proteção administrativa (decisões A e E): ver seção dedicada
#   do plano — workers.dev não pode receber uma Access Application diretamente.
#   Se a direção KARV decidir anexar um domínio próprio ao staging, este arquivo
#   ganha um `cloudflare_zero_trust_access_application` e uma
#   `cloudflare_zero_trust_access_policy` apontando para var.admin_allowed_principals
#   e var.admin_auth_method.
# - Spend limit / alerta de custo (decisões C e D): sem recurso Cloudflare confirmado.
#   Enquanto não confirmado, permanece como item de auditoria manual, não IaC.
