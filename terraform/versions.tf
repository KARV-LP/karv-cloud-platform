# Backend remoto ainda não decidido (ver docs/phase2-cloudflare-admin-hardening-plan.md,
# seção "Backend remoto do Terraform"). O bloco "s3" abaixo é parcial de propósito e
# funciona tanto para um bucket AWS S3 quanto para Cloudflare R2 (compatível com S3).
# A configuração real (bucket, endpoint, região, chaves de acesso) fica em
# terraform/backend.hcl, que nunca é versionado — ver terraform/backend.hcl.example.
#
# `terraform init -backend-config=backend.hcl` falha propositalmente até esse arquivo
# existir, para nunca cair silenciosamente em backend local dentro do runner de CI.

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {}
}

provider "cloudflare" {
  # CLOUDFLARE_API_TOKEN é lido do ambiente (GitHub secret CLOUDFLARE_ADMIN_API_TOKEN).
  # Nunca declarar o token diretamente neste arquivo.
}
