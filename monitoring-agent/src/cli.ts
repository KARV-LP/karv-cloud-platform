import { readFile, writeFile } from "node:fs/promises";
import { analyzeIncident } from "./agent.js";

async function readInput(): Promise<unknown> {
  const path = process.argv[2];
  if (path) return JSON.parse(await readFile(path, "utf8"));
  if (process.env.INCIDENT_JSON) return JSON.parse(process.env.INCIDENT_JSON);
  throw new Error("Provide an incident file or INCIDENT_JSON");
}

const decision = await analyzeIncident(await readInput());
const serialized = `${JSON.stringify(decision, null, 2)}\n`;
const outputPath = process.argv[3] || process.env.SENTINEL_OUTPUT;

if (outputPath) {
  await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
} else {
  process.stdout.write(serialized);
}
