export interface TraceContext {
  traceId: string;
  service: string;
  method?: string | null;
  path?: string | null;
  conversationId?: string | null;
  requestId?: string | null;
  startedAt: number;
}

export interface TraceContextInput {
  service: string;
  method?: string | null;
  path?: string | null;
  headers?: Record<string, string | null | undefined> | null;
  body?: Record<string, unknown> | null;
}

export type SpanStatus = "ok" | "error" | "unauthorized" | "invalid";

export function createTraceContext(input: TraceContextInput): TraceContext {
  const headers = normalizeHeaders(input.headers || {});
  const body = input.body || {};
  const requestId = pickTraceText(
    valueAt(body, "request_id"),
    valueAt(body, "requestId"),
    headers["x-request-id"],
    headers["cf-ray"],
  );
  const traceId = pickTraceText(
    valueAt(body, "trace_id"),
    valueAt(body, "traceId"),
    valueAt(body, "trace.id"),
    headers["x-trace-id"],
    headers["traceparent"],
    requestId,
  ) || crypto.randomUUID();

  return {
    traceId,
    service: input.service,
    method: input.method || null,
    path: input.path || null,
    conversationId: extractConversationId(body),
    requestId: requestId || null,
    startedAt: nowMs(),
  };
}

export function childTraceContext(
  context: TraceContext,
  body: Record<string, unknown> | null | undefined,
): TraceContext {
  const fromBody = createTraceContext({
    service: context.service,
    method: context.method,
    path: context.path,
    headers: {
      "x-trace-id": context.traceId,
      "x-request-id": context.requestId || "",
    },
    body: body || {},
  });

  return {
    ...context,
    traceId: fromBody.traceId || context.traceId,
    conversationId: fromBody.conversationId || context.conversationId || null,
    requestId: fromBody.requestId || context.requestId || null,
  };
}

export function logSpan(
  context: TraceContext,
  span: string,
  status: SpanStatus,
  attrs: Record<string, unknown> = {},
) {
  const entry = stripUndefined({
    ts: new Date().toISOString(),
    level: status === "error" ? "error" : "info",
    event: "ai.span",
    service: context.service,
    trace_id: context.traceId,
    request_id: context.requestId || undefined,
    conversation_id: context.conversationId || undefined,
    method: context.method || undefined,
    path: context.path || undefined,
    span,
    status,
    duration_ms: Math.max(0, Math.round(nowMs() - context.startedAt)),
    ...(sanitizeTelemetry(attrs) as Record<string, unknown>),
  });

  console.log(JSON.stringify(entry));
}

export function logError(
  context: TraceContext,
  span: string,
  error: unknown,
  attrs: Record<string, unknown> = {},
) {
  logSpan(context, span, "error", {
    ...attrs,
    error_message: error instanceof Error ? error.message : String(error),
    error_name: error instanceof Error ? error.name : undefined,
  });
}

export function hashForTelemetry(value: unknown): string {
  const input = stableStringify(sanitizeTelemetry(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function headersFromRequest(c: any): Record<string, string | null | undefined> {
  return {
    "x-trace-id": c?.req?.header?.("x-trace-id") || c?.req?.header?.("X-Trace-Id"),
    "x-request-id": c?.req?.header?.("x-request-id") || c?.req?.header?.("X-Request-Id"),
    "traceparent": c?.req?.header?.("traceparent"),
    "cf-ray": c?.req?.header?.("cf-ray"),
  };
}

function extractConversationId(body: Record<string, unknown>): string | null {
  return pickTraceText(
    valueAt(body, "conversation_id"),
    valueAt(body, "conversationId"),
    valueAt(body, "conversation.id"),
    valueAt(body, "conversation.conversation_id"),
    valueAt(body, "booking.conversation_id"),
    valueAt(body, "conversationId"),
  ) || null;
}

function valueAt(value: unknown, path: string): unknown {
  return path.split(".").reduce((cursor: unknown, part) => {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    return (cursor as Record<string, unknown>)[part];
  }, value);
}

function normalizeHeaders(headers: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value || ""]),
  );
}

function pickTraceText(...values: unknown[]): string {
  for (const value of values) {
    const text = sanitizeTraceText(value);
    if (text) return text;
  }
  return "";
}

function sanitizeTraceText(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const traceparentMatch = raw.match(/^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i);
  const candidate = traceparentMatch?.[1] || raw;
  return candidate.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 120);
}

function sanitizeTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth_limit]";
  if (value == null) return value;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeTelemetry(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeTelemetry(child, depth + 1);
  }
  return output;
}

function isSecretKey(key: string): boolean {
  return /(authorization|password|secret|token|apikey|api_key|service_role|access_token)/i.test(key);
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function nowMs() {
  return performance.now();
}
