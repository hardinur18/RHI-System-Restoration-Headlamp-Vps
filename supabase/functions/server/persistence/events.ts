// Append-only AI event writer.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §12.

export const EVENT_SCHEMA_VERSION = "1.0.0";

export type AiEventType =
  | "conversation.started"
  | "area.resolved"
  | "calendar.resolved"
  | "booking.saved"
  | "booking.confirmed"
  | "handoff.queued"
  | "lead.qualified"
  | "quote.generated"
  | "quote.presented"
  | "quote.expired"
  | "objection.detected"
  | "objection.resolved"
  | "soft_commit.received"
  | "followup.scheduled"
  | "followup.sent"
  | "lead.lost"
  | "lead.reactivated"
  | "competitor.mentioned"
  | "discount.requested"
  | "trust.concerned"
  | "timing.concerned"
  | "agent.correction"
  | "fixture.promoted"
  | "catalog.updated"
  | "playbook.updated"
  | "prompt.published"
  | "approved_case.promoted"
  | "approved_case.revoked"
  | "system.rollback"
  | (string & {});

export interface WriteEventInput {
  tenantId: string;
  conversationId?: string | null;
  customerId?: string | null;
  type: AiEventType;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  traceId?: string | null;
  source?: string | null;
  occurredAt?: string | null;
  schemaVersion?: string | null;
}

export interface WriteEventResult {
  ok: true;
  duplicate: boolean;
  event: Record<string, unknown> | null;
}

export async function writeEvent(
  supabase: any,
  input: WriteEventInput,
): Promise<WriteEventResult> {
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (idempotencyKey) {
    const existing = await findExistingEvent(supabase, idempotencyKey);
    if (existing) {
      return { ok: true, duplicate: true, event: existing };
    }
  }

  const row = {
    occurred_at: input.occurredAt || new Date().toISOString(),
    tenant_id: input.tenantId,
    conversation_id: input.conversationId || null,
    customer_id: input.customerId || null,
    type: input.type,
    payload: input.payload || {},
    idempotency_key: idempotencyKey,
    trace_id: input.traceId || crypto.randomUUID(),
    schema_version: input.schemaVersion || EVENT_SCHEMA_VERSION,
    source: input.source || "server",
  };

  const { data, error } = await supabase
    .from("events")
    .insert(row)
    .select("*")
    .single();

  if (!error) {
    return { ok: true, duplicate: false, event: data || null };
  }

  if (idempotencyKey && isUniqueViolation(error)) {
    const existing = await findExistingEvent(supabase, idempotencyKey);
    if (existing) {
      return { ok: true, duplicate: true, event: existing };
    }
  }

  throw error;
}

export async function criticalEventIdempotencyKey(input: {
  type: AiEventType;
  conversationId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<string | null> {
  const payload = input.payload || {};
  const conversationId = input.conversationId ||
    stringValue(payload.conversation_id);

  if (input.type === "booking.saved" || input.type === "booking.confirmed") {
    return buildEventIdempotencyKey([
      input.type,
      conversationId,
      stringValue(payload.schedule_date),
      stringValue(payload.schedule_time),
      stringValue(payload.area_text) || stringValue(payload.area_id),
      stringValue(payload.vehicle_text) || stringValue(payload.vehicle_id),
    ]);
  }

  if (input.type === "followup.sent") {
    return buildEventIdempotencyKey([
      input.type,
      conversationId,
      stringValue(payload.plan_id),
      stringValue(payload.next_send_at),
    ]);
  }

  if (input.type === "quote.generated") {
    return buildEventIdempotencyKey([
      input.type,
      conversationId,
      stringValue(payload.service_id),
      stringValue(payload.vehicle_id),
      stringValue(payload.area_id),
    ]);
  }

  if (input.type === "quote.expired") {
    return buildEventIdempotencyKey([
      input.type,
      conversationId,
      stringValue(payload.quote_id) ||
      stringValue(payload.quote_event_id) ||
      stringValue(payload.original_quote_trace_id),
      stringValue(payload.expires_at),
    ]);
  }

  if (input.type === "approved_case.promoted") {
    return buildEventIdempotencyKey([
      input.type,
      stringValue(payload.snippet_content_hash),
      stringValue(payload.approved_by),
    ]);
  }

  return null;
}

export async function buildEventIdempotencyKey(
  parts: Array<unknown> | Record<string, unknown>,
): Promise<string> {
  const raw = Array.isArray(parts)
    ? parts.map((part) => normalizeKeyPart(part)).join("|")
    : stableStringify(parts);
  return await sha256Hex(raw);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${
    Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(object[key])}`
    ).join(",")
  }}`;
}

async function findExistingEvent(
  supabase: any,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function normalizeKeyPart(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return stableStringify(value);
  return String(value).trim().toLowerCase();
}

function stringValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
    ? ""
    : String(value).trim();
}

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err?.code === "23505" || /duplicate key/i.test(err?.message || "");
}
