# Nenhuma variável abaixo tem valor padrão inventado. Todas chegam via TF_VAR_*
# a partir dos inputs de workflow_dispatch em .github/workflows/harden-staging.yml,
# decididos explicitamente pela direção KARV no momento do disparo.

variable "cloudflare_account_id" {
  description = "Conta Cloudflare KARV (não secreto)."
  type        = string
}

variable "admin_allowed_principals" {
  description = "Decisão A — e-mails/domínios autorizados a administrar o staging. Reservado: ainda não vinculado a um recurso (ver seção Cloudflare Access do plano)."
  type        = string
}

variable "admin_auth_method" {
  description = "Decisão E — human_login, service_token ou both. Reservado: ainda não vinculado a um recurso."
  type        = string

  validation {
    condition     = contains(["human_login", "service_token", "both"], var.admin_auth_method)
    error_message = "admin_auth_method deve ser human_login, service_token ou both."
  }
}

variable "ai_gateway_rate_limit_requests" {
  description = "Decisão B — número de requisições permitidas na janela do AI Gateway staging."
  type        = number

  validation {
    condition     = var.ai_gateway_rate_limit_requests > 0
    error_message = "ai_gateway_rate_limit_requests deve ser maior que zero."
  }
}

variable "ai_gateway_rate_limit_period_seconds" {
  description = "Decisão B — duração da janela do rate limit do AI Gateway staging, em segundos."
  type        = number

  validation {
    condition     = var.ai_gateway_rate_limit_period_seconds > 0
    error_message = "ai_gateway_rate_limit_period_seconds deve ser maior que zero."
  }
}

variable "spend_limit_amount" {
  description = "Decisão C — valor do limite de gasto. Reservado: nenhum recurso Terraform o consome ainda, pendente de confirmar se a Cloudflare expõe esse controle nativamente (ver seção Riscos e incertezas do plano)."
  type        = string
  default     = ""
}

variable "spend_limit_period" {
  description = "Decisão C — período do limite de gasto (daily/monthly). Reservado, mesma pendência acima."
  type        = string
  default     = ""
}

variable "cost_alert_recipient" {
  description = "Decisão D — destinatário do alerta de custo. Reservado, mesma pendência acima."
  type        = string
}
