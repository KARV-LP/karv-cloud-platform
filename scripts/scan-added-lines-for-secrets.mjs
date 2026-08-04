import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PRIVATE_KEY_MARKER = new RegExp(
  "-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}"
);

const DETECTORS = [
  {
    name: "OpenAI/Anthropic-style API key",
    pattern: /\bsk-(?:proj-|ant-api\d{2}-)?[A-Za-z0-9_-]{20,}\b/
  },
  {
    name: "Stripe live secret",
    pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/
  },
  {
    name: "GitHub classic token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/
  },
  {
    name: "GitHub fine-grained token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/
  },
  {
    name: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: "Private key material",
    pattern: PRIVATE_KEY_MARKER
  },
  {
    name: "Literal Cloudflare token assignment",
    pattern:
      /\b(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ADMIN_API_TOKEN|CLOUDFLARE_AUDIT_API_TOKEN)\s*=\s*["']?[A-Za-z0-9_-]{32,}["']?/
  }
];

export function scanAddedLines(diffText) {
  const findings = [];
  let currentFile = "<unknown>";
  const lines = diffText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    const addedContent = line.slice(1);
    for (const detector of DETECTORS) {
      if (detector.pattern.test(addedContent)) {
        findings.push({
          detector: detector.name,
          diffLine: index + 1,
          file: currentFile
        });
      }
    }
  }

  return findings;
}

function runCli() {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: node scripts/scan-added-lines-for-secrets.mjs <arquivo.diff>");
    process.exit(2);
  }

  const findings = scanAddedLines(readFileSync(path, "utf8"));
  if (findings.length === 0) {
    console.log("Nenhum padrão de secret conhecido foi encontrado nas linhas adicionadas.");
    return;
  }

  for (const finding of findings) {
    console.error(
      `Possível secret: ${finding.detector} em ${finding.file} (linha ${finding.diffLine} do diff).`
    );
  }
  console.error("Varredura de secrets falhou. Remova ou rotacione qualquer credencial real.");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
