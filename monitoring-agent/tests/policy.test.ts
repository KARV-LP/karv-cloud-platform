import { describe, expect, it } from "vitest";
import type { AgentDecision, Incident } from "../src/contracts.js";
import { enforceRemediationPolicy } from "../src/policy.js";

const incident: Incident = {
  evidence: ["CI failed in src/security.ts at test 4"],
  occurredAt: "2026-08-02T18:00:00.000Z",
  project: "karv-cloud-platform",
  source: "github",
  summary: "A deterministic validation test failed.",
  title: "CI validation failure"
};

const decision: AgentDecision = {
  category: "ci",
  confidence: 0.93,
  hypotheses: ["A regression changed the expected status."],
  observedEvidence: ["CI failed in src/security.ts at test 4"],
  priority: "P2",
  recommendedAction: "Prepare a minimal code fix in a draft pull request.",
  remediation: {
    fixPrompt: "Reproduce the failed test and apply the smallest source fix.",
    mode: "prepare_draft_pr",
    validationCommands: ["npm run check", "git diff --check"]
  },
  summary: "Reproducible CI regression."
};

describe("KARV Sentinel remediation policy", () => {
  it("allows a high-confidence P2 fix only as a draft PR", () => {
    const result = enforceRemediationPolicy(incident, decision);
    expect(result.policy.canPrepareDraftPr).toBe(true);
    expect(result.remediation.mode).toBe("prepare_draft_pr");
  });

  it("blocks P1 changes for human approval", () => {
    const result = enforceRemediationPolicy(incident, {
      ...decision,
      priority: "P1"
    });
    expect(result.policy.canPrepareDraftPr).toBe(false);
    expect(result.remediation.mode).toBe("human_action");
  });

  it("blocks deployment and production operations", () => {
    const result = enforceRemediationPolicy(incident, {
      ...decision,
      recommendedAction: "Deploy the fix directly to production."
    });
    expect(result.policy.canPrepareDraftPr).toBe(false);
    expect(result.policy.blockingReasons).toContain(
      "The proposed action touches a protected operation"
    );
  });

  it("blocks commands outside the validation allowlist", () => {
    const result = enforceRemediationPolicy(incident, {
      ...decision,
      remediation: {
        ...decision.remediation,
        validationCommands: ["curl https://example.com"]
      }
    });
    expect(result.policy.canPrepareDraftPr).toBe(false);
  });
});
