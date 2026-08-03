import type { AiRequest, AiTask, Env } from "./types";

const MAX_BODY_BYTES = 16_384;
const MAX_INPUT_CHARS = 8_000;
const TASKS = new Set<AiTask>([
  "catalog_summary",
  "order_summary",
  "seo_draft"
]);

interface ProjectPolicy {
  maxInputChars: number;
  tasks: Set<AiTask>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function securityHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

export function requireAllowedBrowserOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (!allowedOrigins(env).has(origin)) {
    throw new HttpError(403, "Browser origin is not allowed");
  }
}

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return {};

  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-KARV-Project",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin"
  };
}

export function resolveKarvProject(request: Request, env: Env): string {
  const project =
    request.headers.get("X-KARV-Project")?.trim() || env.KARV_DEFAULT_PROJECT;
  const allowed = new Set(
    env.KARV_PROJECTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (!project || !allowed.has(project)) {
    throw new HttpError(400, "Unknown KARV project");
  }

  return project;
}

export async function requireInternalAuth(
  request: Request,
  env: Env
): Promise<void> {
  const expectedTokens = [
    env.KARV_INTERNAL_API_TOKEN,
    env.KARV_INTERNAL_API_TOKEN_NEXT
  ].filter((value): value is string => Boolean(value));

  if (expectedTokens.length === 0) {
    throw new HttpError(503, "Internal authentication is not configured");
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  const matches = await Promise.all(
    expectedTokens.map((expected) => constantTimeEqual(provided, expected))
  );
  if (!matches.some(Boolean)) throw new HttpError(401, "Unauthorized");
}

export async function parseAiRequest(request: Request): Promise<AiRequest> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const declaredSize = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }

  if (!isRecord(value)) throw new HttpError(400, "Invalid request body");
  if (value.provider !== "openai" && value.provider !== "anthropic") {
    throw new HttpError(400, "Unsupported provider");
  }
  if (typeof value.task !== "string" || !TASKS.has(value.task as AiTask)) {
    throw new HttpError(400, "Unsupported task");
  }
  if (typeof value.input !== "string") {
    throw new HttpError(400, "Input must be text");
  }

  const input = value.input.trim();
  if (!input || input.length > MAX_INPUT_CHARS) {
    throw new HttpError(400, "Input must contain between 1 and 8000 characters");
  }

  return {
    provider: value.provider,
    task: value.task as AiTask,
    input
  };
}

export function requireProjectPolicy(
  project: string,
  aiRequest: AiRequest,
  env: Env
): void {
  const policy = projectPolicies(env).get(project);
  if (!policy) throw new HttpError(503, "Project security policy is not configured");
  if (!policy.tasks.has(aiRequest.task)) {
    throw new HttpError(400, "Task is not allowed for KARV project");
  }
  if (aiRequest.input.length > policy.maxInputChars) {
    throw new HttpError(
      400,
      `Input exceeds the ${policy.maxInputChars}-character project limit`
    );
  }
}

export async function requireAiRateLimit(
  env: Env,
  project: string,
  task: AiTask
): Promise<void> {
  if (!env.AI_RATE_LIMITER) {
    throw new HttpError(503, "AI rate limiting is not configured");
  }

  let result: { success: boolean };
  try {
    result = await env.AI_RATE_LIMITER.limit({ key: `${project}:${task}` });
  } catch {
    throw new HttpError(503, "AI rate limiting is unavailable");
  }

  if (!result.success) throw new HttpError(429, "AI rate limit exceeded");
}

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function projectPolicies(env: Env): Map<string, ProjectPolicy> {
  const serialized = env.KARV_PROJECT_POLICIES;
  if (!serialized) {
    throw new HttpError(503, "Project security policy is not configured");
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new HttpError(503, "Project security policy is invalid");
  }

  if (!isRecord(value)) {
    throw new HttpError(503, "Project security policy is invalid");
  }

  const policies = new Map<string, ProjectPolicy>();
  for (const [project, rawPolicy] of Object.entries(value)) {
    if (!isRecord(rawPolicy)) {
      throw new HttpError(503, "Project security policy is invalid");
    }

    const maxInputChars = rawPolicy.maxInputChars;
    const tasks = rawPolicy.tasks;
    if (
      !Number.isInteger(maxInputChars) ||
      Number(maxInputChars) < 1 ||
      Number(maxInputChars) > MAX_INPUT_CHARS ||
      !Array.isArray(tasks) ||
      tasks.length === 0 ||
      tasks.some(
        (task) => typeof task !== "string" || !TASKS.has(task as AiTask)
      )
    ) {
      throw new HttpError(503, "Project security policy is invalid");
    }

    policies.set(project, {
      maxInputChars: Number(maxInputChars),
      tasks: new Set(tasks as AiTask[])
    });
  }

  return policies;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);

  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0 && left.length === right.length;
}
