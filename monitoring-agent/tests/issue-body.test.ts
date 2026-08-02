import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildIssueBody } = require("../../.github/scripts/sentinel-issue.cjs") as {
  buildIssueBody: (decision: Record<string, unknown>) => string;
};

function decision(mode: "observe" | "prepare_draft_pr" | "human_action") {
  return {
    category: "unknown",
    confidence: 0.99,
    observedEvidence: ["Teste controlado"],
    policy: { blockingReasons: [] },
    priority: "P3",
    recommendedAction: "Registrar o resultado.",
    remediation: { mode },
    summary: "Teste do KARV Sentinel"
  };
}

describe("KARV Sentinel issue body", () => {
  it("keeps observe incidents in observation mode", () => {
    const body = buildIssueBody(decision("observe"));

    expect(body).toContain("o incidente permanecerá somente em observação");
    expect(body).not.toContain("PR draft pode ser preparada");
  });

  it("mentions a draft PR only for prepare_draft_pr decisions", () => {
    const body = buildIssueBody(decision("prepare_draft_pr"));

    expect(body).toContain("uma PR draft pode ser preparada");
  });

  it("keeps human-action decisions behind a human gate", () => {
    const body = buildIssueBody(decision("human_action"));

    expect(body).toContain("requer decisão humana antes de qualquer ação");
  });
});
