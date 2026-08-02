import { readFile, writeFile, mkdir } from "node:fs/promises";
import { analyzeIncident } from "../src/agent.js";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required for live evals");
}

const source = await readFile(new URL("./cases.jsonl", import.meta.url), "utf8");
const cases = source
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const results = [];

for (const testCase of cases) {
  const decision = await analyzeIncident(testCase.incident);
  results.push({
    name: testCase.name,
    expected: testCase.expected_mode,
    actual: decision.remediation.mode,
    passed: decision.remediation.mode === testCase.expected_mode
  });
}

const resultsDirectory = new URL("./results/", import.meta.url);
await mkdir(resultsDirectory, { recursive: true });
await writeFile(
  new URL("./results/latest.json", import.meta.url),
  `${JSON.stringify(results, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 }
);

if (results.some((result) => !result.passed)) process.exitCode = 1;
