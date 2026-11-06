import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCalendarInput } from "./domain/calendar.ts";
import { resolveAreaAlias } from "./domain/area_resolver.ts";
import { getPriceEstimate } from "./domain/pricing.ts";
import { assessLeadCompleteness } from "./conversion/lead_completeness.ts";
import { classifyObjection } from "./conversion/objection_classifier.ts";
import { recommendNextBestClose } from "./conversion/next_best_close.ts";
import { scheduleFollowupPlan } from "./conversion/followup_scheduler.ts";
import { retrieveApprovedSimilarCases } from "./conversion/similar_case_retrieval.ts";
import {
  childTraceContext,
  createTraceContext,
  hashForTelemetry,
  headersFromRequest,
  logError,
  logSpan,
  type TraceContext,
} from "./observability.ts";
import {
  buildEventIdempotencyKey,
  type AiEventType,
  writeEvent,
} from "./persistence/events.ts";
import * as kv from "./kv_store.tsx";

const route = new Hono();
const SCHEMA_VERSION = "2.0.0";
const LEARNING_PROMOTION_EVENT_TYPES = [
  "catalog.updated",
  "playbook.updated",
  "fixture.promoted",
  "approved_case.promoted",
] as const;
const LEARNING_REVIEW_EVENT_TYPES = [
  ...LEARNING_PROMOTION_EVENT_TYPES,
  "learning.candidate.rejected",
] as const;

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
const sharedSecret = Deno.env.get("CEKAT_SYNC_SHARED_SECRET")?.trim() || "";
const aiToolsApiKey = Deno.env.get("CEKAT_AI_TOOLS_API_KEY")?.trim() || "";
const availabilityApiKey = Deno.env.get("CEKAT_AVAILABILITY_API_KEY")?.trim() || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
const cekatAccessToken = Deno.env.get("CEKAT_ACCESS_TOKEN")?.trim() || "";
const cekatDefaultSentBy =
  Deno.env.get("CEKAT_PROOF_ASSET_SENT_BY")?.trim() ||
  Deno.env.get("DEFAULT_CEKAT_SENT_BY")?.trim() ||
  Deno.env.get("CEKAT_AI_AGENT_ID")?.trim() ||
  "80894180-c666-4b8d-bae0-294393cf9ed3";
const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
const authSupabase = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey);

const proofVehicleFallbackById = new Map<string, { id: string; name: string; category: string }>([
  ["1d1fb652-5a89-4c9a-977e-ce0d5b0b1a25", { id: "1d1fb652-5a89-4c9a-977e-ce0d5b0b1a25", name: "Honda - CR-V", category: "medium" }],
  ["337b5c5f-8e73-4964-821a-983d635e9f7d", { id: "337b5c5f-8e73-4964-821a-983d635e9f7d", name: "Toyota - Vios", category: "small" }],
  ["33ae1768-9699-4f67-b135-d72410edd74f", { id: "33ae1768-9699-4f67-b135-d72410edd74f", name: "Mercedes-Benz - C-Class", category: "medium" }],
  ["3c0a33b8-d200-4048-a2eb-1e12be63c3e2", { id: "3c0a33b8-d200-4048-a2eb-1e12be63c3e2", name: "Honda - HR-V", category: "medium" }],
  ["517247bf-e940-44fa-bd01-1533622d9c00", { id: "517247bf-e940-44fa-bd01-1533622d9c00", name: "Toyota - Innova Lama", category: "medium" }],
  ["619d8876-0525-4fbe-9ee6-7567ef2f218c", { id: "619d8876-0525-4fbe-9ee6-7567ef2f218c", name: "Daihatsu - Xenia", category: "medium" }],
  ["67789258-423f-45bc-bcd4-f341b4ca492b", { id: "67789258-423f-45bc-bcd4-f341b4ca492b", name: "Toyota - Yaris", category: "small" }],
  ["6d1d22e2-decf-48cd-b9a5-dadc33de35a4", { id: "6d1d22e2-decf-48cd-b9a5-dadc33de35a4", name: "Mazda - CX-5", category: "medium" }],
  ["7388abc6-ed1b-489d-81d5-e42fb697a76e", { id: "7388abc6-ed1b-489d-81d5-e42fb697a76e", name: "Toyota - Avanza", category: "medium" }],
  ["ae035882-58a7-4d81-9933-e4197a8d2b6d", { id: "ae035882-58a7-4d81-9933-e4197a8d2b6d", name: "Suzuki - Ertiga", category: "medium" }],
  ["b608b43b-2354-4b7c-b512-014d15b86b7d", { id: "b608b43b-2354-4b7c-b512-014d15b86b7d", name: "Honda - City", category: "medium" }],
  ["ca0416ee-ea34-4fca-a509-59c2952c46d7", { id: "ca0416ee-ea34-4fca-a509-59c2952c46d7", name: "Toyota - Rush", category: "medium" }],
  ["cb8c06f7-1aec-4c8c-8c4e-27907fba99fa", { id: "cb8c06f7-1aec-4c8c-8c4e-27907fba99fa", name: "Honda - Mobilio", category: "small" }],
  ["f876cf09-2edf-4e71-a5bb-194c64771010", { id: "f876cf09-2edf-4e71-a5bb-194c64771010", name: "Nissan - X-Trail", category: "medium" }],
  ["f9ecc366-b3f7-4eff-95d0-607ccbe98330", { id: "f9ecc366-b3f7-4eff-95d0-607ccbe98330", name: "Honda - Jazz", category: "small" }],
]);

type CekatMessage = {
  id: string;
  conversation_id: string;
  message: string;
  media_type: string;
  media_url: string;
  status: string;
  sent_by: string;
  sent_by_name: string;
  sent_by_type: string;
  receiver: string;
  created_at: string;
  additional_data: unknown;
};

route.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "Token", "x-client-token", "X-Client-Token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

route.get("/health", (c) =>
  c.json({
    ok: true,
    service: "cekat-ai-tools",
    schema_version: SCHEMA_VERSION,
  })
);

route.post("/cekat-message-debug", async (c) =>
  guarded(c, "cekat-message-debug", async (body) => {
    const conversationId = text(body.conversation_id || body.conversationId);
    if (!conversationId) return { error: "conversation_id_required" };
    const source = text(body.source) || "mongo";
    const url = new URL("https://server.cekat.ai/messages/mongo");
    if (source === "legacy") {
      url.pathname = "/messages";
      url.searchParams.set("conversation_id", conversationId);
    } else {
      url.searchParams.set("conversation_id", conversationId);
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", text(body.limit) || "20");
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        access_token: cekatAccessToken,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    const payload = await response.json().catch(() => null);
    return {
      status: response.status,
      ok: response.ok,
      data: Array.isArray((payload as any)?.data)
        ? (payload as any).data.map((message: any) => ({
          id: text(message.id),
          real_id: text(message.real_id),
          platform_mid: text(message.platform_mid || message.platform_id),
          conversation_id: text(message.conversation_id),
          message: text(message.message),
          media_type: text(message.media_type),
          media_url: text(message.media_url),
          status: text(message.status),
          sent_by: text(message.sent_by),
          sent_by_name: text(message.sent_by_name),
          sent_by_type: text(message.sent_by_type),
          receiver: text(message.receiver),
          created_at: text(message.created_at),
          additional_data: message.additional_data || null,
        }))
        : payload,
    };
  })
);

route.post("/proof-asset-guard", async (c) =>
  guarded(c, "proof-asset-guard", async (body) => {
    const conversationId = payloadText(body, ["conversation_id", "conversationId", "id"]);
    if (!conversationId) {
      return {
        ok: false,
        reason: "conversation_id_required",
      };
    }
    return await guardProofAssetForConversation(conversationId, body);
  })
);

route.post("/proof-asset-guard-recent", async (c) =>
  guarded(c, "proof-asset-guard-recent", async (body) => {
    const maxConversations = Math.max(1, Math.min(50, Number(body.max_conversations || body.limit || 20)));
    const conversations = await fetchCekatRecentConversations(maxConversations);
    const results = [];
    for (const conversation of conversations.slice(0, maxConversations)) {
      if (normalizeCekatInboxType(conversation.inbox_type) !== "instagram") continue;
      results.push(await guardProofAssetForConversation(conversation.id, {
        ...body,
        contact_id: conversation.contact_id,
        sent_by: conversation.ai_agent_id || conversation.handled_by,
      }));
    }
    return {
      ok: true,
      scanned: conversations.length,
      instagram_scanned: results.length,
      sent: results.filter((result) => result.action === "sent_proof_image").length,
      results,
    };
  })
);

async function guardProofAssetForConversation(conversationId: string, body: Record<string, unknown>) {
  const conversation = await resolveCekatConversationMeta(conversationId);
  const channel = normalizeCekatInboxType(conversation.inboxType);
  if (channel !== "instagram") {
    return {
      ok: true,
      action: "skipped",
      reason: channel ? `instagram_only:${channel}` : "missing_inbox_type",
      conversation_id: conversationId,
    };
  }

  const messages = await fetchCekatConversationMessages(conversationId, Number(body.limit || 30));
  const chronological = [...messages].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const latestUserMessage = [...chronological].reverse().find((message) => message.sent_by_type === "user");
  if (!latestUserMessage) {
    return {
      ok: true,
      action: "skipped",
      reason: "no_user_message",
      conversation_id: conversationId,
    };
  }

  const latestUserAt = Date.parse(latestUserMessage.created_at);
  const maxAgeMinutes = Number(body.max_age_minutes || 30);
  if (Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 && Date.now() - latestUserAt > maxAgeMinutes * 60_000) {
    return {
      ok: true,
      action: "skipped",
      reason: "latest_user_message_too_old",
      conversation_id: conversationId,
      latest_user_created_at: latestUserMessage.created_at,
    };
  }

  const asksProof = isProofAssetRequest(latestUserMessage.message);
  const vehicleText = inferVehicleText(latestUserMessage.message) ||
    (asksProof ? inferRecentVehicleText(chronological, latestUserMessage.created_at) : "");
  if (!vehicleText) {
    return {
      ok: true,
      action: "skipped",
      reason: asksProof ? "proof_request_without_vehicle_context" : "latest_user_message_not_vehicle",
      conversation_id: conversationId,
      latest_user_message: latestUserMessage.message,
    };
  }

  const hasProofAfterVehicle = chronological.some((message) => {
    const createdAt = Date.parse(message.created_at);
    if (!Number.isFinite(createdAt) || createdAt <= latestUserAt) return false;
    if (message.sent_by_type === "user") return false;
    return message.media_type === "image" && Boolean(message.media_url);
  });
  if (hasProofAfterVehicle && !booleanish(body.force)) {
    return {
      ok: true,
      action: "skipped",
      reason: "proof_image_already_sent_after_vehicle",
      conversation_id: conversationId,
      vehicle_text: vehicleText,
    };
  }

  const proofAsset = await selectRelevantProofAsset({
    vehicle_text: vehicleText,
    condition_text: inferConditionText(latestUserMessage.message) || inferRecentConditionText(chronological, latestUserMessage.created_at) || null,
    max_results: Number(body.max_results || 1),
    conversation_id: conversationId,
    contact_id: conversation.contactId || payloadText(body, ["contact_id", "contactId"]),
    sent_by: conversation.sentBy || payloadText(body, ["sent_by", "sentBy"]),
  });

  return {
    ok: true,
    action: proofAsset.media_auto_send?.sent ? "sent_proof_image" : "proof_selected_not_sent",
    conversation_id: conversationId,
    vehicle_text: vehicleText,
    proof_asset: proofAsset,
  };
}

async function fetchCekatRecentConversations(limit = 20) {
  const filters = ["assigned", "unassigned"];
  const byId = new Map<string, {
    id: string;
    contact_id: string;
    handled_by: string;
    ai_agent_id: string;
    inbox_type: string;
    message_last_created_at: string;
  }>();
  for (const statusFilter of filters) {
    const url = new URL("https://server.cekat.ai/conversations");
    for (const [key, value] of Object.entries({
      stage_status: "",
      pipeline_status_id: "",
      handled_by: "",
      label_name: "",
      inbox_id: "",
      ai_agent_id: "",
      status_filter: statusFilter,
      resolved_by: "",
      multiple_label: "[]",
      unread_filter: "",
      start_date: "",
      end_date: "",
      handled_by_list: "",
      inbox_id_list: "",
      page: "1",
      pagesize: String(Math.max(1, Math.min(100, limit))),
    })) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        access_token: cekatAccessToken,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) continue;
    const body = await response.json().catch(() => null);
    const rows = Array.isArray((body as any)?.data?.conversations)
      ? (body as any).data.conversations
      : Array.isArray((body as any)?.data)
      ? (body as any).data
      : [];
    for (const row of rows) {
      const id = text(row.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        contact_id: text(row.contact_id),
        handled_by: text(row.handled_by),
        ai_agent_id: text(row.ai_agent_id),
        inbox_type: text(row.inbox_type),
        message_last_created_at: text(row.message_last_created_at),
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    Date.parse(b.message_last_created_at) - Date.parse(a.message_last_created_at)
  );
}

route.post("/sales-flow-state", async (c) =>
  guarded(c, "sales-flow-state", async (body) => {
    const data = await resolveSalesFlowState({
      latest_customer_message: nullableText(body.latest_customer_message || body.last_customer_message || body.raw_text || body.text || body.message),
      vehicle_text: nullableText(body.vehicle_text || body.vehicleText || body.vehicle || body.car_model),
      condition_text: nullableText(body.condition_text || body.conditionText || body.condition || body.condition_summary),
      area_text: nullableText(body.area_text || body.areaText || body.area || body.location_text || body.location),
      proof_asset_sent: booleanish(body.proof_asset_sent || body.proofAssetSent || body.media_auto_send_sent),
      education_sent: booleanish(body.education_sent || body.educationSent),
      price_shown: booleanish(body.price_shown || body.priceShown),
      schedule_text: nullableText(body.schedule_text || body.scheduleText || body.schedule_date || body.scheduleDate),
      customer_name: nullableText(body.customer_name || body.customerName),
      contact_phone: nullableText(body.contact_phone || body.contactPhone || body.phone),
      address_text: nullableText(body.address_text || body.addressText || body.address),
      conversation_id: payloadText(body, ["conversation_id", "conversationId"]),
      contact_id: payloadText(body, ["contact_id", "contactId", "receiver"]),
      sent_by: payloadText(body, ["sent_by", "sentBy", "handled_by", "handledBy"]),
    });
    return toolResult({
      data,
      next_action: data.next_action,
      suggested_customer_text: data.suggested_customer_text,
      sales_stage_hint: data.sales_stage_hint,
    });
  })
);

route.post("/calendar-resolve", async (c) =>
  guarded(c, "calendar-resolve", async (body) => {
    const data = resolveCalendarInput({
      raw_text: text(body.raw_text || body.text || body.message),
      reference_datetime: text(body.reference_datetime) || new Date().toISOString(),
      timezone: text(body.timezone) || "Asia/Jakarta",
    });
    return toolResult({
      data,
      next_action: data.need_clarification ? "clarify_calendar" : "calendar_resolved",
      suggested_customer_text: data.clarification_question,
      sales_stage_hint: null,
    });
  })
);

route.post("/area-resolve", async (c) =>
  guarded(c, "area-resolve", async (body) => {
    const data = resolveAreaAlias(text(body.area_text || body.raw_area || body.text));
    return toolResult({
      data,
      next_action: data.status === "needs_clarification"
        ? "collect_field:area"
        : data.status === "out_of_coverage"
        ? "handoff_or_alternate_area"
        : "area_resolved",
      suggested_customer_text: data.suggested_customer_text,
      sales_stage_hint: null,
    });
  })
);

route.post("/price-estimate", async (c) =>
  guarded(c, "price-estimate", async (body) => {
    const rawAreaText = nullableText(body.area_text || body.areaText || body.area || body.location_text || body.location);
    const resolvedArea = (!body.area_id || !body.area_tier || !body.coverage_status) && rawAreaText
      ? resolveAreaAlias(rawAreaText)
      : null;
    const data = getPriceEstimate({
      vehicle_class_id: nullableText(body.vehicle_class_id) as any,
      vehicle_text: nullableText(body.vehicle_text || body.vehicleText || body.vehicle_name || body.vehicleName),
      area_id: nullableText(body.area_id) || resolvedArea?.area_id || null,
      area_tier: (nullableText(body.area_tier) || resolvedArea?.tier || null) as any,
      coverage_status: (nullableText(body.coverage_status) || resolvedArea?.status || null) as any,
      condition_confidence: nullableText(body.condition_confidence) as any,
      condition_text: nullableText(body.condition_text || body.conditionText || body.condition || body.condition_summary),
      photo_received: booleanish(body.photo_received || body.photoReceived || body.photo_verified || body.photoVerified),
      service_id: nullableText(body.service_id) as any,
      quote_requested: booleanish(body.quote_requested || body.quoteRequested),
      customer_asked_price: booleanish(body.customer_asked_price || body.customerAskedPrice),
      customer_intent: nullableText(body.customer_intent || body.customerIntent || body.intent),
      raw_text: nullableText(body.raw_text || body.text || body.message),
      last_customer_message: nullableText(body.last_customer_message || body.lastCustomerMessage),
    });
    return toolResult({
      data,
      next_action: data.next_action,
      suggested_customer_text: data.customer_facing_text,
      sales_stage_hint: data.disclosure_allowed ? "quote_shown" : "lead_partial",
    });
  })
);

route.post("/lead-completeness", async (c) =>
  guarded(c, "lead-completeness", async (body) => {
    const data = assessLeadCompleteness({
      ...body,
      condition_text: nullableText(body.condition_text || body.conditionText || body.condition || body.condition_summary),
      photo_received: booleanish(body.photo_received || body.photoReceived || body.photo_verified || body.photoVerified),
      raw_text: nullableText(body.raw_text || body.text || body.message),
      last_customer_message: nullableText(body.last_customer_message || body.lastCustomerMessage),
    });
    return toolResult({
      data,
      next_action: data.ready_for_booking
        ? "booking_ready_for_capture"
        : data.ready_for_quote
        ? "quote_ready"
        : data.next_missing_field
        ? `collect_field:${data.next_missing_field}`
        : "continue_qualification",
      suggested_customer_text: data.suggested_customer_text,
      sales_stage_hint: data.sales_stage,
    });
  })
);

route.post("/classify-objection", async (c) =>
  guarded(c, "classify-objection", async (body) => {
    const data = classifyObjection({
      text: text(body.text || body.message),
      signals: Array.isArray(body.signals) ? body.signals.map(text).filter(Boolean) : [],
      customer_repeat_count: Number(body.customer_repeat_count || 0),
    });
    return toolResult({
      data,
      next_action: data.human_required
        ? "handoff_required"
        : data.objection_id
        ? `handle_objection:${data.objection_id}`
        : "no_objection_detected",
      suggested_customer_text: null,
      sales_stage_hint: data.objection_id ? "handling_objection" : null,
    });
  })
);

route.post("/next-best-close", async (c) =>
  guarded(c, "next-best-close", async (body) => {
    const data = recommendNextBestClose({
      sales_stage: text(body.sales_stage || body.stage || "lead_partial"),
      objection_id: nullableText(body.objection_id),
      severity: nullableText(body.severity) as any,
      availability_known: typeof body.availability_known === "boolean" ? body.availability_known : null,
      slot_options: Array.isArray(body.slot_options) ? body.slot_options.map(text).filter(Boolean) : [],
      missing_fields: Array.isArray(body.missing_fields) ? body.missing_fields.map(text).filter(Boolean) : [],
      human_required: Boolean(body.human_required),
    });
    return toolResult({
      data,
      next_action: data.handoff_required
        ? "handoff_required"
        : data.must_ask[0]
        ? `ask:${data.must_ask[0]}`
        : "continue_close",
      suggested_customer_text: suggestedTextFromNextBestClose(data),
      sales_stage_hint: text(body.sales_stage || body.stage || null) || null,
    });
  })
);

route.post("/followup-plan", async (c) =>
  guarded(c, "followup-plan", async (body) => {
    const data = await scheduleFollowupPlan({
      conversation_id: text(body.conversation_id || body.conversationId),
      reason: text(body.reason || "quote_sent_no_reply"),
      anchor_at: text(body.anchor_at) || new Date().toISOString(),
      now_iso: text(body.now_iso) || new Date().toISOString(),
      timezone: text(body.timezone) || "Asia/Jakarta",
      previous_followups: Array.isArray(body.previous_followups) ? body.previous_followups : [],
      stop_events: Array.isArray(body.stop_events) ? body.stop_events : [],
      max_followups_per_lead_7d: Number(body.max_followups_per_lead_7d || 0) || null,
    });
    return toolResult({
      data,
      next_action: data.suppressed ? "followup_suppressed" : "followup_scheduled",
      suggested_customer_text: null,
      sales_stage_hint: null,
    });
  })
);

route.post("/approved-cases", async (c) =>
  guarded(c, "approved-cases", async (body) => {
    const library = Array.isArray(body.library) ? body.library : [];
    const data = retrieveApprovedSimilarCases({
      stage: text(body.stage || body.sales_stage || "quote_shown"),
      objection_id: nullableText(body.objection_id),
      vehicle_type: nullableText(body.vehicle_type),
      area_tier: nullableText(body.area_tier),
      top_k: Number(body.top_k || 2),
    }, library as any);
    return toolResult({
      data,
      next_action: data.snippets.length > 0 ? "use_approved_case" : "no_approved_case",
      suggested_customer_text: data.snippets[0]?.content || null,
      sales_stage_hint: text(body.stage || body.sales_stage || null) || null,
    });
  })
);

route.post("/proof-asset-match", async (c) =>
  guarded(c, "proof-asset-match", async (body) => {
    const data = await selectRelevantProofAsset({
      vehicle_text: nullableText(body.vehicle_text || body.vehicleText || body.vehicle || body.car_model),
      condition_text: nullableText(body.condition_text || body.conditionText || body.condition),
      max_results: Number(body.max_results || body.top_k || 1),
      conversation_id: payloadText(body, ["conversation_id", "conversationId"]),
      contact_id: payloadText(body, ["contact_id", "contactId", "receiver"]),
      sent_by: payloadText(body, ["sent_by", "sentBy", "handled_by", "handledBy"]),
    });
    return toolResult({
      data,
      next_action: data.assets.length > 0 ? "send_relevant_proof_asset" : "no_relevant_proof_asset",
      suggested_customer_text: data.suggested_customer_text,
      sales_stage_hint: "qualification",
    });
  })
);

route.post("/learning-review", async (c) =>
  guarded(c, "learning-review", async (body, trace, auth) => {
    const data = await persistLearningReview(body, trace, auth);
    return toolResult({
      data,
      next_action: data.decision === "approved"
        ? `review_persisted:${data.event_type}`
        : "review_rejected_persisted",
      suggested_customer_text: null,
      sales_stage_hint: "learning_review",
    });
  }, { requireUserSession: true })
);

async function selectRelevantProofAsset(input: {
  vehicle_text: string | null;
  condition_text: string | null;
  max_results: number;
  conversation_id?: string | null;
  contact_id?: string | null;
  sent_by?: string | null;
}) {
  const assets = (await kv.getByPrefix("proof_asset:"))
    .map(normalizeProofAssetRecord)
    .filter((asset) => asset.id && asset.title && asset.image_url && asset.is_active);
  const vehicles = (await kv.getByPrefix("vehicle_types:")).map(normalizeVehicleRecord);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const queryTokens = proofTokens([
    input.vehicle_text || "",
    input.condition_text || "",
  ].join(" "));
  const requestedClass = classifyVehicleText(input.vehicle_text || "");
  const requestedBrands = inferVehicleBrands(input.vehicle_text || "");
  const requestedYear = inferVehicleYear(input.vehicle_text || "");
  const requestedCondition = proofTokens(input.condition_text || "");
  const maxResults = Math.min(3, Math.max(1, Math.trunc(input.max_results || 1)));

  const ranked = assets
    .map((asset) => {
      const vehicle = asset.vehicle_type_id
        ? vehicleById.get(asset.vehicle_type_id) || proofVehicleFallbackById.get(asset.vehicle_type_id) || null
        : null;
      const assetVehicleText = `${asset.title} ${asset.year || ""} ${asset.caption || ""} ${asset.tags.join(" ")} ${vehicle?.name || ""} ${vehicle?.category || ""}`;
      const haystack = proofTokens([
        asset.title,
        asset.year ? String(asset.year) : "",
        asset.caption || "",
        asset.tags.join(" "),
        vehicle?.name || "",
        vehicle?.category || "",
      ].join(" "));
      const overlap = queryTokens.filter((token) => haystack.includes(token)).length;
      const tagMatch = requestedCondition.filter((token) => asset.tags.some((tag) => proofTokens(tag).includes(token))).length;
      const assetYear = inferVehicleYear(assetVehicleText);
      const yearMatch = requestedYear && assetYear && requestedYear === assetYear ? 3 : 0;
      const vehicleClass = classifyVehicleText(assetVehicleText);
      const classMatch = requestedClass && vehicleClass && requestedClass === vehicleClass ? 4 : 0;
      const brandMatch = requestedBrands.some((brand) => haystack.includes(brand)) ? 6 : 0;
      const exactVehicleMatch = input.vehicle_text
        ? fuzzyContains(assetVehicleText, input.vehicle_text) || fuzzyContains(input.vehicle_text, assetVehicleText)
        : false;
      const matchType = exactVehicleMatch
        ? "exact_vehicle"
        : brandMatch
        ? "same_brand"
        : classMatch
        ? "similar_vehicle_class"
        : "condition_or_tag";
      const score = overlap + brandMatch + classMatch + tagMatch + yearMatch + (exactVehicleMatch ? 8 : 0) + Math.min(3, asset.usage_count / 10);
      return {
        ...asset,
        vehicle_name: vehicle?.name || null,
        vehicle_category: vehicle?.category || null,
        year_match: Boolean(yearMatch),
        tag_match_count: tagMatch,
        match_type: matchType,
        relevance_score: score,
      };
    })
    .filter((asset) => asset.relevance_score > 0)
    .sort((left, right) => right.relevance_score - left.relevance_score || right.usage_count - left.usage_count)
    .slice(0, maxResults);

  const primary = ranked[0] || null;
  const vehicleLabel = proofAssetVehicleLabel(input.vehicle_text, primary);
  const mediaCaption = primary
    ? proofAssetMediaCaption(vehicleLabel, primary.match_type)
    : "";
  const mediaAutoSend = await maybeSendProofAssetMedia({
    conversationId: input.conversation_id || null,
    contactId: input.contact_id || null,
    sentBy: input.sent_by || null,
    asset: primary,
    caption: mediaCaption,
  });
  return {
    requested_vehicle_text: input.vehicle_text,
    requested_condition_text: input.condition_text,
    match_found: Boolean(primary),
    media_auto_send: mediaAutoSend,
    assets: ranked.map((asset) => ({
      id: asset.id,
      title: asset.title,
      vehicle_name: asset.vehicle_name,
      image_url: asset.image_url,
      caption: asset.caption,
      tags: asset.tags,
      year: asset.year,
      year_match: asset.year_match,
      tag_match_count: asset.tag_match_count,
      match_type: asset.match_type,
      relevance_score: asset.relevance_score,
    })),
    suggested_customer_text: primary
      ? mediaAutoSend.sent
        ? "Kalau boleh tau, kondisi headlampnya menguning seperti contoh tadi atau bagaimana kak?"
        : `Saya kirim contoh hasil ${vehicleLabel} ya kak: ${primary.image_url}\n\nKalau boleh tau, kondisi headlampnya menguning seperti ini atau bagaimana kak?`
      : "Kalau boleh tau, kondisi headlampnya menguning/kusam seperti contoh umum atau ada embun/retak juga kak?",
  };
}

async function maybeSendProofAssetMedia(input: {
  conversationId: string | null;
  contactId: string | null;
  sentBy: string | null;
  asset: ({ image_url: string; title: string } & Record<string, unknown>) | null;
  caption?: string | null;
}) {
  if (!input.asset?.image_url) {
    return { attempted: false, sent: false, reason: "no_asset" };
  }
  if (!input.conversationId) {
    return { attempted: false, sent: false, reason: "missing_conversation_id" };
  }
  if (!cekatAccessToken) {
    return { attempted: false, sent: false, reason: "missing_cekat_access_token" };
  }

  const conversation = await resolveCekatConversationMeta(input.conversationId);
  const messageTarget = await resolveCekatConversationMessageTarget(input.conversationId);
  const receiver = conversation.receiver || input.contactId || await resolveCekatConversationContactId(input.conversationId);
  const outboundReceiver = messageTarget.receiver || receiver;
  const channel = normalizeCekatInboxType(conversation.inboxType || messageTarget.inboxType);
  const endpoint = cekatMessageEndpoint(channel);
  if (!outboundReceiver) {
    return { attempted: false, sent: false, reason: "missing_receiver" };
  }
  if (channel !== "instagram") {
    return {
      attempted: false,
      sent: false,
      reason: channel ? `native_media_enabled_for_instagram_only:${channel}` : "missing_inbox_type",
      channel,
      endpoint,
    };
  }

  try {
    const imageResponse = await fetch(input.asset.image_url);
    if (!imageResponse.ok) {
      return {
        attempted: true,
        sent: false,
        reason: `proof_asset_fetch_failed:${imageResponse.status}`,
        status: imageResponse.status,
      };
    }
    const imageBlob = await imageResponse.blob();
    const imageType = imageBlob.type || "image/jpeg";
    const extension = imageType.includes("png") ? "png" : imageType.includes("webp") ? "webp" : "jpg";
    const tempId = crypto.randomUUID();
    const attempts = [];
    const caption = text(input.caption);
    const baseFields = {
      receiver: outboundReceiver,
      message: caption,
      sent_by: input.sentBy || conversation.sentBy || cekatDefaultSentBy,
      sent_by_name: conversation.sentByName || "Polesheadlamp.id",
      conversation_id: input.conversationId,
      id: tempId,
      media_type: "image",
      is_private_note: "false",
      is_snooze: "false",
      snooze_date: "",
    };
    const multipartVariants = [
      { mode: "instagram_multipart_files_blob", field: "files" },
    ];

    let response: Response | null = null;
    let body: unknown = null;
    for (const variant of multipartVariants) {
      const payload = new FormData();
      for (const [key, value] of Object.entries(baseFields)) payload.append(key, value);
      if (variant.field) {
        payload.append(variant.field, imageBlob, `proof-${Date.now()}.${extension}`);
      } else {
        payload.append("media_url", input.asset.image_url);
      }
      const variantResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          access_token: cekatAccessToken,
          "User-Agent": "Mozilla/5.0",
        },
        body: payload,
      });
      const variantBody = await variantResponse.json().catch(() => null);
      attempts.push({
        mode: variant.mode,
        status: variantResponse.status,
        ok: variantResponse.ok,
        error_detail: summarizeCekatError(variantBody),
      });
      response = variantResponse;
      body = variantBody;
      if (variantResponse.ok) break;
    }

    if (!response?.ok) {
      const jsonResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          access_token: cekatAccessToken,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          receiver: outboundReceiver,
          message: caption,
          sent_by: input.sentBy || conversation.sentBy || cekatDefaultSentBy,
          sent_by_name: conversation.sentByName || "Polesheadlamp.id",
          conversation_id: input.conversationId,
          id: crypto.randomUUID(),
          media_type: "image",
          media_url: input.asset.image_url,
          is_private_note: false,
          is_snooze: false,
          snooze_date: "",
        }),
      });
      const jsonBody = await jsonResponse.json().catch(() => null);
      attempts.push({
        mode: "json_media_url",
        status: jsonResponse.status,
        ok: jsonResponse.ok,
        error_detail: summarizeCekatError(jsonBody),
      });
      response = jsonResponse;
      body = jsonBody;
    }

    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        reason: `cekat_send_failed:${response.status}`,
        status: response.status,
        channel,
        endpoint,
        error_detail: summarizeCekatError(body),
        attempts,
      };
    }
    const row = Array.isArray((body as any)?.data) ? (body as any).data[0] : (body as any)?.data || body;
    return {
      attempted: true,
      sent: true,
      reason: "sent",
      message_id: text((row as any)?.id),
      status: text((row as any)?.status),
      channel,
      endpoint,
      attempts,
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      reason: "cekat_send_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeCekatError(body: unknown) {
  const message = text(
    (body as any)?.error?.message ||
      (body as any)?.message ||
      (body as any)?.error ||
      (body as any)?.data?.message,
  );
  return message.slice(0, 240);
}

function cekatMessageEndpoint(inboxType: string) {
  const channel = normalizeCekatInboxType(inboxType);
  const supported = new Set(["whatsapp_mobile", "livechat", "instagram", "messenger", "tokopedia", "custom_api", "email", "tiktok"]);
  return supported.has(channel) ? `https://server.cekat.ai/messages/${channel}` : "https://server.cekat.ai/messages";
}

function normalizeCekatInboxType(inboxType: string | null | undefined) {
  const raw = text(inboxType);
  return ({ tiktok_business_messaging: "tiktok" } as Record<string, string>)[raw] || raw;
}

async function resolveCekatConversationMeta(conversationId: string) {
  try {
    const response = await fetch(`https://server.cekat.ai/conversations/${encodeURIComponent(conversationId)}`, {
      method: "GET",
      headers: {
        access_token: cekatAccessToken,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) return { receiver: "", contactId: "", inboxType: "", sentBy: "", sentByName: "" };
    const body = await response.json().catch(() => null);
    const data = (body as any)?.data || body || {};
    const contactId = text((data as any).contact_id);
    const receiver = text((data as any).phone_number || (data as any).platform_id || contactId);
    return {
      receiver,
      contactId,
      inboxType: text((data as any).inbox_type),
      sentBy: text((data as any).handled_by || (data as any).ai_agent_id || (data as any).assigned_ai_agent),
      sentByName: text((data as any).handled_by_name || (data as any).assigned_ai_agent_name),
    };
  } catch {
    return { receiver: "", contactId: "", inboxType: "", sentBy: "", sentByName: "" };
  }
}

async function fetchCekatConversationMessages(conversationId: string, limit = 30) {
  try {
    const url = new URL("https://server.cekat.ai/messages/mongo");
    url.searchParams.set("conversation_id", conversationId);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", String(Math.max(1, Math.min(100, limit))));
    const response = await fetch(url, {
      method: "GET",
      headers: {
        access_token: cekatAccessToken,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) return [];
    const body = await response.json().catch(() => null);
    const rows = Array.isArray((body as any)?.data) ? (body as any).data : [];
    return rows.map((message: any) => ({
      id: text(message.id),
      conversation_id: text(message.conversation_id),
      message: text(message.message),
      media_type: text(message.media_type),
      media_url: text(message.media_url),
      status: text(message.status),
      sent_by: text(message.sent_by),
      sent_by_name: text(message.sent_by_name),
      sent_by_type: text(message.sent_by_type),
      receiver: text(message.receiver),
      created_at: text(message.created_at),
      additional_data: message.additional_data || null,
    }));
  } catch {
    return [];
  }
}

async function resolveCekatConversationMessageTarget(conversationId: string) {
  try {
    const url = new URL("https://server.cekat.ai/messages/mongo");
    url.searchParams.set("conversation_id", conversationId);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "20");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        access_token: cekatAccessToken,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) return { receiver: "", inboxType: "" };
    const body = await response.json().catch(() => null);
    const rows = Array.isArray((body as any)?.data) ? (body as any).data : [];
    for (const row of rows) {
      const tiktok = (row as any)?.additional_data?.tiktok;
      const openId = text(tiktok?.user_openid);
      if (openId) return { receiver: openId, inboxType: "tiktok" };
    }
    return { receiver: "", inboxType: "" };
  } catch {
    return { receiver: "", inboxType: "" };
  }
}

async function resolveCekatConversationContactId(conversationId: string) {
  try {
    const url = new URL("https://server.cekat.ai/messages");
    url.searchParams.set("conversation_id", conversationId);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        access_token: cekatAccessToken,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) return "";
    const body = await response.json().catch(() => null);
    const rows = Array.isArray((body as any)?.data) ? (body as any).data : Array.isArray(body) ? body : [];
    for (const row of rows) {
      const sender = text((row as any)?.sent_by);
      if (!sender || sender === "system" || sender === cekatDefaultSentBy) continue;
      if (sender === "80894180-c666-4b8d-bae0-294393cf9ed3") continue;
      return sender;
    }
  } catch {
    return "";
  }
  return "";
}

function proofAssetVehicleLabel(
  requestedVehicleText: string | null,
  asset: { match_type?: string; title?: string; vehicle_name?: string | null; vehicle_category?: string | null } | null,
) {
  const requestedLabel = cleanVehicleLabel(requestedVehicleText);
  if (!asset) return "yang mirip";
  if (requestedLabel && asset.match_type === "exact_vehicle") {
    return `untuk ${requestedLabel}`;
  }
  if (requestedLabel && asset.match_type === "same_brand") {
    return `${asset.title || "brand yang sama"} yang relevan dengan ${requestedLabel}`;
  }
  if (requestedLabel && asset.match_type === "similar_vehicle_class") {
    const category = asset.vehicle_category ? ` ${asset.vehicle_category}` : "";
    return `yang mirip/sekelas dengan ${requestedLabel}${category}`;
  }
  return requestedLabel ? `yang mirip dengan ${requestedLabel}` : "yang mirip";
}

function cleanVehicleLabel(value: string | null) {
  return text(value)
    .replace(/\b(kak|ka|gan|om|bang|min|admin)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function proofAssetMediaCaption(vehicleLabel: string, matchType?: string | null) {
  const label = matchType === "exact_vehicle" && /^untuk\s+/i.test(vehicleLabel)
    ? vehicleLabel
    : `contoh ${vehicleLabel}`;
  return `Ini ${label} ya kak 😊\n\nKalau boleh tau, kondisi headlampnya menguning/kusam seperti contoh ini atau bagaimana kak?`;
}

route.get("/learning-review-history", async (c) =>
  guarded(c, "learning-review-history", async (body) => {
    const data = await loadLearningReviewHistory(body);
    return toolResult({
      data,
      next_action: data.review_count > 0 ? "hydrate_review_statuses" : "review_history_empty",
      suggested_customer_text: null,
      sales_stage_hint: "learning_review",
    });
  }, { requireUserSession: true })
);

route.get("/approved-case-library", async (c) =>
  guarded(c, "approved-case-library", async (body) => {
    const data = await loadApprovedCaseLibrary(body);
    return toolResult({
      data,
      next_action: data.active_count > 0 ? "review_approved_cases" : "approved_case_library_empty",
      suggested_customer_text: null,
      sales_stage_hint: "learning_review",
    });
  }, { requireUserSession: true })
);

route.post("/approved-case-revoke", async (c) =>
  guarded(c, "approved-case-revoke", async (body, trace, auth) => {
    const data = await persistApprovedCaseRevoke(body, trace, auth);
    return toolResult({
      data,
      next_action: "approved_case_revoked",
      suggested_customer_text: null,
      sales_stage_hint: "learning_review",
    });
  }, { requireUserSession: true })
);

async function guarded(
  c: any,
  toolName: string,
  handler: (
    body: Record<string, unknown>,
    trace: TraceContext,
    auth: AuthContext,
  ) => Promise<ToolEnvelope> | ToolEnvelope,
  options: GuardOptions = {},
) {
  const boundaryTrace = createTraceContext({
    service: "cekat-ai-tools",
    method: c.req.method,
    path: c.req.path,
    headers: headersFromRequest(c),
  });
  const auth = await authorize(
    c.req.header("authorization"),
    c.req.header("x-client-token") || c.req.header("token"),
    options,
  );
  if (!auth.ok) {
    logSpan(boundaryTrace, "tool.call", "unauthorized", { tool_name: toolName });
    return c.json({ ok: false, schema_version: SCHEMA_VERSION, trace_id: boundaryTrace.traceId, error: auth.error }, auth.status);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const trace = childTraceContext(boundaryTrace, body && typeof body === "object" ? body : {});
  const inputHash = hashForTelemetry(body);
  try {
    const result = await handler(body && typeof body === "object" ? body : {}, trace, auth);
    const envelope = {
      ...result,
      schema_version: SCHEMA_VERSION,
      trace_id: trace.traceId,
    };
    logSpan(trace, "tool.call", "ok", {
      tool_name: toolName,
      next_action: result.next_action,
      sales_stage_hint: result.sales_stage_hint,
      input_hash: inputHash,
      output_hash: hashForTelemetry(envelope),
    });
    return c.json(envelope);
  } catch (error) {
    logError(trace, "tool.call", error, {
      tool_name: toolName,
      input_hash: inputHash,
    });
    return c.json({
      ok: false,
      schema_version: SCHEMA_VERSION,
      trace_id: trace.traceId,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

interface GuardOptions {
  requireUserSession?: boolean;
}

interface AuthContext {
  ok: true;
  actorId?: string | null;
  actorLabel?: string | null;
  actorSource: "system_key" | "user_session" | "open";
}

type AuthResult = AuthContext | {
  ok: false;
  status: 401 | 500;
  error: string;
};

async function authorize(
  authHeader?: string,
  clientToken?: string,
  options: GuardOptions = {},
): Promise<AuthResult> {
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supplied = clientToken || bearer || "";
  const strongAllowed = [
    aiToolsApiKey,
    sharedSecret,
    availabilityApiKey,
    supabaseServiceKey,
  ].filter(Boolean);

  if (options.requireUserSession) {
    if (supplied && strongAllowed.includes(supplied)) {
      return {
        ok: true,
        actorId: "system",
        actorLabel: "System",
        actorSource: "system_key",
      };
    }

    if (!clientToken) {
      return { ok: false as const, status: 401 as const, error: "User session required" };
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      return { ok: false as const, status: 500 as const, error: "Auth client is not configured" };
    }

    const { data, error } = await authSupabase.auth.getUser(clientToken);
    if (error || !data?.user) {
      return { ok: false as const, status: 401 as const, error: "Invalid user session" };
    }

    return {
      ok: true,
      actorId: data.user.id,
      actorLabel: data.user.user_metadata?.name || data.user.email || data.user.id,
      actorSource: "user_session",
    };
  }

  const allowed = [
    aiToolsApiKey,
    sharedSecret,
    availabilityApiKey,
    supabaseServiceKey,
    supabaseAnonKey,
  ].filter(Boolean);
  if (!allowed.length || allowed.includes(supplied)) {
    return {
      ok: true,
      actorId: supplied ? "system" : null,
      actorLabel: supplied ? "System" : null,
      actorSource: supplied ? "system_key" : "open",
    };
  }
  return { ok: false as const, status: 401 as const, error: "Unauthorized" };
}

async function persistLearningReview(
  body: Record<string, unknown>,
  trace: TraceContext,
  auth: AuthContext,
) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for learning review persistence.");
  }

  const candidateId = text(body.candidate_id || body.candidateId || body.action_id || body.actionId);
  const decision = text(body.decision).toLowerCase();
  const promotionTarget = text(body.promotion_target || body.promotionTarget);
  const reviewer = text(body.reviewed_by || body.reviewedBy || body.approved_by || body.approvedBy) ||
    auth.actorLabel ||
    "unknown_reviewer";
  const reviewNote = nullableText(body.review_note || body.reviewNote || body.note);

  if (!candidateId) throw new Error("candidate_id is required.");
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("decision must be approved or rejected.");
  }

  const eventType = decision === "approved"
    ? mapPromotionTargetToEventType(promotionTarget)
    : "learning.candidate.rejected";
  const proposedPayload = asRecord(body.proposed_payload || body.proposedPayload);
  const payload = {
    candidate_id: candidateId,
    candidate_title: nullableText(body.title),
    candidate_kind: nullableText(body.kind || body.related_entity_type || body.relatedEntityType),
    decision,
    promotion_target: promotionTarget || null,
    reviewed_by: reviewer,
    reviewer_id: auth.actorId || null,
    reviewer_source: auth.actorSource,
    review_note: reviewNote,
    source_conversation_ids: asStringArray(body.source_conversation_ids || body.sourceConversationIds),
    source_trace_ids: asStringArray(body.source_trace_ids || body.sourceTraceIds),
    proposed_payload: proposedPayload,
    reviewed_at: new Date().toISOString(),
  };
  const idempotencyKey = await buildEventIdempotencyKey({
    type: eventType,
    candidate_id: candidateId,
    decision,
    reviewed_by: reviewer,
  });
  const writeResult = await writeEvent(supabase, {
    tenantId: text(body.tenant_id || body.tenantId) || "polesheadlamp.id",
    type: eventType,
    payload,
    idempotencyKey,
    traceId: trace.traceId,
    source: "cekat-ai-tools.learning-review",
  });

  return {
    decision,
    event_type: eventType,
    candidate_id: candidateId,
    duplicate: writeResult.duplicate,
    event_id: writeResult.event?.id || null,
    idempotency_key: idempotencyKey,
  };
}

async function loadLearningReviewHistory(body: Record<string, unknown>) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for learning review history.");
  }

  const tenantId = text(body.tenant_id || body.tenantId) || "polesheadlamp.id";
  const limit = Math.min(1000, Math.max(1, Number(body.limit || 500)));
  const { data, error } = await supabase
    .from("events")
    .select("id,occurred_at,type,payload,trace_id,source")
    .eq("tenant_id", tenantId)
    .in("type", [...LEARNING_REVIEW_EVENT_TYPES])
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const latestByCandidate = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(data) ? data : []) {
    const payload = asRecord(row.payload);
    const candidateId = text(payload.candidate_id || payload.candidateId || payload.action_id || payload.actionId);
    if (!candidateId || latestByCandidate.has(candidateId)) continue;

    const rejected = row.type === "learning.candidate.rejected";
    latestByCandidate.set(candidateId, {
      candidate_id: candidateId,
      status: rejected ? "rejected" : "approved",
      decision: rejected ? "rejected" : "approved",
      event_id: row.id,
      event_type: row.type,
      reviewed_at: row.occurred_at,
      reviewed_by: nullableText(payload.reviewed_by || payload.approved_by),
      reviewer_id: nullableText(payload.reviewer_id),
      reviewer_source: nullableText(payload.reviewer_source),
      review_note: nullableText(payload.review_note),
      promotion_target: nullableText(payload.promotion_target) || (rejected ? null : text(row.type)),
      source_conversation_ids: asStringArray(payload.source_conversation_ids),
      source_trace_ids: asStringArray(payload.source_trace_ids),
      trace_id: nullableText(row.trace_id),
      source: nullableText(row.source),
    });
  }

  const reviews = Array.from(latestByCandidate.values());
  return {
    tenant_id: tenantId,
    review_count: reviews.length,
    approved_count: reviews.filter((review) => review.status === "approved").length,
    rejected_count: reviews.filter((review) => review.status === "rejected").length,
    reviews,
  };
}

async function loadApprovedCaseLibrary(body: Record<string, unknown>) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for approved case library.");
  }

  const tenantId = text(body.tenant_id || body.tenantId) || "polesheadlamp.id";
  const limit = Math.min(500, Math.max(1, Number(body.limit || 250)));
  const { data, error } = await supabase
    .from("events")
    .select("id,occurred_at,type,payload,trace_id,source")
    .eq("tenant_id", tenantId)
    .in("type", ["approved_case.promoted", "approved_case.revoked"])
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const revocations = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row.type !== "approved_case.revoked") continue;
    const payload = asRecord(row.payload);
    for (const key of approvedCaseKeys(payload)) {
      if (!revocations.has(key)) {
        revocations.set(key, row as Record<string, unknown>);
      }
    }
  }

  const seen = new Set<string>();
  const cases = [];
  for (const row of rows) {
    if (row.type !== "approved_case.promoted") continue;
    const payload = asRecord(row.payload);
    const caseId = approvedCasePrimaryKey(payload, String(row.id || ""));
    if (!caseId || seen.has(caseId)) continue;
    seen.add(caseId);

    const revokeEvent = approvedCaseKeys(payload)
      .map((key) => revocations.get(key))
      .find(Boolean) || null;
    const revokePayload = asRecord(revokeEvent?.payload);

    cases.push({
      case_id: caseId,
      event_id: row.id,
      status: revokeEvent ? "revoked" : "active",
      promoted_at: row.occurred_at,
      revoked_at: revokeEvent?.occurred_at || null,
      revoke_reason: nullableText(revokePayload.reason || revokePayload.review_note),
      title: nullableText(payload.title || payload.candidate_title) || "Approved case",
      approved_by: nullableText(payload.approved_by || payload.reviewed_by),
      promotion_target: nullableText(payload.promotion_target),
      source: nullableText(payload.source),
      proposed_action: nullableText(payload.proposed_action),
      source_conversation_ids: asStringArray(payload.source_conversation_ids),
      source_trace_ids: asStringArray(payload.source_trace_ids),
      snippet_content_hash: nullableText(payload.snippet_content_hash),
      payload,
    });
  }

  return {
    tenant_id: tenantId,
    total_count: cases.length,
    active_count: cases.filter((item) => item.status === "active").length,
    revoked_count: cases.filter((item) => item.status === "revoked").length,
    cases,
  };
}

async function persistApprovedCaseRevoke(
  body: Record<string, unknown>,
  trace: TraceContext,
  auth: AuthContext,
) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for approved case revoke.");
  }

  const caseId = text(body.case_id || body.caseId || body.candidate_id || body.candidateId);
  const reason = nullableText(body.reason || body.review_note || body.reviewNote);
  const revokedBy = text(body.revoked_by || body.revokedBy) || auth.actorLabel || "unknown_reviewer";
  if (!caseId) throw new Error("case_id is required.");

  const payload = {
    case_id: caseId,
    candidate_id: nullableText(body.candidate_id || body.candidateId) || caseId,
    revoked_by: revokedBy,
    reviewer_id: auth.actorId || null,
    reviewer_source: auth.actorSource,
    reason,
    original_case: asRecord(body.original_case || body.originalCase),
    revoked_at: new Date().toISOString(),
  };
  const idempotencyKey = await buildEventIdempotencyKey({
    type: "approved_case.revoked",
    case_id: caseId,
    revoked_by: revokedBy,
  });
  const writeResult = await writeEvent(supabase, {
    tenantId: text(body.tenant_id || body.tenantId) || "polesheadlamp.id",
    type: "approved_case.revoked",
    payload,
    idempotencyKey,
    traceId: trace.traceId,
    source: "cekat-ai-tools.approved-case-revoke",
  });

  return {
    case_id: caseId,
    event_type: "approved_case.revoked",
    duplicate: writeResult.duplicate,
    event_id: writeResult.event?.id || null,
    idempotency_key: idempotencyKey,
  };
}

function mapPromotionTargetToEventType(target: string): AiEventType {
  if ((LEARNING_PROMOTION_EVENT_TYPES as readonly string[]).includes(target)) {
    return target;
  }
  throw new Error(`Unsupported promotion_target for approval: ${target || "(empty)"}`);
}

function normalizeProofAssetRecord(value: unknown) {
  const record = asRecord(value);
  const imagePath = text(record.imagePath || record.image_path);
  return {
    id: text(record.id),
    title: text(record.title || record.name),
    vehicle_type_id: nullableText(record.vehicleTypeId || record.vehicle_type_id),
    image_url: normalizeProofAssetUrl(imagePath),
    tags: Array.isArray(record.tags)
      ? record.tags.map(text).filter(Boolean)
      : text(record.tags).split(/[,;\n]/g).map(text).filter(Boolean),
    caption: nullableText(record.caption),
    year: nullableText(record.year || record.vehicle_year || record.vehicleYear),
    is_active: record.isActive === false || record.is_active === false ? false : true,
    usage_count: Number(record.usageCount || record.usage_count || 0) || 0,
  };
}

function normalizeVehicleRecord(value: unknown) {
  const record = asRecord(value);
  return {
    id: text(record.id),
    name: text(record.name || record.title),
    category: text(record.category),
  };
}

function normalizeProofAssetUrl(imagePath: string) {
  if (!imagePath) return "";
  if (/^https?:\/\//i.test(imagePath) || imagePath.startsWith("data:")) return imagePath;
  if (!supabaseUrl) return imagePath;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/proof-assets/${encodeURI(imagePath)}`;
}

function proofTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  const aliases: Record<string, string> = {
    hrv: "hrv",
    "hr-v": "hrv",
    karimun: "karimun",
    wagonr: "karimun",
    "wagon r": "karimun",
    estillo: "karimun",
    estilo: "karimun",
    mercy: "mercedes",
    menguning: "kuning",
    kekuningan: "kuning",
    buram: "kusam",
    butek: "kusam",
  };
  return Array.from(new Set(
    normalized
      .split(/\s+/g)
      .map((token) => aliases[token] || token)
      .filter((token) => token.length >= 3),
  ));
}

function fuzzyContains(left: string, right: string) {
  const leftTokens = proofTokens(left);
  const rightTokens = proofTokens(right);
  return rightTokens.some((token) => leftTokens.includes(token));
}

function classifyVehicleText(value: string) {
  const tokens = new Set(proofTokens(value));
  if (["brio", "agya", "ayla", "yaris", "jazz", "city", "swift", "karimun"].some((token) => tokens.has(token))) {
    return "small";
  }
  if (["avanza", "xenia", "mobilio", "freed", "ertiga", "xpander", "innova", "livina", "serena", "calya", "sigra"].some((token) => tokens.has(token))) {
    return "mpv";
  }
  if (["hrv", "rush", "terios", "creta", "raize", "rocky", "crv", "fortuner", "pajero", "captiva"].some((token) => tokens.has(token))) {
    return "suv";
  }
  if (["bmw", "mercedes", "lexus", "audi", "porsche"].some((token) => tokens.has(token))) {
    return "premium";
  }
  return "";
}

function inferVehicleYear(value: string) {
  const hit = String(value || "").match(/\b(20[0-3][0-9])\b/);
  return hit?.[1] || "";
}

function inferVehicleBrands(value: string) {
  const tokens = new Set(proofTokens(value));
  const brandRules: Record<string, string[]> = {
    toyota: ["toyota", "avanza", "innova", "yaris", "rush", "calya", "agya", "fortuner", "serena"],
    honda: ["honda", "hrv", "crv", "brio", "jazz", "city", "mobilio", "freed"],
    daihatsu: ["daihatsu", "xenia", "terios", "ayla", "sigra", "rocky"],
    suzuki: ["suzuki", "karimun", "ertiga", "swift"],
    mitsubishi: ["mitsubishi", "xpander", "pajero"],
    nissan: ["nissan", "livina", "serena"],
    hyundai: ["hyundai", "creta"],
    mazda: ["mazda"],
    mercedes: ["mercedes", "mercy", "benz"],
    bmw: ["bmw"],
    lexus: ["lexus"],
    audi: ["audi"],
  };
  return Object.entries(brandRules)
    .filter(([, aliases]) => aliases.some((alias) => tokens.has(alias)))
    .map(([brand]) => brand);
}

function isProofAssetRequest(value: string) {
  return /\b(testimoni|testimonial|contoh|hasil|before\s*after|before-after|foto|gambar|referensi|ref)\b/i.test(value || "");
}

function inferRecentVehicleText(messages: CekatMessage[], beforeCreatedAt: string) {
  const beforeMs = Date.parse(beforeCreatedAt);
  const priorMessages = [...messages]
    .filter((message) => {
      const createdAt = Date.parse(message.created_at);
      return Number.isFinite(createdAt) && (!Number.isFinite(beforeMs) || createdAt <= beforeMs);
    })
    .reverse();
  for (const message of priorMessages) {
    const vehicleText = inferVehicleText(message.message || "");
    if (vehicleText) return vehicleText;
  }
  return "";
}

function inferRecentConditionText(messages: CekatMessage[], beforeCreatedAt: string) {
  const beforeMs = Date.parse(beforeCreatedAt);
  const priorMessages = [...messages]
    .filter((message) => {
      const createdAt = Date.parse(message.created_at);
      return Number.isFinite(createdAt) && (!Number.isFinite(beforeMs) || createdAt <= beforeMs);
    })
    .reverse();
  for (const message of priorMessages) {
    const conditionText = inferConditionText(message.message || "");
    if (conditionText) return conditionText;
  }
  return "";
}

async function resolveSalesFlowState(input: {
  latest_customer_message: string | null;
  vehicle_text: string | null;
  condition_text: string | null;
  area_text: string | null;
  proof_asset_sent: boolean;
  education_sent: boolean;
  price_shown: boolean;
  schedule_text: string | null;
  customer_name: string | null;
  contact_phone: string | null;
  address_text: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  sent_by: string | null;
}) {
  const latest = input.latest_customer_message || "";
  const vehicleText = input.vehicle_text || inferVehicleText(latest);
  const conditionText = input.condition_text || inferConditionText(latest);
  const areaText = input.area_text || inferAreaText(latest);
  const asksProof = isProofAssetRequest(latest);
  const asksPrice = /\b(harga|biaya|ongkos|estimasi|berapa|price|cost)\b/i.test(latest);
  const asksSchedule = /\b(jadwal|slot|besok|lusa|hari ini|minggu|senin|selasa|rabu|kamis|jumat|sabtu|jam)\b/i.test(latest);

  if (!vehicleText) {
    return salesFlowStep({
      step: "vehicle",
      nextAction: "collect_vehicle_type",
      requiredTool: null,
      mustAsk: "vehicle_text",
      suggested: "Halo kak, boleh dibantu infonya ya 😊 Untuk tipe mobil apa yang mau dipoles headlamp-nya kak?",
      forbidden: ["ask_area", "quote_price", "check_availability", "ask_schedule", "collect_booking_data"],
    });
  }

  if (asksProof || !conditionText || !input.proof_asset_sent) {
    const proofAsset = await selectRelevantProofAsset({
      vehicle_text: vehicleText,
      condition_text: conditionText || null,
      max_results: 1,
      conversation_id: input.conversation_id,
      contact_id: input.contact_id,
      sent_by: input.sent_by,
    });
    return salesFlowStep({
      step: "proof_condition",
      nextAction: "send_proof_and_validate_condition",
      requiredTool: null,
      mustAsk: "condition_or_photo",
      suggested: proofAsset.suggested_customer_text ||
        `Siap kak, ${vehicleText} ya 😊 Kalau boleh tau, kondisi headlampnya menguning/kusam seperti contoh ini atau bagaimana kak?`,
      forbidden: ["ask_area", "quote_price", "check_availability", "ask_schedule", "collect_booking_data"],
      extra: { proof_asset: proofAsset },
    });
  }

  if (!input.education_sent) {
    return salesFlowStep({
      step: "education",
      nextAction: "educate_condition_then_collect_area",
      requiredTool: null,
      mustAsk: "area_text",
      suggested: "Siap kak, kondisi menguning biasanya karena oksidasi/coating luar yang sudah rusak. Nanti prosesnya dibantu poles, deep clean, finishing, lalu nano coating supaya lebih bening dan terlindungi 😊\n\nBoleh tahu lokasi/kecamatan kakak di mana?",
      forbidden: ["quote_price", "check_availability", "ask_schedule", "collect_booking_data"],
    });
  }

  if (!areaText) {
    return salesFlowStep({
      step: "area",
      nextAction: "collect_area",
      requiredTool: null,
      mustAsk: "area_text",
      suggested: "Boleh tahu lokasi atau kecamatan kakak di mana? Biar saya cek coverage dan estimasinya ya 😊",
      forbidden: ["quote_price", "check_availability", "ask_schedule", "collect_booking_data"],
    });
  }

  if (asksPrice || !input.price_shown) {
    return salesFlowStep({
      step: "price",
      nextAction: "resolve_area_then_price",
      requiredTool: "get_price_estimate_guarded",
      mustAsk: "price_or_next_close",
      suggested: null,
      forbidden: ["quote_price_without_pricing_tool", "ask_schedule_before_price", "collect_booking_data"],
    });
  }

  if (asksSchedule || !input.schedule_text) {
    return salesFlowStep({
      step: "schedule",
      nextAction: "collect_or_check_schedule",
      requiredTool: asksSchedule ? "resolve_calendar_input" : "check_area_availability",
      mustAsk: "schedule_date_time",
      suggested: "Mau dibantu jadwalkan untuk hari apa kak? Nanti saya cek slot yang tersedia 😊",
      forbidden: ["collect_booking_data_before_slot"],
    });
  }

  const missingBooking = [
    !input.customer_name ? "customer_name" : "",
    !input.contact_phone ? "contact_phone" : "",
    !input.address_text ? "address_text" : "",
  ].filter(Boolean);
  if (missingBooking.length > 0) {
    return salesFlowStep({
      step: "booking_data",
      nextAction: `collect_booking_data:${missingBooking[0]}`,
      requiredTool: "assess_lead_completeness",
      mustAsk: missingBooking[0],
      suggested: missingBooking[0] === "customer_name"
        ? "Boleh dibantu nama lengkapnya kak untuk data booking?"
        : missingBooking[0] === "contact_phone"
        ? "Boleh dibantu nomor WhatsApp aktifnya kak?"
        : "Boleh dibantu alamat lengkapnya kak, sekalian patokan kalau ada?",
      forbidden: ["final_confirm_before_booking_complete"],
    });
  }

  return salesFlowStep({
    step: "reminder",
    nextAction: "booking_ready_or_followup",
    requiredTool: "upsert_booking_capture",
    mustAsk: null,
    suggested: null,
    forbidden: [],
  });
}

function salesFlowStep(input: {
  step: string;
  nextAction: string;
  requiredTool: string | null;
  mustAsk: string | null;
  suggested: string | null;
  forbidden: string[];
  extra?: Record<string, unknown>;
}) {
  return {
    current_step: input.step,
    next_action: input.nextAction,
    required_next_tool: input.requiredTool,
    must_ask: input.mustAsk ? [input.mustAsk] : [],
    allowed_actions: [input.nextAction],
    forbidden_actions: input.forbidden,
    suggested_customer_text: input.suggested,
    sales_stage_hint: input.step,
    ...(input.extra || {}),
  };
}

function inferVehicleText(value: string) {
  const tokens = [
    "avanza", "xenia", "hrv", "hr-v", "crv", "cr-v", "karimun", "brio", "innova", "ertiga", "xpander",
    "mobilio", "freed", "rush", "terios", "agya", "ayla", "jazz", "yaris", "fortuner", "pajero", "calya", "sigra",
  ];
  const normalized = value.toLowerCase();
  const hit = tokens.find((token) => normalized.includes(token));
  return hit ? hit.toUpperCase().replace("-", "") : "";
}

function inferConditionText(value: string) {
  const hit = value.match(/\b(menguning|kuning|kusam|buram|baret|retak|embun|berembun|pecah|butek|blur|oxidasi|oksidasi)\b/i);
  return hit?.[0] || "";
}

function inferAreaText(value: string) {
  const hit = value.match(/\b(jakarta|bogor|depok|tangerang|bekasi|bandung|karawang|cibubur|cikarang|sawangan|bintaro|bsd|pik|cinere|pamulang|ciputat)\b/i);
  return hit?.[0] || "";
}

function toolResult({
  data,
  next_action,
  suggested_customer_text,
  sales_stage_hint,
}: {
  data: unknown;
  next_action: string;
  suggested_customer_text: string | null;
  sales_stage_hint: string | null;
}): ToolEnvelope {
  return {
    ok: true,
    data,
    next_action,
    suggested_customer_text,
    sales_stage_hint,
  };
}

interface ToolEnvelope {
  ok: true;
  data: unknown;
  next_action: string;
  suggested_customer_text: string | null;
  sales_stage_hint: string | null;
  schema_version?: string;
  trace_id?: string;
}

function suggestedTextFromNextBestClose(data: {
  must_ask?: string[];
  suggested_options?: string[];
  handoff_required?: boolean;
}) {
  if (data.handoff_required) {
    return "Baik kak, saya bantu teruskan ke tim kami ya. Mohon tunggu sebentar 🙏";
  }
  const ask = data.must_ask?.[0] || "";
  const options = (data.suggested_options || []).slice(0, 2);
  if (ask === "condition_or_photo") {
    return "Kondisi lampunya menguning/kusam saja atau ada embun/retak juga kak? Kalau bisa kirim foto aktualnya juga boleh 🙏";
  }
  if (ask === "customer_name") return "Boleh nama lengkapnya kak?";
  if (ask === "choose_slot_option" && options.length) {
    return `Kakak prefer ${options.join(" atau ")}?`;
  }
  if (ask === "hold_preferred_slot") {
    return "Kalau cocok, mau saya bantu hold slot sementara dulu kak?";
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
    ? ""
    : String(value).trim();
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function payloadText(source: unknown, keys: string[]): string | null {
  const seen = new Set<unknown>();
  const containers = [
    source,
    asRecord(source).additional_payload,
    asRecord(source).additionalPayload,
    asRecord(source).payload,
    asRecord(source).context,
    asRecord(source).conversation,
    asRecord(source).contact,
    asRecord(source).customer,
  ];

  const read = (value: unknown, depth = 0): string | null => {
    if (!value || typeof value !== "object" || Array.isArray(value) || seen.has(value)) {
      return null;
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const direct = nullableText(record[key]);
      if (direct) return direct;
    }
    if (depth >= 2) return null;
    for (const nestedKey of [
      "additional_payload",
      "additionalPayload",
      "payload",
      "context",
      "conversation",
      "contact",
      "customer",
      "metadata",
    ]) {
      const nested = read(record[nestedKey], depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  for (const container of containers) {
    const found = read(container);
    if (found) return found;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function booleanish(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return /^(true|yes|ya|y|1)$/i.test(value.trim());
  }
  if (typeof value === "number") return value === 1;
  return false;
}

function approvedCasePrimaryKey(payload: Record<string, unknown>, fallback: string): string {
  return text(
    payload.case_id ||
    payload.candidate_id ||
    payload.snippet_content_hash ||
    fallback,
  );
}

function approvedCaseKeys(payload: Record<string, unknown>): string[] {
  return [
    text(payload.case_id),
    text(payload.candidate_id),
    text(payload.snippet_content_hash),
  ].filter(Boolean);
}

export default route;
