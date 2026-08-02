import { z } from "zod";

export const IncidentSchema = z.object({
  evidence: z.array(z.string().min(1).max(1000)).min(1).max(20),
  occurredAt: z.string().datetime(),
  project: z.enum(["karv-lps", "KV_COLLAB_BLING", "3D", "karv-cloud-platform"]),
  source: z.enum(["cloudflare", "github", "application", "manual"]),
  summary: z.string().min(1).max(2000),
  title: z.string().min(1).max(200)
});

export const AgentDecisionSchema = z.object({
  category: z.enum([
    "availability",
    "performance",
    "security",
    "cost",
    "ai_quality",
    "ci",
    "unknown"
  ]),
  confidence: z.number().min(0).max(1),
  hypotheses: z.array(z.string().min(1).max(500)).max(8),
  observedEvidence: z.array(z.string().min(1).max(1000)).min(1).max(20),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  recommendedAction: z.string().min(1).max(2000),
  remediation: z.object({
    fixPrompt: z.string().min(1).max(4000).nullable(),
    mode: z.enum(["observe", "prepare_draft_pr", "human_action"]),
    validationCommands: z.array(z.string().min(1).max(200)).max(10)
  }),
  summary: z.string().min(1).max(1000)
});

export const SentinelDecisionSchema = AgentDecisionSchema.extend({
  policy: z.object({
    blockingReasons: z.array(z.string()),
    canPrepareDraftPr: z.boolean()
  })
});

export type Incident = z.infer<typeof IncidentSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type SentinelDecision = z.infer<typeof SentinelDecisionSchema>;
