function defaultPolicyMessage(decision) {
  if (decision.remediation.mode === "prepare_draft_pr") {
    return "- Nenhum; uma PR draft pode ser preparada após acionamento humano.";
  }

  if (decision.remediation.mode === "human_action") {
    return "- A análise requer decisão humana antes de qualquer ação.";
  }

  return "- Nenhum; o incidente permanecerá somente em observação.";
}

function buildIssueBody(decision) {
  const policyMessages = decision.policy.blockingReasons.length
    ? decision.policy.blockingReasons.map((item) => `- ${item}`)
    : [defaultPolicyMessage(decision)];

  return [
    "## KARV Sentinel",
    "",
    `**Prioridade:** ${decision.priority}`,
    `**Categoria:** ${decision.category}`,
    `**Confiança:** ${decision.confidence}`,
    `**Modo:** ${decision.remediation.mode}`,
    "",
    "## Diagnóstico",
    "",
    decision.summary,
    "",
    "## Evidências observadas",
    "",
    ...decision.observedEvidence.map((item) => `- ${item}`),
    "",
    "## Ação recomendada",
    "",
    decision.recommendedAction,
    "",
    "## Bloqueios de política",
    "",
    ...policyMessages
  ].join("\n");
}

module.exports = { buildIssueBody };
