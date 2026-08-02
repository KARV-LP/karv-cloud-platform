import type { AgentDecision, Incident, SentinelDecision } from "./contracts.js";

const SENSITIVE_CATEGORIES = new Set(["security", "cost"]);
const FORBIDDEN_ACTIONS = [
  "deploy",
  "merge",
  "main branch",
  "production",
  "secret",
  "credential",
  "billing",
  "delete data",
  "disable authentication",
  "disable security"
];
const SAFE_COMMANDS = new Set([
  "npm run check",
  "npm run typecheck",
  "npm test",
  "git diff --check"
]);

export function enforceRemediationPolicy(
  incident: Incident,
  decision: AgentDecision
): SentinelDecision {
  const reasons: string[] = [];
  const requestedText = [
    decision.recommendedAction,
    decision.remediation.fixPrompt ?? ""
  ]
    .join(" ")
    .toLowerCase();

  if (decision.priority === "P0" || decision.priority === "P1") {
    reasons.push("P0/P1 requires human approval");
  }
  if (SENSITIVE_CATEGORIES.has(decision.category)) {
    reasons.push("Security and cost changes require human approval");
  }
  if (decision.confidence < 0.85) {
    reasons.push("Confidence is below 0.85");
  }
  if (incident.evidence.length === 0 || decision.observedEvidence.length === 0) {
    reasons.push("Observed evidence is required");
  }
  if (FORBIDDEN_ACTIONS.some((term) => requestedText.includes(term))) {
    reasons.push("The proposed action touches a protected operation");
  }
  if (
    decision.remediation.validationCommands.some(
      (command) => !SAFE_COMMANDS.has(command)
    )
  ) {
    reasons.push("The proposal contains a validation command outside the allowlist");
  }

  const canPrepareDraftPr =
    decision.remediation.mode === "prepare_draft_pr" && reasons.length === 0;

  return {
    ...decision,
    remediation: {
      ...decision.remediation,
      mode: canPrepareDraftPr
        ? "prepare_draft_pr"
        : decision.remediation.mode === "observe"
          ? "observe"
          : "human_action"
    },
    policy: { blockingReasons: reasons, canPrepareDraftPr }
  };
}
