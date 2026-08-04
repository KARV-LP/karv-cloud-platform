output "ai_gateway_rate_limit_summary" {
  description = "Resumo não sensível do rate limit aplicado, para evidência na issue #18."
  value       = "karv-ai-gateway-staging: ${var.ai_gateway_rate_limit_requests} req / ${var.ai_gateway_rate_limit_period_seconds}s"
}
