import { readFile } from "node:fs/promises";
import { Agent, Runner } from "@openai/agents";
import {
  AgentDecisionSchema,
  IncidentSchema,
  type Incident,
  type SentinelDecision
} from "./contracts.js";
import { enforceRemediationPolicy } from "./policy.js";

async function loadInstructions(): Promise<string> {
  return readFile(new URL("../docs/prompt.md", import.meta.url), "utf8");
}

export async function analyzeIncident(input: unknown): Promise<SentinelDecision> {
  const incident: Incident = IncidentSchema.parse(input);
  const agent = new Agent({
    name: "KARV Sentinel",
    instructions: await loadInstructions(),
    model: process.env.MONITOR_AGENT_MODEL || "gpt-5.6-terra",
    outputType: AgentDecisionSchema
  });

  const runner = new Runner({
    traceIncludeSensitiveData: false,
    workflowName: "KARV Sentinel triage"
  });
  const result = await runner.run(agent, JSON.stringify(incident), {
    maxTurns: 4
  });
  if (!result.finalOutput) throw new Error("KARV Sentinel returned no decision");
  return enforceRemediationPolicy(incident, result.finalOutput);
}
