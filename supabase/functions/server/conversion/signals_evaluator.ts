// Backend-owned signal evaluator.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §7.5, §9.4, §10.3, §30 task 18.

import {
  buildEventIdempotencyKey,
  type AiEventType,
  type WriteEventInput,
} from "../persistence/events.ts";
import type { SalesStage } from "./lead_completeness.ts";

export type CustomerSignal =
  | "customer_confirmed_slot"
  | "customer_asked_to_hold_slot"
  | "customer_asked_what_to_prepare"
  | "customer_agreed_time_window"
  | "customer_declined"
  | "customer_wants_human"
  | "customer_asked_price_again"
  | "customer_mentioned_competitor"
  | "customer_mentioned_discount"
  | "customer_expressed_distrust";

export interface EvaluateSignalsInput {
  tenant_id: string;
  conversation_id: string;
  customer_id?: string | null;
  signals?: CustomerSignal[] | null;
  lead_qualified?: boolean | null;
  ready_for_quote?: boolean | null;
  sales_stage?: SalesStage | string | null;
  occurred_at?: string | null;
  trace_id?: string | null;
  payload_context?: Record<string, unknown> | null;
}

export interface SignalDroppedRecord {
  signal: CustomerSignal;
  reason: "lead_not_qualified" | "unknown_signal";
}

export interface EvaluateSignalsOutput {
  events: WriteEventInput[];
  dropped: SignalDroppedRecord[];
  emitted_event_types: AiEventType[];
}

const SOFT_COMMIT_SIGNALS = new Set<CustomerSignal>([
  "customer_confirmed_slot",
  "customer_asked_to_hold_slot",
  "customer_asked_what_to_prepare",
  "customer_agreed_time_window",
]);

const DIRECT_SIGNAL_EVENTS: Partial<Record<CustomerSignal, AiEventType>> = {
  customer_declined: "lead.lost",
  customer_wants_human: "handoff.queued",
  customer_asked_price_again: "objection.detected",
  customer_mentioned_competitor: "competitor.mentioned",
  customer_mentioned_discount: "discount.requested",
  customer_expressed_distrust: "trust.concerned",
};

export async function evaluateSignals(
  input: EvaluateSignalsInput,
): Promise<EvaluateSignalsOutput> {
  const signals = Array.from(new Set(input.signals || []));
  const leadQualified = Boolean(input.lead_qualified || input.ready_for_quote) ||
    ["qualified", "quote_shown", "soft_commit", "booking_pending_confirm"].includes(
      String(input.sales_stage || ""),
    );
  const events: WriteEventInput[] = [];
  const dropped: SignalDroppedRecord[] = [];
  const context = input.payload_context || {};

  const softCommitSignals = signals.filter((signal) =>
    SOFT_COMMIT_SIGNALS.has(signal)
  );
  if (softCommitSignals.length > 0) {
    if (leadQualified) {
      events.push(await buildSignalEvent(input, "soft_commit.received", {
        signals: softCommitSignals,
        stage_before: input.sales_stage || null,
        ...context,
      }));
    } else {
      for (const signal of softCommitSignals) {
        dropped.push({ signal, reason: "lead_not_qualified" });
      }
    }
  }

  for (const signal of signals) {
    if (SOFT_COMMIT_SIGNALS.has(signal)) continue;
    const type = DIRECT_SIGNAL_EVENTS[signal];
    if (!type) {
      dropped.push({ signal, reason: "unknown_signal" });
      continue;
    }
    events.push(await buildSignalEvent(input, type, payloadForSignal(signal, context)));
  }

  return {
    events,
    dropped,
    emitted_event_types: events.map((event) => event.type),
  };
}

async function buildSignalEvent(
  input: EvaluateSignalsInput,
  type: AiEventType,
  payload: Record<string, unknown>,
): Promise<WriteEventInput> {
  return {
    tenantId: input.tenant_id,
    conversationId: input.conversation_id,
    customerId: input.customer_id || null,
    type,
    occurredAt: input.occurred_at || new Date().toISOString(),
    traceId: input.trace_id || null,
    source: "signals-evaluator",
    idempotencyKey: await buildEventIdempotencyKey([
      type,
      input.conversation_id,
      stableSignalPayload(payload),
    ]),
    payload,
  };
}

function payloadForSignal(
  signal: CustomerSignal,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (signal === "customer_declined") {
    return {
      reason: "customer_declined",
      stage: "lost_unresponsive",
      source_signal: signal,
      ...context,
    };
  }
  if (signal === "customer_wants_human") {
    return {
      reason: "customer_requested_human",
      queue: "cs-operasional-polesheadlamp",
      source_signal: signal,
      ...context,
    };
  }
  if (signal === "customer_asked_price_again") {
    return {
      objection_id: "price_expensive",
      severity: "low",
      source_signal: signal,
      ...context,
    };
  }
  if (signal === "customer_mentioned_competitor") {
    return { source_signal: signal, event_label: "competitor.mentioned", ...context };
  }
  if (signal === "customer_mentioned_discount") {
    return { source_signal: signal, event_label: "discount.requested", ...context };
  }
  if (signal === "customer_expressed_distrust") {
    return { source_signal: signal, event_label: "trust.concerned", ...context };
  }
  return { source_signal: signal, ...context };
}

function stableSignalPayload(payload: Record<string, unknown>): string {
  const copy = { ...payload };
  delete copy.raw_text;
  delete copy.message_text;
  return JSON.stringify(copy, Object.keys(copy).sort());
}
