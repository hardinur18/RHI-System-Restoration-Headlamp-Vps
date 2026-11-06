import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCalendarInput } from "./domain/calendar.ts";
import { validateAddressSufficiency } from "./domain/address_sufficiency.ts";
import { validateName } from "./domain/name_validator.ts";
import { assessLeadCompleteness } from "./conversion/lead_completeness.ts";
import { classifyObjection } from "./conversion/objection_classifier.ts";
import { recommendNextBestClose } from "./conversion/next_best_close.ts";
import {
  evaluateSignals,
  type CustomerSignal,
} from "./conversion/signals_evaluator.ts";
import {
  buildEventIdempotencyKey,
  criticalEventIdempotencyKey,
  type AiEventType,
  type WriteEventInput,
  writeEvent,
} from "./persistence/events.ts";
import {
  childTraceContext,
  createTraceContext,
  hashForTelemetry,
  headersFromRequest,
  logError,
  logSpan,
  type TraceContext,
} from "./observability.ts";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "Token", "x-client-token", "X-Client-Token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const sharedSecret = Deno.env.get("CEKAT_SYNC_SHARED_SECRET")?.trim() || "";
const defaultCsName = Deno.env.get("DEFAULT_CEKAT_CS_NAME")?.trim() || "Nida";
const defaultCsId = Deno.env.get("DEFAULT_CEKAT_CS_ID")?.trim() || "";
const defaultAdvertiserId = Deno.env.get("DEFAULT_CEKAT_ADVERTISER_ID")?.trim() || "";
const defaultPlatformId = Deno.env.get("DEFAULT_CEKAT_PLATFORM_ID")?.trim() || "0locyp1eu";
const defaultSubChannelId = Deno.env.get("DEFAULT_CEKAT_SUB_CHANNEL_ID")?.trim() || "kxs25q3di";
const defaultTechnicianDailyCapacity = Number(Deno.env.get("CEKAT_TECHNICIAN_DAILY_CAPACITY") || "3") || 3;
const availabilityApiKey = Deno.env.get("CEKAT_AVAILABILITY_API_KEY")?.trim() || "";
const cekatAccessToken = Deno.env.get("CEKAT_ACCESS_TOKEN")?.trim() || "";
const SLOT_SEQUENCE = ["08:00", "10:00", "12:00", "15:00", "17:00"];
const SLOT_SEQUENCE_SET = new Set(SLOT_SEQUENCE);
const CEKAT_SYNC_LABELS = [
  { name: "AI Data Buyer Sudah Dicatat", color: "#14b8a6" },
  { name: "AI Booking Masih Draft", color: "#6366f1" },
  { name: "AI Booking Sudah Fix", color: "#22c55e" },
  { name: "AI Jadwal Belum Fix", color: "#f97316" },
  { name: "AI Butuh Type Mobil", color: "#f59e0b" },
  { name: "AI Butuh Data Buyer Tambahan", color: "#f97316" },
  { name: "AI Link Maps Sudah Tersimpan", color: "#0ea5e9" },
  { name: "AI Menunggu Link Maps Buyer", color: "#f59e0b" },
];

const CEKAT_LABEL_LEGACY_ALIASES: Record<string, string[]> = {
  "AI Data Buyer Sudah Dicatat": ["AI Sudah Input Lead", "Lead Masuk Web", "Lead Sudah Masuk Web"],
  "AI Booking Masih Draft": ["AI Sudah Input Draft Booking", "Draft Booking Masuk Web"],
  "AI Booking Sudah Fix": ["AI Sudah Input Booking Jadwal", "Booking Masuk Jadwal", "Booking Sudah Masuk Jadwal"],
  "AI Jadwal Belum Fix": ["AI Wajib Cek Ulang Jam Booking", "Cek Ulang Jam Booking", "Booking Perlu Cek Jam"],
  "AI Butuh Type Mobil": ["Type Mobil Belum Jelas"],
  "AI Butuh Data Buyer Tambahan": ["AI Butuh Data Buyer Lengkap", "Data Buyer Belum Lengkap"],
  "AI Link Maps Sudah Tersimpan": ["AI Sudah Simpan Link Maps Buyer", "Buyer Sudah Kirim Link Maps", "Maps Buyer Sudah Ada"],
  "AI Menunggu Link Maps Buyer": ["AI Butuh Link Maps Buyer", "Buyer Belum Kirim Link Maps", "Maps Buyer Belum Ada"],
};

const GREETING_ONLY_NAME_PHRASES = new Set([
  "pagi",
  "pagi kak",
  "siang",
  "siang kak",
  "sore",
  "sore kak",
  "malam",
  "malam kak",
  "selamat pagi",
  "selamat pagi kak",
  "selamat siang",
  "selamat siang kak",
  "selamat sore",
  "selamat sore kak",
  "selamat malam",
  "selamat malam kak",
  "halo",
  "halo kak",
  "hallo",
  "hallo kak",
  "hai",
  "hai kak",
  "hi",
  "hi kak",
  "oke",
  "ok",
  "oh ok",
  "oh oke",
  "chat cekat",
  "lead cekat",
  "brp harganya",
  "berapa harganya",
  "bisa minta info harga",
  "bisa minta info harganya",
  "permisi",
  "assalamualaikum",
  "assalamu alaikum",
]);

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "cekat-conversation-sync",
    date: new Date().toISOString(),
  })
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "cekat-conversation-sync",
  })
);

app.post("/", handleSync);
app.post("/cekat-conversation-sync", handleSync);
app.post("/booking-capture", handleSync);

type SyncPayload = Record<string, unknown>;
type NormalizedMessage = {
  id?: string | null;
  text: string;
  senderRole: "customer" | "admin" | "ai" | "unknown";
  createdAt?: string | null;
  attachments: Array<{ type?: string | null; url?: string | null }>;
};

type ReferenceData = {
  branches: Array<Record<string, any>>;
  areas: Array<Record<string, any>>;
  services: Array<Record<string, any>>;
  vehicles: Array<Record<string, any>>;
  users: Array<Record<string, any>>;
};

type OutputDetail = "slim" | "full";

function parseBooleanFlag(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveOutputDetail(payload: SyncPayload, fallback: OutputDetail = "slim"): OutputDetail {
  const explicit = String(
    payload.outputDetail ??
      payload.output_detail ??
      payload.responseDetail ??
      payload.response_detail ??
      payload.detail ??
      "",
  )
    .trim()
    .toLowerCase();

  if (["full", "debug", "verbose", "detail"].includes(explicit)) return "full";
  if (["slim", "compact", "minimal", "min"].includes(explicit)) return "slim";
  if (parseBooleanFlag(payload.debug) || parseBooleanFlag(payload.verbose)) return "full";
  return fallback;
}

app.onError((error, c) => {
  const trace = createTraceContext({
    service: "cekat-conversation-sync",
    method: c.req.method,
    path: c.req.path,
    headers: headersFromRequest(c),
  });
  logError(trace, "conversation.turn", error);
  return c.json(
    {
      ok: false,
      trace_id: trace.traceId,
      error: error instanceof Error ? error.message : "Unhandled error",
    },
    500,
  );
});

async function handleSync(c: any) {
  let trace = createTraceContext({
    service: "cekat-conversation-sync",
    method: c.req.method,
    path: c.req.path,
    headers: headersFromRequest(c),
  });
  try {
    assertAuthorized(
      c.req.header("authorization"),
      c.req.header("x-client-token") || c.req.header("token"),
    );

    const rawPayload = (await c.req.json().catch(() => null)) as SyncPayload | null;
    if (!rawPayload || typeof rawPayload !== "object") {
      logSpan(trace, "conversation.turn", "invalid", { reason: "invalid_json" });
      return c.json({ ok: false, trace_id: trace.traceId, error: "Payload JSON tidak valid." }, 400);
    }
    trace = childTraceContext(trace, rawPayload);

    const payload = {
      ...rawPayload,
      __sync_path: c.req.path,
      __trace_id: trace.traceId,
    } as SyncPayload;
    const outputDetail = resolveOutputDetail(payload, "slim");
    const normalized = normalizePayload(payload);
    trace = {
      ...trace,
      conversationId: normalized.conversationId || trace.conversationId || null,
    };
    if (!normalized.conversationId) {
      logSpan(trace, "conversation.turn", "invalid", {
        reason: "missing_conversation_id",
        input_hash: hashForTelemetry(rawPayload),
      });
      return c.json({ ok: false, trace_id: trace.traceId, error: "conversation.id / conversationId wajib ada." }, 400);
    }
    logSpan(trace, "conversation.turn", "ok", {
      input_hash: hashForTelemetry(rawPayload),
      message_count: normalized.messages.length,
      source: normalized.writeSource,
      inbox_name: normalized.inboxName || null,
    });
    const isSyntheticDebugConversation = /^((debug|test|health)-)/i.test(normalized.conversationId);

    const existingRecord = await getExistingIntelligence(normalized.conversationId);
    if (!isSyntheticDebugConversation) {
      await writeAiEventSafely({
        normalized,
        trace,
        type: "conversation.started",
        payload: {
          inbox_id: normalized.inboxId || null,
          inbox_name: normalized.inboxName || null,
          source: normalized.writeSource || null,
          social_platform: normalized.socialPlatform || null,
        },
        idempotencyKey: await buildEventIdempotencyKey([
          "conversation.started",
          normalized.conversationId,
        ]),
      });
    }
    const refs = await loadReferenceData();
    const intelligence = deriveIntelligence(normalized);
    const baseResolvedRefs = await resolveReferenceMatches(intelligence, refs);
    const slotResolution = await resolveBookingSlot({
      refs,
      areaText: intelligence.extracted.areaText,
      scheduleDate: intelligence.extracted.scheduleDate,
      scheduleTime: intelligence.extracted.scheduleTime,
    });
    const resolvedRefs = mergeResolvedReferences(baseResolvedRefs, slotResolution, refs, intelligence.extracted.areaText);
    const csId = await resolveCsId(payload, refs.users);

    if (isSyntheticDebugConversation) {
      const debugSyncStatus = buildSyncStatus({
        intelligence,
        leadId: null,
        bookingId: null,
        existingDateBookingId: null,
        branchId: resolvedRefs.branch?.id || null,
        mapsUrl: intelligence.extracted.mapsUrl || null,
        bookingStatus: null,
        missingFields: deriveMissingFields({ intelligence, resolvedRefs }),
      });
      let debugIntelligence = applyOperationalStatusGuard({
        intelligence,
        syncStatus: debugSyncStatus,
      });
      debugIntelligence = await applyConversionCore({
        normalized,
        intelligence: debugIntelligence,
        resolvedRefs,
        syncStatus: debugSyncStatus,
        leadId: null,
        bookingStatus: null,
        trace,
      });
      const debugCaptureState = deriveCaptureState({
        leadId: null,
        bookingId: null,
        bookingStatus: null,
      });
      const debugRequiredNextFields = prioritizeMissingFields(debugSyncStatus.missingFields).slice(0, 3);
      const debugBuyerFacingRequiredFields = deriveBuyerFacingRequiredFields(debugSyncStatus.missingFields);
      const debugResponseMode = deriveResponseMode({
        captureState: debugCaptureState,
        bookingStatus: null,
        requiredNextFields: debugBuyerFacingRequiredFields,
        stage: debugIntelligence.stage,
        outcome: debugIntelligence.outcome,
      });
      const debugCustomerFacingScheduleLabel = formatCustomerFacingScheduleLabel(
        intelligence.extracted.scheduleDate || normalized.booking.scheduleDate || normalized.extracted.scheduleDate || null,
        intelligence.extracted.scheduleTime || normalized.booking.scheduleTime || normalized.extracted.scheduleTime || null,
      );
      const debugResponse = {
        ok: true,
        trace_id: trace.traceId,
        source: "cekat-conversation-sync",
        conversationId: normalized.conversationId,
        leadId: null,
        bookingId: null,
        captureState: debugCaptureState,
        bookingStatus: null,
        requiredNextFields: debugBuyerFacingRequiredFields,
        operationalMissingFields: debugRequiredNextFields,
        stage: debugIntelligence.stage,
        outcome: debugIntelligence.outcome,
        nextBestAction: debugIntelligence.nextBestAction,
        responseMode: debugResponseMode,
        customerFacingScheduleLabel: debugCustomerFacingScheduleLabel || null,
        mustContinueCollecting: debugResponseMode === "collect_missing_fields",
        mustSendFinalConfirmation: debugResponseMode === "send_final_confirmation",
        mustNotHandoffYet: debugResponseMode === "collect_missing_fields",
        debugNoWrite: true,
        resolved: {
          branchId: resolvedRefs.branch?.id || null,
          areaId: resolvedRefs.area?.id || null,
          serviceId: resolvedRefs.service?.id || null,
          vehicleId: resolvedRefs.vehicle?.id || null,
          csId,
          technicianId: resolvedRefs.technicianId || null,
        },
        syncStatus: {
          leadInserted: false,
          bookingInserted: false,
          bookingExistsForDate: false,
          bookingStatus: null,
          hasCompleteBookingDetails: debugSyncStatus.hasCompleteBookingDetails,
          requestedDate: debugSyncStatus.requestedDate || null,
          requestedTime: debugSyncStatus.requestedTime || null,
          requestedTimeAllowed: debugSyncStatus.requestedTimeAllowed,
          bookingReviewReason: debugSyncStatus.bookingReviewReason || null,
          mapsPresent: debugSyncStatus.mapsPresent,
          missingFields: Array.isArray(debugSyncStatus.missingFields) ? debugSyncStatus.missingFields : [],
          buyerFacingMissingFields: Array.isArray(debugSyncStatus.buyerFacingMissingFields)
            ? debugSyncStatus.buyerFacingMissingFields
            : [],
        },
        operationalReadiness: debugIntelligence.operationalReadiness
          ? {
              status: debugIntelligence.operationalReadiness.status || null,
              score: debugIntelligence.operationalReadiness.score ?? null,
              criticalMissingFields: Array.isArray(debugIntelligence.operationalReadiness.criticalMissingFields)
                ? debugIntelligence.operationalReadiness.criticalMissingFields
                : [],
              supportiveMissingFields: Array.isArray(debugIntelligence.operationalReadiness.supportiveMissingFields)
                ? debugIntelligence.operationalReadiness.supportiveMissingFields
                : [],
              bookingStatus: debugIntelligence.operationalReadiness.bookingStatus || null,
            }
          : null,
        leadCompleteness: debugIntelligence.leadCompleteness || null,
        objectionClassification: debugIntelligence.objectionClassification || null,
        nextBestClose: debugIntelligence.nextBestClose || null,
      };

      if (outputDetail !== "full") {
        return c.json(debugResponse);
      }

      return c.json({
        ...debugResponse,
        conversationMemory: debugIntelligence.memory || null,
        fieldConfidence: debugIntelligence.fieldConfidence || null,
        writeSource: normalized.writeSource,
        labelSync: null,
        intelligenceWarning: null,
        intelligenceRecordId: null,
      });
    }

    let lead = await upsertLead(normalized, intelligence, resolvedRefs, existingRecord?.synced_lead_id || null, csId);
    const booking = await upsertProspectBooking(
      normalized,
      intelligence,
      resolvedRefs,
      lead?.id || existingRecord?.synced_lead_id || null,
      existingRecord?.synced_booking_id || null,
      csId,
    );
    const existingDateBooking = booking
      ? booking
      : await findExistingBookingReference(
          lead?.id || existingRecord?.synced_lead_id || null,
          intelligence.extracted.scheduleDate,
        );
    lead = await alignLeadFromBooking(lead, booking || existingDateBooking);

    const syncStatus = buildSyncStatus({
      intelligence,
      leadId: lead?.id || null,
      bookingId: booking?.id || null,
      existingDateBookingId: existingDateBooking?.id || null,
      branchId: resolvedRefs.branch?.id || null,
      mapsUrl: booking?.maps_url || existingDateBooking?.maps_url || intelligence.extracted.mapsUrl || null,
      bookingStatus: booking?.status || existingDateBooking?.status || null,
      missingFields: deriveMissingFields({ intelligence, resolvedRefs }),
    });

    let effectiveIntelligence = applyOperationalStatusGuard({
      intelligence,
      syncStatus,
    });
    effectiveIntelligence = await applyConversionCore({
      normalized,
      intelligence: effectiveIntelligence,
      resolvedRefs,
      syncStatus,
      leadId: lead?.id || existingRecord?.synced_lead_id || null,
      bookingStatus: booking?.status || existingDateBooking?.status || null,
      trace,
    });

    await emitSyncEvents({
      normalized,
      intelligence: effectiveIntelligence,
      lead,
      booking,
      existingDateBooking,
      resolvedRefs,
      syncStatus,
      trace,
    });

    let record = null;
    let intelligenceWarning: string | null = null;
    try {
      record = await upsertConversationIntelligence({
        normalized,
        intelligence: effectiveIntelligence,
        existingRecord,
        leadId: lead?.id || existingRecord?.synced_lead_id || null,
        bookingId: booking?.id || existingRecord?.synced_booking_id || null,
        bookingStatus: booking?.status || existingDateBooking?.status || null,
      });
    } catch (error) {
      intelligenceWarning =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? JSON.stringify(error)
          : String(error);
      logError(trace, "persistence.write", error, {
        target: "cekat_conversation_intelligence",
      });
    }

    let labelSync: Record<string, unknown> | null = null;
    try {
      labelSync = await syncCekatLabels({
        conversationId: normalized.conversationId,
        syncStatus,
        looksConversationallyBooked:
          effectiveIntelligence.stage === "booking_confirmed" ||
          effectiveIntelligence.stage === "booking_capture" ||
          effectiveIntelligence.outcome === "booked" ||
          effectiveIntelligence.outcome === "ready_to_close",
      });
    } catch (error) {
      logError(trace, "persistence.write", error, {
        target: "cekat_labels",
      });
      labelSync = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const captureState = deriveCaptureState({
      leadId: lead?.id || existingRecord?.synced_lead_id || null,
      bookingId: booking?.id || existingDateBooking?.id || null,
      bookingStatus: booking?.status || existingDateBooking?.status || null,
    });
    const requiredNextFields = prioritizeMissingFields(syncStatus.missingFields).slice(0, 3);
    const buyerFacingRequiredFields = deriveBuyerFacingRequiredFields(syncStatus.missingFields);
    const responseMode = deriveResponseMode({
      captureState,
      bookingStatus: booking?.status || existingDateBooking?.status || null,
      requiredNextFields: buyerFacingRequiredFields,
      stage: effectiveIntelligence.stage,
      outcome: effectiveIntelligence.outcome,
    });

    const bookingStatus = booking?.status || existingDateBooking?.status || null;
    const customerFacingScheduleLabel = formatCustomerFacingScheduleLabel(
      intelligence.extracted.scheduleDate || normalized.booking.scheduleDate || normalized.extracted.scheduleDate || null,
      intelligence.extracted.scheduleTime || normalized.booking.scheduleTime || normalized.extracted.scheduleTime || null,
    );
    const slimResponse = {
      ok: true,
      trace_id: trace.traceId,
      source: "cekat-conversation-sync",
      conversationId: normalized.conversationId,
      leadId: lead?.id || existingRecord?.synced_lead_id || null,
      bookingId: booking?.id || existingDateBooking?.id || null,
      captureState,
      bookingStatus,
      requiredNextFields: buyerFacingRequiredFields,
      operationalMissingFields: requiredNextFields,
      stage: effectiveIntelligence.stage,
      outcome: effectiveIntelligence.outcome,
      nextBestAction: effectiveIntelligence.nextBestAction,
      responseMode,
      customerFacingScheduleLabel: customerFacingScheduleLabel || null,
      mustContinueCollecting: responseMode === "collect_missing_fields",
      mustSendFinalConfirmation: responseMode === "send_final_confirmation",
      mustNotHandoffYet: responseMode === "collect_missing_fields",
      resolved: {
        branchId: resolvedRefs.branch?.id || null,
        areaId: resolvedRefs.area?.id || null,
        serviceId: resolvedRefs.service?.id || null,
        vehicleId: resolvedRefs.vehicle?.id || null,
        csId,
        technicianId: booking?.technician_id || existingDateBooking?.technician_id || resolvedRefs.technicianId || null,
      },
      syncStatus: {
        leadInserted: syncStatus.leadInserted,
        bookingInserted: syncStatus.bookingInserted,
        bookingExistsForDate: syncStatus.bookingExistsForDate,
        bookingStatus: syncStatus.bookingStatus || null,
        hasCompleteBookingDetails: syncStatus.hasCompleteBookingDetails,
        requestedDate: syncStatus.requestedDate || null,
        requestedTime: syncStatus.requestedTime || null,
        requestedTimeAllowed: syncStatus.requestedTimeAllowed,
        bookingReviewReason: syncStatus.bookingReviewReason || null,
        mapsPresent: syncStatus.mapsPresent,
        missingFields: Array.isArray(syncStatus.missingFields) ? syncStatus.missingFields : [],
        buyerFacingMissingFields: Array.isArray(syncStatus.buyerFacingMissingFields)
          ? syncStatus.buyerFacingMissingFields
          : [],
      },
      operationalReadiness: effectiveIntelligence.operationalReadiness
        ? {
            status: effectiveIntelligence.operationalReadiness.status || null,
            score: effectiveIntelligence.operationalReadiness.score ?? null,
            criticalMissingFields: Array.isArray(effectiveIntelligence.operationalReadiness.criticalMissingFields)
              ? effectiveIntelligence.operationalReadiness.criticalMissingFields
              : [],
            supportiveMissingFields: Array.isArray(effectiveIntelligence.operationalReadiness.supportiveMissingFields)
              ? effectiveIntelligence.operationalReadiness.supportiveMissingFields
              : [],
            bookingStatus: effectiveIntelligence.operationalReadiness.bookingStatus || null,
          }
        : null,
      leadCompleteness: effectiveIntelligence.leadCompleteness || null,
      objectionClassification: effectiveIntelligence.objectionClassification || null,
      nextBestClose: effectiveIntelligence.nextBestClose || null,
    };

    if (outputDetail !== "full") {
      logSpan(trace, "sales.decision", "ok", {
        stage_before: intelligence.stage || null,
        stage_after: effectiveIntelligence.stage || null,
        outcome: effectiveIntelligence.outcome || null,
        next_best_action: effectiveIntelligence.nextBestAction || null,
        strategy_id: effectiveIntelligence.nextBestClose?.strategy_id || null,
        must_ask_count: Array.isArray(effectiveIntelligence.nextBestClose?.must_ask)
          ? effectiveIntelligence.nextBestClose.must_ask.length
          : 0,
        output_hash: hashForTelemetry(slimResponse),
      });
      return c.json(slimResponse);
    }

    const fullResponse = {
      ...slimResponse,
      conversationMemory: effectiveIntelligence.memory || null,
      fieldConfidence: effectiveIntelligence.fieldConfidence || null,
      writeSource: normalized.writeSource,
      labelSync,
      intelligenceWarning,
      intelligenceRecordId: record?.conversation_id || normalized.conversationId,
    };
    logSpan(trace, "sales.decision", "ok", {
      stage_before: intelligence.stage || null,
      stage_after: effectiveIntelligence.stage || null,
      outcome: effectiveIntelligence.outcome || null,
      next_best_action: effectiveIntelligence.nextBestAction || null,
      strategy_id: effectiveIntelligence.nextBestClose?.strategy_id || null,
      must_ask_count: Array.isArray(effectiveIntelligence.nextBestClose?.must_ask)
        ? effectiveIntelligence.nextBestClose.must_ask.length
        : 0,
      output_hash: hashForTelemetry(fullResponse),
    });
    return c.json(fullResponse);
  } catch (error) {
    logError(trace, "conversation.turn", error);
    const serializedError =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? JSON.stringify(error)
          : String(error);
    return c.json(
      {
        ok: false,
        trace_id: trace.traceId,
        error: serializedError,
      },
      500,
    );
  }
}

function assertAuthorized(authHeader?: string, clientToken?: string) {
  if (!sharedSecret && !supabaseServiceKey) return;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supplied = clientToken || bearer || "";
  const allowedTokens = [sharedSecret, supabaseServiceKey, availabilityApiKey].filter(Boolean);
  if (!allowedTokens.includes(supplied)) {
    throw new Error("Unauthorized");
  }
}

async function getExistingIntelligence(conversationId: string) {
  const { data, error } = await supabase
    .from("cekat_conversation_intelligence")
    .select("conversation_id, synced_lead_id, synced_booking_id, synced_order_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) {
    console.error("cekat-conversation-sync existing intelligence warning:", error);
    return null;
  }
  return data;
}

async function emitSyncEvents({
  normalized,
  intelligence,
  lead,
  booking,
  existingDateBooking,
  resolvedRefs,
  syncStatus,
  trace,
}: {
  normalized: ReturnType<typeof normalizePayload>;
  intelligence: any;
  lead: any;
  booking: any;
  existingDateBooking: any;
  resolvedRefs: any;
  syncStatus: any;
  trace: TraceContext;
}) {
  const eventWrites: Array<Promise<unknown>> = [];
  const leadId = lead?.id || null;
  const bookingRef = booking || existingDateBooking || null;

  if (resolvedRefs.area?.id || intelligence.extracted.areaText) {
    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: "area.resolved",
      customerId: leadId,
      payload: {
        area_id: resolvedRefs.area?.id || null,
        area_text: intelligence.extracted.areaText || null,
        branch_id: resolvedRefs.branch?.id || null,
        coverage_status: resolvedRefs.area ? "matched" : "unmatched",
      },
      idempotencyKey: await buildEventIdempotencyKey([
        "area.resolved",
        normalized.conversationId,
        resolvedRefs.area?.id || intelligence.extracted.areaText || "",
      ]),
    }));
  }

  if (syncStatus.requestedDate || syncStatus.requestedTime) {
    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: "calendar.resolved",
      customerId: leadId,
      payload: {
        schedule_date: syncStatus.requestedDate || null,
        schedule_time: syncStatus.requestedTime || null,
        requested_time_allowed: Boolean(syncStatus.requestedTimeAllowed),
        review_reason: syncStatus.bookingReviewReason || null,
      },
      idempotencyKey: await buildEventIdempotencyKey([
        "calendar.resolved",
        normalized.conversationId,
        syncStatus.requestedDate || "",
        syncStatus.requestedTime || "",
      ]),
    }));
  }

  if (leadId && Number(intelligence.qualificationScore || 0) >= 60) {
    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: "lead.qualified",
      customerId: leadId,
      payload: {
        lead_id: leadId,
        qualification_score: intelligence.qualificationScore || 0,
        stage: intelligence.stage || null,
        outcome: intelligence.outcome || null,
      },
      idempotencyKey: await buildEventIdempotencyKey([
        "lead.qualified",
        normalized.conversationId,
        leadId,
      ]),
    }));
  }

  if (bookingRef?.id) {
    const bookingEventType: AiEventType = bookingRef.status === "confirmed" ? "booking.confirmed" : "booking.saved";
    const bookingPayload = {
      booking_id: bookingRef.id,
      lead_id: leadId,
      status: bookingRef.status || null,
      schedule_date: bookingRef.schedule_date || null,
      schedule_time: bookingRef.schedule_time || null,
      area_id: bookingRef.area_id || resolvedRefs.area?.id || null,
      area_text: intelligence.extracted.areaText || null,
      branch_id: bookingRef.branch_id || resolvedRefs.branch?.id || null,
      vehicle_id: bookingRef.vehicle_id || resolvedRefs.vehicle?.id || null,
      vehicle_text: intelligence.extracted.vehicleText || null,
      has_maps_url: Boolean(bookingRef.maps_url),
    };

    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: bookingEventType,
      customerId: leadId,
      payload: bookingPayload,
      idempotencyKey: await criticalEventIdempotencyKey({
        type: bookingEventType,
        conversationId: normalized.conversationId,
        payload: bookingPayload,
      }),
    }));
  }

  const signalEvents = Array.isArray(intelligence.signalEvaluation?.events)
    ? intelligence.signalEvaluation.events as WriteEventInput[]
    : [];
  const signalEventTypes = new Set(signalEvents.map((event) => event.type));
  for (const event of signalEvents) {
    eventWrites.push(writePreparedEventSafely(event, trace));
  }

  const objection = intelligence.objectionClassification;
  if (objection?.objection_id && !signalEventTypes.has("objection.detected")) {
    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: "objection.detected",
      customerId: leadId,
      payload: {
        objection_id: objection.objection_id,
        severity: objection.severity || null,
        recommended_playbook_id: objection.recommended_playbook_id || null,
        human_required: Boolean(objection.human_required),
        loss_risk: objection.loss_risk || null,
        matched_triggers: Array.isArray(objection.matched_triggers) ? objection.matched_triggers : [],
      },
      idempotencyKey: await buildEventIdempotencyKey([
        "objection.detected",
        normalized.conversationId,
        objection.objection_id,
        objection.severity || "",
      ]),
    }));
  }

  if (intelligence.rawSignals?.priceSent) {
    const leadCompleteness = intelligence.leadCompleteness || {};
    const quoteEventType: AiEventType = leadCompleteness.ready_for_quote
      ? "quote.presented"
      : "price_first.violation";
    const quotePayload = {
      quote_id: `quote:${normalized.conversationId}`,
      service_id: resolvedRefs.service?.id || intelligence.extracted.serviceId || null,
      vehicle_id: resolvedRefs.vehicle?.id || intelligence.extracted.vehicleId || null,
      vehicle_text: intelligence.extracted.vehicleText || null,
      area_id: resolvedRefs.area?.id || intelligence.extracted.areaId || null,
      area_text: intelligence.extracted.areaText || null,
      ready_for_quote: Boolean(leadCompleteness.ready_for_quote),
      missing_fields: Array.isArray(leadCompleteness.missing_fields) ? leadCompleteness.missing_fields : [],
      missing_operational_fields: Array.isArray(leadCompleteness.missing_operational_fields)
        ? leadCompleteness.missing_operational_fields
        : [],
    };
    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: quoteEventType,
      customerId: leadId,
      payload: quotePayload,
      idempotencyKey: await buildEventIdempotencyKey([
        quoteEventType,
        normalized.conversationId,
        quotePayload.service_id || "",
        quotePayload.vehicle_id || quotePayload.vehicle_text || "",
        quotePayload.area_id || quotePayload.area_text || "",
      ]),
    }));
  }

  if (intelligence.nextBestClose?.strategy_id) {
    eventWrites.push(writeAiEventSafely({
      normalized,
      trace,
      type: "sales.decision",
      customerId: leadId,
      payload: {
        strategy_id: intelligence.nextBestClose.strategy_id,
        assistant_goal: intelligence.nextBestClose.assistant_goal || null,
        must_ask: Array.isArray(intelligence.nextBestClose.must_ask) ? intelligence.nextBestClose.must_ask : [],
        must_avoid: Array.isArray(intelligence.nextBestClose.must_avoid) ? intelligence.nextBestClose.must_avoid : [],
        suggested_options: Array.isArray(intelligence.nextBestClose.suggested_options)
          ? intelligence.nextBestClose.suggested_options
          : [],
        handoff_required: Boolean(intelligence.nextBestClose.handoff_required),
        sales_stage: intelligence.leadCompleteness?.sales_stage || intelligence.stage || null,
      },
      idempotencyKey: await buildEventIdempotencyKey([
        "sales.decision",
        normalized.conversationId,
        intelligence.nextBestClose.strategy_id,
        intelligence.leadCompleteness?.sales_stage || "",
      ]),
    }));
  }

  await Promise.all(eventWrites);
  logSpan(trace, "persistence.write", "ok", {
    target: "events",
    event_count: eventWrites.length,
    event_types: [
      ...(resolvedRefs.area?.id || intelligence.extracted.areaText ? ["area.resolved"] : []),
      ...(syncStatus.requestedDate || syncStatus.requestedTime ? ["calendar.resolved"] : []),
      ...(leadId && Number(intelligence.qualificationScore || 0) >= 60 ? ["lead.qualified"] : []),
      ...(bookingRef?.id ? [bookingRef.status === "confirmed" ? "booking.confirmed" : "booking.saved"] : []),
      ...signalEvents.map((event) => String(event.type)),
      ...(objection?.objection_id && !signalEventTypes.has("objection.detected") ? ["objection.detected"] : []),
      ...(intelligence.rawSignals?.priceSent ? [intelligence.leadCompleteness?.ready_for_quote ? "quote.presented" : "price_first.violation"] : []),
      ...(intelligence.nextBestClose?.strategy_id ? ["sales.decision"] : []),
    ],
  });
}

async function writeAiEventSafely({
  normalized,
  trace = null,
  type,
  payload,
  customerId = null,
  idempotencyKey = null,
}: {
  normalized: ReturnType<typeof normalizePayload>;
  trace?: TraceContext | null;
  type: AiEventType;
  payload: Record<string, unknown>;
  customerId?: string | null;
  idempotencyKey?: string | null;
}) {
  try {
    return await writeEvent(supabase, {
      tenantId: normalized.businessId || normalized.inboxName || "polesheadlamp",
      conversationId: normalized.conversationId,
      customerId,
      type,
      payload,
      idempotencyKey,
      traceId: trace?.traceId || normalized.traceId || null,
      source: "cekat-conversation-sync",
    });
  } catch (error) {
    if (trace) {
      logError(trace, "persistence.write", error, {
        target: "events",
        event_type: type,
      });
    } else {
      console.error(
        "cekat-conversation-sync event warning:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
}

async function writePreparedEventSafely(input: WriteEventInput, trace?: TraceContext | null) {
  try {
    return await writeEvent(supabase, {
      ...input,
      traceId: input.traceId || trace?.traceId || null,
    });
  } catch (error) {
    if (trace) {
      logError(trace, "persistence.write", error, {
        target: "events",
        event_type: input.type,
      });
    } else {
      console.error(
        "cekat-conversation-sync prepared event warning:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
}

async function loadReferenceData(): Promise<ReferenceData> {
  const [branchesRes, areasRes, servicesRes, vehiclesRes, usersRes] = await Promise.all([
    supabase.from("branches").select("id, name, city, address, radius, status").eq("status", "active"),
    supabase.from("areas").select("id, name, branch_id, status").eq("status", "active"),
    supabase.from("services").select("id, name, category, price, status").eq("status", "active"),
    supabase.from("vehicle_types").select("id, name, category, status").eq("status", "active"),
    supabase.from("users").select("id, name, role, status").eq("status", "active"),
  ]);

  for (const result of [branchesRes, areasRes, servicesRes, vehiclesRes, usersRes]) {
    if (result.error) throw result.error;
  }

  return {
    branches: branchesRes.data || [],
    areas: areasRes.data || [],
    services: servicesRes.data || [],
    vehicles: vehiclesRes.data || [],
    users: usersRes.data || [],
  };
}

function normalizePayload(payload: SyncPayload) {
  const conversation = asObject(payload.conversation) || payload;
  const intelligencePayload = asObject(payload.intelligence);
  const intelligenceExtracted = asObject(intelligencePayload?.extracted);
  const extracted =
    asObject(payload.extracted) ||
    intelligenceExtracted ||
    asObject(conversation.extracted) ||
    {};
  const booking = asObject(payload.booking) || asObject(conversation.booking) || {};
  const messages = normalizeMessages(
    asArray(payload.messages).length ? asArray(payload.messages) : asArray(conversation.messages),
    typeof payload.transcript === "string" ? payload.transcript : "",
    asString(conversation.first_message) || asString(payload.first_message),
    asString(conversation.created_at) || asString(payload.created_at),
  );
  const requestPath = asString(payload.__sync_path) || asString(payload.sync_path);
  const hasConversationEnvelope = Object.keys(asObject(payload.conversation) || {}).length > 0;
  const hasTranscriptPayload = messages.length > 0 || hasConversationEnvelope || Boolean(asString(payload.transcript).trim());
  const hasExplicitStructuredFields = [
    asString(payload.customerName),
    asString(payload.customer_name),
    asString(payload.phone_number),
    asString(payload.customer_phone),
    asString(payload.social_username),
    asString(payload.social_platform),
    asString(payload.source_account),
    asString(payload.schedule_date),
    asString(payload.schedule_time),
    asString(payload.platform_id),
    asString(payload.sub_channel_id),
    asString(payload.vehicle_text),
    asString(payload.address_text),
    asString(payload.maps_url),
    asString(payload.commit_mode),
  ].some((value) => value.trim().length > 0);
  const writeSource =
    requestPath.includes("/booking-capture") || (!hasTranscriptPayload && hasExplicitStructuredFields)
      ? "structured-write"
      : "transcript-sync";
  const normalizedCustomerPhone = normalizePhone(
    asString(conversation.customer_phone) ||
      asString(conversation.phone) ||
      asString(conversation.contact_phone) ||
      asString(payload.customerPhone) ||
      asString(payload.customer_phone) ||
      asString(payload.phone_number) ||
      asString(extracted.customerPhone) ||
      "",
  );
  const inferredSocialPlatform =
    asString(payload.social_platform) ||
    asString(payload.socialPlatform) ||
    inferSocialPlatform(
      [
        asString(payload.platform),
        asString(payload.sub_channel),
        asString(conversation.inboxes_name),
        asString(conversation.inbox_name),
      ]
        .filter(Boolean)
        .join(" "),
    );
  const normalizedSocialUsername =
    asString(conversation.social_username) ||
    asString(conversation.username) ||
    asString(payload.socialUsername) ||
    asString(payload.social_username) ||
    (inferredSocialPlatform === "whatsapp" ? normalizedCustomerPhone : "");

  return {
    traceId: asString(payload.__trace_id) || asString(payload.trace_id) || asString(payload.traceId),
    source: asString(payload.source) || "cekat",
    mode: asString(payload.mode) || "webhook",
    commitMode: asString(payload.commit_mode) || asString(payload.commitMode) || "",
    signals: normalizeCustomerSignals(
      asArray(payload.signals).length
        ? asArray(payload.signals)
        : asArray(asObject(payload.booking)?.signals).length
          ? asArray(asObject(payload.booking)?.signals)
          : asArray(asObject(payload.intelligence)?.signals),
    ),
    writeSource,
    syncPath: requestPath,
    businessId: asString(payload.businessId) || asString(conversation.business_id),
    conversationId: asString(payload.conversationId) || asString(payload.conversation_id) || asString(conversation.id),
    inboxId: asString(conversation.inbox_id) || asString(payload.inboxId) || asString(payload.inbox_id),
    inboxName: asString(conversation.inboxes_name) || asString(conversation.inbox_name) || asString(payload.inboxName) || asString(payload.inbox_name),
    contactId: asString(conversation.contact_id) || asString(payload.contactId) || asString(payload.contact_id),
    displayName:
      asString(conversation.display_name) ||
      asString(conversation.customer_name) ||
      asString(conversation.contact_name) ||
      asString(payload.customerName) ||
      asString(payload.customer_name) ||
      asString(payload.displayName) ||
      asString(payload.display_name),
    customerPhone: normalizedCustomerPhone,
    socialUsername: normalizedSocialUsername,
    socialPlatform: inferredSocialPlatform,
    socialProfileUrl:
      asString(payload.social_profile_url) ||
      asString(payload.socialProfileUrl) ||
      "",
    socialChatUrl:
      asString(payload.social_chat_url) ||
      asString(payload.socialChatUrl) ||
      "",
    sourceAccount:
      asString(payload.source_account) ||
      asString(payload.sourceAccount) ||
      asString(payload.inboxName) ||
      asString(payload.inbox_name) ||
      asString(conversation.inboxes_name) ||
      asString(conversation.inbox_name),
    leadStatusIntent:
      asString(payload.lead_status) ||
      asString(payload.leadStatus) ||
      asString(payload.status_intent) ||
      asString(payload.statusIntent),
    createdAt: asString(conversation.created_at) || new Date().toISOString(),
    lastMessageAt:
      asString(conversation.last_message_at) ||
      asString(conversation.updated_at) ||
      new Date().toISOString(),
    stageStatus: asString(conversation.stage_status),
    aiHandoffAt: asString(conversation.ai_handoff_at),
    handledBy: asString(conversation.handled_by) || asString(payload.handled_by),
    messages,
    extracted: {
      vehicleText: asString(payload.vehicle_text) || asString(payload.vehicleText) || asString(extracted.vehicleText) || asString(booking.vehicleText),
      areaText: asString(payload.area_text) || asString(payload.areaText) || asString(extracted.areaText) || asString(booking.areaText),
      addressText: asString(payload.address_text) || asString(payload.addressText) || asString(extracted.address) || asString(booking.address),
      scheduleDate: asString(payload.schedule_date) || asString(payload.scheduleDate) || asString(extracted.scheduleDate) || asString(booking.scheduleDate),
      scheduleTime: asString(payload.schedule_time) || asString(payload.scheduleTime) || asString(extracted.scheduleTime) || asString(booking.scheduleTime),
      customerName:
        asString(payload.customer_name) ||
        asString(payload.customerName) ||
        asString(extracted.customerName) ||
        asString(extracted.name) ||
        asString(booking.customerName),
      customerPhone: normalizePhone(
        asString(payload.customer_phone) ||
          asString(payload.customerPhone) ||
          asString(payload.phone_number) ||
          asString(extracted.customerPhone) ||
          asString(extracted.phone) ||
          asString(booking.customerPhone),
      ),
      notes: asString(payload.notes) || asString(payload.note) || asString(extracted.notes) || asString(booking.notes),
      mapsUrl: asString(payload.maps_url) || asString(payload.mapsUrl) || asString(extracted.mapsUrl) || asString(booking.mapsUrl),
      serviceText: asString(payload.service_text) || asString(payload.serviceText) || asString(extracted.serviceText) || asString(booking.serviceText),
      platformId:
        asString(payload.platform_id) ||
        asString(extracted.platformId) ||
        inferPlatformId(
          asString(payload.platform) ||
            asString(conversation.inboxes_name) ||
            asString(payload.inboxName) ||
            asString(payload.inbox_name),
        ),
      subChannelId:
        asString(payload.sub_channel_id) ||
        asString(extracted.subChannelId) ||
        inferSubChannelId(
          asString(payload.sub_channel) ||
            asString(payload.platform) ||
            asString(conversation.inboxes_name) ||
            asString(payload.inboxName) ||
            asString(payload.inbox_name),
        ),
      advertiserId:
        asString(payload.advertiser_id) ||
        asString(payload.advertiserId) ||
        asString(extracted.advertiserId),
      csId: asString(payload.cs_id) || asString(payload.csId) || asString(extracted.csId) || asString(booking.csId),
    },
    booking: {
      customerName: asString(payload.customer_name) || asString(payload.customerName) || asString(booking.customerName),
      customerPhone: normalizePhone(
        asString(payload.customer_phone) ||
          asString(payload.customerPhone) ||
          asString(payload.phone_number) ||
          asString(booking.customerPhone),
      ),
      scheduleDate: asString(payload.schedule_date) || asString(payload.scheduleDate) || asString(booking.scheduleDate),
      scheduleTime: asString(payload.schedule_time) || asString(payload.scheduleTime) || asString(booking.scheduleTime),
      branchId: asString(payload.branch_id) || asString(payload.branchId) || asString(booking.branchId),
      areaId: asString(payload.area_id) || asString(payload.areaId) || asString(booking.areaId),
      address: asString(payload.address_text) || asString(payload.addressText) || asString(booking.address),
      mapsUrl: asString(payload.maps_url) || asString(payload.mapsUrl) || asString(booking.mapsUrl),
      notes: asString(payload.notes) || asString(payload.note) || asString(booking.notes),
      status: asString(payload.status) || asString(booking.status),
      statusIntent:
        asString(payload.booking_status_intent) ||
        asString(payload.bookingStatusIntent) ||
        asString(payload.status_intent) ||
        asString(payload.statusIntent),
      serviceId: asString(payload.service_id) || asString(payload.serviceId) || asString(booking.serviceId),
      vehicleId: asString(payload.vehicle_id) || asString(payload.vehicleId) || asString(booking.vehicleId),
      technicianId: asString(booking.technicianId),
      advertiserId: asString(payload.advertiser_id) || asString(payload.advertiserId) || "",
      platformId:
        asString(payload.platform_id) ||
        inferPlatformId(
          asString(payload.platform) ||
            asString(conversation.inboxes_name) ||
            asString(payload.inboxName) ||
            asString(payload.inbox_name),
        ),
      subChannelId:
        asString(payload.sub_channel_id) ||
        inferSubChannelId(
          asString(payload.sub_channel) ||
            asString(payload.platform) ||
            asString(conversation.inboxes_name) ||
            asString(payload.inboxName) ||
            asString(payload.inbox_name),
        ),
      csId: asString(payload.cs_id) || asString(payload.csId) || asString(booking.csId),
    },
  };
}

function deriveIntelligence(normalized: ReturnType<typeof normalizePayload>) {
  const allText = normalized.messages.map((message) => message.text).join("\n");
  const customerText = normalized.messages
    .filter((message) => message.senderRole === "customer")
    .map((message) => message.text)
    .join("\n");
  const adminText = normalized.messages
    .filter((message) => message.senderRole !== "customer")
    .map((message) => message.text)
    .join("\n");
  const attachmentCount = normalized.messages.reduce((sum, message) => sum + message.attachments.length, 0);
  const accumulatedProfile = accumulateCustomerProfile(normalized.messages, normalized);
  const confirmedAdminProfile = extractConfirmedAdminProfile(normalized.messages);

  const extractedName =
    normalized.booking.customerName ||
    extractName(customerText) ||
    accumulatedProfile.customerName ||
    confirmedAdminProfile.customerName ||
    normalized.extracted.customerName ||
    (isConfidentCustomerName(normalized.displayName, normalized.socialUsername) ? normalized.displayName : "");
  const extractedPhone =
    normalized.booking.customerPhone ||
    accumulatedProfile.customerPhone ||
    extractPhone(customerText) ||
    confirmedAdminProfile.customerPhone ||
    normalized.customerPhone ||
    normalized.extracted.customerPhone;
  const extractedVehicle =
    accumulatedProfile.vehicleText ||
    normalized.extracted.vehicleText ||
    extractVehicle(customerText || allText);
  const extractedAddress = resolveConversationAddress({
    bookingAddress: normalized.booking.address,
    customerAddress: extractAddress(customerText),
    accumulatedAddress: accumulatedProfile.addressText,
    confirmedAdminAddress: confirmedAdminProfile.addressText,
    payloadAddress: normalized.extracted.addressText,
    adminAddress: extractAddress(adminText),
    areaText: accumulatedProfile.areaText || normalized.extracted.areaText || "",
  });
  const extractedAreaRaw =
    normalized.booking.areaId ||
    accumulatedProfile.areaText ||
    extractArea(customerText) ||
    normalized.extracted.areaText ||
    extractArea(customerText || allText);
  const extractedArea = sanitizeExtractedArea({
    candidate: extractedAreaRaw,
    customerText,
    addressText: extractedAddress,
    fallbackAreaText: accumulatedProfile.areaText || normalized.extracted.areaText || "",
  });
  const extractedDate =
    normalized.booking.scheduleDate ||
    confirmedAdminProfile.scheduleDate ||
    accumulatedProfile.scheduleDate ||
    extractDate(customerText) ||
    normalized.extracted.scheduleDate ||
    extractDate(adminText);
  const extractedTime = normalizeRequestedScheduleTime(
    normalized.booking.scheduleTime ||
      confirmedAdminProfile.scheduleTime ||
      accumulatedProfile.scheduleTime ||
      extractTime(customerText) ||
      normalized.extracted.scheduleTime ||
      extractTime(adminText),
  );
  const extractedMapsUrl =
    normalized.booking.mapsUrl ||
    accumulatedProfile.mapsUrl ||
    confirmedAdminProfile.mapsUrl ||
    extractMapsUrl(customerText || allText) ||
    normalized.extracted.mapsUrl;
  const conditionHits = detectConditions(allText);
  const fieldConfidence = buildFieldConfidence({
    normalized,
    accumulatedProfile,
    extractedName,
    extractedPhone,
    extractedVehicle,
    extractedArea,
    extractedAddress,
    extractedDate,
    extractedTime,
    extractedMapsUrl,
  });
  const conversationMemory = buildConversationMemory({
    normalized,
    accumulatedProfile,
    confirmedAdminProfile,
    extracted: {
      customerName: extractedName,
      customerPhone: normalizePhone(extractedPhone),
      vehicleText: extractedVehicle,
      areaText: extractedArea,
      addressText: extractedAddress,
      scheduleDate: extractedDate,
      scheduleTime: extractedTime,
      mapsUrl: extractedMapsUrl || "",
    },
    fieldConfidence,
  });

  const limitationDisclosed = /tidak bisa hilang total|tidak bisa hilang sempurna|bagian dalam|tanpa bongkar|fokus di bagian luar/i.test(adminText);
  const priceSent = /rp\s?(?:300|350|400)\.?000|(?:300|350|400)\.?000|sepasang headlamp|nano coating/i.test(adminText);
  const slotOffered = /hari ini|besok|weekend|jadwal|tanggal|amankan slot|slot kosong/i.test(adminText);
  const urgencySent = /padat|sebelum penuh|slot sementara|khususnya weekend/i.test(adminText);
  const bookingFieldsRequested = /atas nama siapa|alamat lengkap|nomor whatsapp|no whatsapp/i.test(adminText);
  const bookingConfirmed = /sudah.*amankan|nanti kami konfirmasi sehari sebelum/i.test(adminText);
  const complaintRisk = /komplain|keluhan|kecewa|ga puas|tidak puas|hasil tidak sesuai|teknisi tidak datang/i.test(allText);
  const softDropRisk = /nanti kabarin|save dulu|simpan infonya|nanti saya dm lagi|nanti aku kontak/i.test(customerText);
  const priceObjection = /mahal|diskon|nego|kurangin|boleh kurang/i.test(customerText);
  const scheduleObjection = /ga bisa|gabisa|tidak bisa|jadwal bentrok|hari ini gabisa|tanggal itu tidak bisa/i.test(customerText);
  const coverageObjection = /lokasi|domisili|area|wilayah|cover|bisa ke sini/i.test(customerText);
  const handoffDetected = Boolean(normalized.aiHandoffAt) || /human|cs asli|agent manusia/i.test(allText);

  const labels = new Set<string>();
  if (extractedVehicle) labels.add("vehicle_captured");
  if (extractedArea) labels.add("area_captured");
  if (conditionHits.length > 0) labels.add("condition_captured");
  if (attachmentCount > 0) labels.add("photo_received");
  if (limitationDisclosed) labels.add("limitation_disclosed");
  if (priceSent) labels.add("pricing_sent");
  if (slotOffered) labels.add("slot_offered");
  if (urgencySent) labels.add("urgency_used");
  if (bookingFieldsRequested) labels.add("booking_fields_requested");
  if (bookingConfirmed) labels.add("booking_confirmed");
  if (complaintRisk) labels.add("complaint_risk");
  if (softDropRisk) labels.add("soft_drop_risk");
  if (priceObjection) labels.add("price_objection");
  if (scheduleObjection) labels.add("schedule_objection");
  if (coverageObjection) labels.add("coverage_objection");
  if (handoffDetected) labels.add("handoff");
  if (extractedName) labels.add("name_captured");
  if (extractedPhone) labels.add("phone_captured");
  if (extractedAddress) labels.add("address_captured");
  if (extractedDate) labels.add("date_captured");
  if (extractedTime) labels.add("time_captured");

  const qualificationScore =
    score(extractedVehicle, 15) +
    score(extractedArea, 15) +
    score(conditionHits.length > 0, 20) +
    score(attachmentCount > 0, 10) +
    score(limitationDisclosed, 15) +
    score(priceSent, 10) +
    score(slotOffered, 15);
  const bookingCompletenessScore =
    score(extractedName, 15) +
    score(extractedPhone, 20) +
    score(extractedAddress, 20) +
    score(extractedDate, 20) +
    score(extractedTime, 10) +
    score(extractedVehicle, 10) +
    score(extractedArea, 5);
  const closingStrengthScore =
    score(priceSent, 25) +
    score(slotOffered, 30) +
    score(urgencySent, 15) +
    score(bookingFieldsRequested, 20) +
    score(bookingConfirmed, 10);

  const operationallyScheduleLocked =
    Boolean(extractedVehicle) &&
    Boolean(extractedArea) &&
    Boolean(extractedDate) &&
    isAllowedSlotTime(extractedTime);
  const operationallyStrongBookingSignal =
    operationallyScheduleLocked &&
    Boolean(extractedName) &&
    Boolean(extractedPhone) &&
    Boolean(extractedAddress);

  let stage = "new_inquiry";
  if (complaintRisk) stage = "complaint";
  else if (bookingConfirmed && operationallyStrongBookingSignal) stage = "booking_confirmed";
  else if (bookingConfirmed || bookingFieldsRequested || operationallyScheduleLocked || bookingCompletenessScore >= 65) {
    stage = "booking_capture";
  }
  else if (slotOffered) stage = "schedule_offer";
  else if (priceSent) stage = "pricing";
  else if (conditionHits.length > 0 || attachmentCount > 0) stage = "qualification";
  else if (extractedVehicle || extractedArea) stage = "lead_qualified";

  let outcome = "in_progress";
  if (complaintRisk) outcome = "complaint";
  else if (bookingConfirmed && operationallyStrongBookingSignal) outcome = "booked";
  else if (softDropRisk) outcome = "soft_drop";
  else if (priceObjection) outcome = "objection_price";
  else if (scheduleObjection) outcome = "objection_schedule";
  else if (coverageObjection && !slotOffered) outcome = "objection_coverage";
  else if (
    operationallyScheduleLocked &&
    (bookingConfirmed || bookingFieldsRequested || (priceSent && slotOffered))
  ) {
    outcome = "ready_to_close";
  }

  const nextBestAction = selectNextBestAction({
    complaintRisk,
    bookingConfirmed,
    bookingFieldsRequested,
    bookingCompletenessScore,
    slotOffered,
    priceSent,
    extractedVehicle,
    extractedArea,
    attachmentCount,
    conditionHits,
    limitationDisclosed,
    handoffDetected,
  });

  return {
    stage,
    outcome,
    labels: [...labels].sort(),
    qualificationScore,
    bookingCompletenessScore,
    closingStrengthScore,
    limitationDisclosed,
    conditionHits,
    nextBestAction,
    extracted: {
      customerName: extractedName,
      customerPhone: normalizePhone(extractedPhone),
      vehicleText: extractedVehicle,
      vehicleId: normalized.booking.vehicleId || "",
      branchId: normalized.booking.branchId || "",
      areaId: normalized.booking.areaId || "",
      areaText: extractedArea,
      addressText: extractedAddress,
      scheduleDate: extractedDate,
      scheduleTime: extractedTime,
      serviceText: normalized.extracted.serviceText || "",
      serviceId: normalized.booking.serviceId || "",
      platformId: normalized.extracted.platformId || "",
      subChannelId: normalized.extracted.subChannelId || "",
      notes: normalized.extracted.notes || "",
      mapsUrl: extractedMapsUrl || "",
    },
    rawSignals: {
      priceSent,
      slotOffered,
      urgencySent,
      bookingFieldsRequested,
      bookingConfirmed,
      complaintRisk,
      softDropRisk,
      priceObjection,
      scheduleObjection,
      coverageObjection,
      handoffDetected,
      attachmentCount,
    },
    memory: conversationMemory,
    fieldConfidence,
  };
}

function normalizeVehicleVariantKey(value: string) {
  return normalizeText(value)
    .replace(/\btahun\b/g, " ")
    .replace(/\btype\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVehicleBrand(name: string) {
  return cleanFragment(asString(name).split(" - ")[0] || "");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingBrand(value: string, brand: string) {
  const cleaned = cleanFragment(value);
  if (!cleaned || !brand) return cleaned;
  return cleaned.replace(new RegExp(`^${escapeRegex(brand)}\\s+`, "i"), "").trim();
}

function canonicalizeVehicleVariantName(vehicleText: string, genericMatch: ReferenceData["vehicles"][number] | null) {
  const cleaned = cleanFragment(vehicleText).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const genericBrand = extractVehicleBrand(genericMatch?.name || "");
  if (!genericBrand) return cleaned;
  const withoutBrand = stripLeadingBrand(cleaned, genericBrand);
  return `${genericBrand} - ${withoutBrand || cleaned}`;
}

async function resolveVehicleReference(intelligence: any, refs: ReferenceData) {
  if (intelligence.extracted.vehicleId) {
    return refs.vehicles.find((item) => item.id === intelligence.extracted.vehicleId) || null;
  }

  const vehicleText = asString(intelligence.extracted.vehicleText);
  if (!vehicleText) return null;

  const normalizedVehicleKey = normalizeVehicleVariantKey(vehicleText);
  const exactVehicle =
    refs.vehicles.find((item) => normalizeVehicleVariantKey(asString(item.name)) === normalizedVehicleKey) ||
    refs.vehicles.find((item) => {
      const candidateKey = normalizeVehicleVariantKey(asString(item.name));
      return candidateKey.endsWith(normalizedVehicleKey) || normalizedVehicleKey.endsWith(candidateKey);
    });
  if (exactVehicle) return exactVehicle;

  if (!isStrongVehicleCandidate(vehicleText)) {
    return null;
  }

  const genericVehicle = findBestMatch(refs.vehicles, vehicleText, ["name", "category"]);
  const canonicalVehicleName = canonicalizeVehicleVariantName(vehicleText, genericVehicle || null);
  if (!canonicalVehicleName) {
    return null;
  }

  const normalizedCanonicalKey = normalizeVehicleVariantKey(canonicalVehicleName);
  const existingCanonical =
    refs.vehicles.find((item) => normalizeVehicleVariantKey(asString(item.name)) === normalizedCanonicalKey) ||
    refs.vehicles.find((item) => {
      const candidateKey = normalizeVehicleVariantKey(asString(item.name));
      return candidateKey.endsWith(normalizedCanonicalKey) || normalizedCanonicalKey.endsWith(candidateKey);
    });
  if (existingCanonical) return existingCanonical;

  const { data, error } = await supabase
    .from("vehicle_types")
    .insert({
      id: crypto.randomUUID(),
      name: canonicalVehicleName,
      category: genericVehicle?.category || "medium",
      status: "active",
    })
    .select("id, name, category, status")
    .single();
  if (error) {
    console.error("resolveVehicleReference insert failed", error);
    return null;
  }

  refs.vehicles.push(data);
  return data;
}

async function resolveReferenceMatches(intelligence: any, refs: ReferenceData) {
  const normalizedAreaQuery = normalizeText(intelligence.extracted.areaText || "");
  const branchDirectMatch = normalizedAreaQuery
    ? refs.branches.find((item) => {
        const candidates = [item.name, item.city, item.address]
          .map((value) => normalizeText(asString(value)))
          .filter(Boolean);
        return candidates.some((value) =>
          value === normalizedAreaQuery ||
          value.startsWith(normalizedAreaQuery) ||
          normalizedAreaQuery.startsWith(value) ||
          value.includes(normalizedAreaQuery),
        );
      })
    : null;

  const branch = intelligence.extracted.branchId
    ? refs.branches.find((item) => item.id === intelligence.extracted.branchId)
    : branchDirectMatch || findBestMatch(refs.branches, intelligence.extracted.areaText, ["name", "city", "address"]);

  const areaPool = branch ? refs.areas.filter((item) => item.branch_id === branch.id) : refs.areas;
  const areaDirectMatch = normalizedAreaQuery
    ? areaPool.find((item) => {
        const value = normalizeText(asString(item.name));
        return value === normalizedAreaQuery || value.includes(normalizedAreaQuery) || normalizedAreaQuery.includes(value);
      })
    : null;
  const area = intelligence.extracted.areaId
    ? refs.areas.find((item) => item.id === intelligence.extracted.areaId)
    : areaDirectMatch || findBestMatch(areaPool, intelligence.extracted.areaText, ["name"]);

  const service = intelligence.extracted.serviceId
    ? refs.services.find((item) => item.id === intelligence.extracted.serviceId)
    : findBestMatch(refs.services, intelligence.extracted.serviceText || "poles headlamp", ["name", "category"]);

  const vehicle = await resolveVehicleReference(intelligence, refs);

  return { branch, area, service, vehicle };
}

function mergeResolvedReferences(
  baseResolvedRefs: any,
  slotResolution: any,
  refs: ReferenceData,
  areaText: string,
) {
  if (!slotResolution?.branch) {
    return {
      ...baseResolvedRefs,
      technicianId: baseResolvedRefs.technicianId || null,
    };
  }

  const areaPool = refs.areas.filter((item) => item.branch_id === slotResolution.branch.id);
  const slotArea = findBestMatch(areaPool, areaText, ["name"]);

  return {
    ...baseResolvedRefs,
    branch: slotResolution.branch,
    area: slotArea || baseResolvedRefs.area,
    technicianId: slotResolution.technicianId || baseResolvedRefs.technicianId || null,
  };
}

async function resolveBookingSlot({
  refs,
  areaText,
  scheduleDate,
  scheduleTime,
}: {
  refs: ReferenceData;
  areaText: string;
  scheduleDate: string;
  scheduleTime: string;
}) {
  if (!supabaseUrl || !availabilityApiKey || !areaText || !scheduleDate) return null;

  const url = new URL(`${supabaseUrl}/functions/v1/cekat-availability/availability`);
  url.searchParams.set("area", areaText);
  url.searchParams.set("date", scheduleDate);
  if (scheduleTime) url.searchParams.set("time", scheduleTime);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${availabilityApiKey}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !payload?.branch?.id) return null;

    const branch = refs.branches.find((item) => item.id === payload.branch.id) || null;
    if (!branch) return null;

    const technicianId = Array.isArray(payload.technicianBreakdown)
      ? payload.technicianBreakdown.find((item: Record<string, unknown>) =>
          asString(item.status) === "available" && Number(item.remainingCapacity || 0) > 0
        )?.id || null
      : null;

    return {
      branch,
      technicianId,
      raw: payload,
    };
  } catch (error) {
    console.error("resolveBookingSlot warning:", error);
    return null;
  }
}

async function resolveCsId(payload: SyncPayload, users: Array<Record<string, any>>) {
  const directCsId =
    asString(asObject(payload.booking)?.csId) ||
    asString(asObject(payload.extracted)?.csId) ||
    defaultCsId;
  if (directCsId) return directCsId;

  const localMatch = users.find(
    (user) =>
      String(user.role || "").toLowerCase() === "cs" &&
      normalizeText(user.name).includes(normalizeText(defaultCsName)),
  );
  if (localMatch?.id) return localMatch.id;

  const { data, error } = await supabase
    .from("users")
    .select("id, name, role, status")
    .eq("status", "active")
    .eq("role", "CS")
    .ilike("name", `%${defaultCsName}%`)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function upsertLead(
  normalized: ReturnType<typeof normalizePayload>,
  intelligence: any,
  resolvedRefs: any,
  existingLeadId: string | null,
  csId: string | null,
) {
  const phone = intelligence.extracted.customerPhone || normalized.customerPhone;
  const socialUsername = normalized.socialUsername || "";

  let lead = null;
  if (existingLeadId) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, phone, notes, status, platform_id, sub_channel_id, advertiser_id, cs_id, vehicle_id, social_platform, social_username, social_profile_url, social_chat_url")
      .eq("id", existingLeadId)
      .maybeSingle();
    if (error) throw error;
    lead = data;
  }

  if (!lead && phone) {
    const phoneVariants = buildPhoneVariants(phone);
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, phone, notes, status, platform_id, sub_channel_id, advertiser_id, cs_id, vehicle_id, social_platform, social_username, social_profile_url, social_chat_url")
      .in("phone", phoneVariants)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    lead = data;
  }

  if (!lead && phone) {
    const phoneDigits = normalizePhone(phone);
    const fuzzyDigits = phoneDigits.slice(-10);
    if (fuzzyDigits) {
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, phone, notes, status, platform_id, sub_channel_id, advertiser_id, cs_id, vehicle_id, social_platform, social_username, social_profile_url, social_chat_url")
        .ilike("phone", `%${fuzzyDigits}%`)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      lead = data;
    }
  }

  const safeCustomerName = selectBestCustomerName({
    extractedCustomerName: intelligence.extracted.customerName,
    displayName: normalized.displayName,
    socialUsername: normalized.socialUsername,
    existingName: lead?.name || "",
  });
  const shouldCreateLead =
    Boolean(phone || socialUsername) &&
    (
      normalized.writeSource === "structured-write" ||
      Boolean(resolvedRefs.vehicle?.id) ||
      Boolean(intelligence.extracted.areaText) ||
      Boolean(intelligence.extracted.addressText) ||
      Boolean(intelligence.extracted.scheduleDate && intelligence.extracted.scheduleTime) ||
      intelligence.qualificationScore >= 35
    );

  if (!lead && !shouldCreateLead) {
    return null;
  }

  const leadMissingFields = deriveMissingFields({ intelligence, resolvedRefs });
  const leadBuyerFacingMissingFields = deriveBuyerFacingRequiredFields(leadMissingFields);
  const explicitLeadStatusIntent = normalized.leadStatusIntent || "";
  const explicitBookingStatusIntent = normalized.booking.statusIntent || "";
  const inferredStatus = inferLeadStatus(intelligence, explicitLeadStatusIntent, explicitBookingStatusIntent);
  const status =
    inferredStatus === "Booking" &&
    !hasConcreteBookingWorkflowSignal(intelligence, explicitBookingStatusIntent) &&
    leadBuyerFacingMissingFields.length > 0
      ? "Closing"
      : inferredStatus;
  const now = new Date().toISOString();
  const notes = selectPreferredSyncNotes({
    existingNotes: asString(lead?.notes),
    nextNotes: buildLeadNotes(normalized, intelligence),
    conversationId: normalized.conversationId,
  });
  const trustedExistingLeadName = isConfidentCustomerName(asString(lead?.name), socialUsername)
    ? asString(lead?.name)
    : "";
  const payload = {
    id: lead?.id || crypto.randomUUID(),
    name: safeCustomerName || trustedExistingLeadName || deriveDraftLeadName(normalized),
    phone: phone || lead?.phone || "",
    status,
    notes,
    platform_id: normalized.extracted.platformId || normalized.booking.platformId || lead?.platform_id || defaultPlatformId || null,
    sub_channel_id: normalized.extracted.subChannelId || normalized.booking.subChannelId || lead?.sub_channel_id || defaultSubChannelId || null,
    advertiser_id: normalized.extracted.advertiserId || normalized.booking.advertiserId || lead?.advertiser_id || defaultAdvertiserId || null,
    cs_id: csId || lead?.cs_id || defaultCsId || null,
    vehicle_id:
      normalized.booking.vehicleId ||
      lead?.vehicle_id ||
      resolvedRefs.vehicle?.id ||
      (intelligence.extracted.vehicleText ? null : null),
    social_platform: normalized.socialPlatform || lead?.social_platform || null,
    social_username: socialUsername || lead?.social_username || null,
    social_profile_url: normalized.socialProfileUrl || lead?.social_profile_url || null,
    social_chat_url: normalized.socialChatUrl || lead?.social_chat_url || null,
    last_contact: normalized.lastMessageAt || now,
  };

  if (!payload.phone) {
    return null;
  }

  const query = lead
    ? supabase.from("leads").update(payload).eq("id", payload.id).select().single()
    : supabase.from("leads").insert(payload).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function deriveDraftLeadName(normalized: ReturnType<typeof normalizePayload>) {
  const bookingCustomerName = cleanFragment(
    normalized.booking.customerName || normalized.extracted.customerName || "",
  );
  if (
    bookingCustomerName &&
    isConfidentCustomerName(bookingCustomerName, normalized.socialUsername)
  ) {
    return bookingCustomerName;
  }

  const displayName = cleanFragment(normalized.displayName || "");
  if (displayName && !looksLikeGreetingOnlyName(displayName) && !looksLikeNonNameCustomerPhrase(displayName)) {
    return displayName;
  }

  const socialUsername = compactText(normalized.socialUsername || "");
  if (socialUsername) {
    return socialUsername.startsWith("@") ? socialUsername : `@${socialUsername}`;
  }

  const phone = normalizePhone(normalized.customerPhone || "");
  if (phone) {
    return "Belum Isi Nama";
  }

  return "Belum Isi Nama";
}

async function upsertProspectBooking(
  normalized: ReturnType<typeof normalizePayload>,
  intelligence: any,
  resolvedRefs: any,
  leadId: string | null,
  existingBookingId: string | null,
  csId: string | null,
) {
  if (!leadId) return null;

  const bookingCustomerPhone = intelligence.extracted.customerPhone || normalized.booking.customerPhone || normalized.customerPhone || null;
  const bookingCustomerName =
    selectBestCustomerName({
      extractedCustomerName: intelligence.extracted.customerName || normalized.booking.customerName || "",
      displayName: normalized.displayName,
      socialUsername: normalized.socialUsername,
      existingName: "",
    }) || null;
  const bookingScheduleDate = intelligence.extracted.scheduleDate || normalized.booking.scheduleDate || normalized.extracted.scheduleDate || null;
  const bookingScheduleTime = intelligence.extracted.scheduleTime || normalized.booking.scheduleTime || normalized.extracted.scheduleTime || null;
  const bookingMapsUrl = intelligence.extracted.mapsUrl || normalized.booking.mapsUrl || null;
  const bookingAddress = intelligence.extracted.addressText || normalized.booking.address || null;
  const bookingVehicleId =
    resolvedRefs.vehicle?.id ||
    (intelligence.extracted.vehicleText ? null : normalized.booking.vehicleId || null);
  const explicitBookingStatus = normalizeBookingStatusIntent(normalized.booking.statusIntent || normalized.booking.status);
  const normalizedCommitMode = normalizeText(normalized.commitMode || normalized.mode);
  const coreReady =
    Boolean(bookingCustomerPhone) &&
    Boolean(bookingCustomerName) &&
    Boolean(bookingScheduleDate) &&
    Boolean(bookingScheduleTime) &&
    isAllowedSlotTime(bookingScheduleTime) &&
    Boolean(resolvedRefs.branch?.id) &&
    isCompleteAddressText(bookingAddress || "");
  const finalReady = coreReady && Boolean(bookingVehicleId);
  const allowDraftBooking = coreReady;

  if (!allowDraftBooking) {
    if (bookingMapsUrl) {
      return await attachMapsToExistingBooking({
        leadId,
        scheduleDate: bookingScheduleDate,
        mapsUrl: bookingMapsUrl,
      });
    }
    return null;
  }

  let booking = null;
  if (existingBookingId) {
    const { data, error } = await supabase
      .from("prospect_bookings")
      .select("id, lead_id, order_id, customer_name, customer_phone, schedule_date, schedule_time, branch_id, area_id, address, maps_url, notes, status, cs_id, advertiser_id, technician_id, vehicle_id, platform_id, sub_channel_id, service_id")
      .eq("id", existingBookingId)
      .maybeSingle();
    if (error) throw error;
    booking = data;
  }

  if (!booking) {
    booking = await findBestExistingBookingMatch({
      leadId,
      conversationId: normalized.conversationId,
      customerName: bookingCustomerName,
      customerPhone: bookingCustomerPhone,
      scheduleDate: bookingScheduleDate,
      scheduleTime: bookingScheduleTime,
      branchId: resolvedRefs.branch?.id || null,
      addressText: bookingAddress || "",
    });
  }

  if (!booking && normalized.conversationId) {
    const { data, error } = await supabase
      .from("prospect_bookings")
      .select("id, lead_id, order_id, customer_name, customer_phone, schedule_date, schedule_time, branch_id, area_id, address, maps_url, notes, status, cs_id, advertiser_id, technician_id, vehicle_id, platform_id, sub_channel_id, service_id")
      .ilike("notes", `%conversation=${normalized.conversationId}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    booking = data;
  }

  if (!booking) {
    const { data, error } = await supabase
      .from("prospect_bookings")
      .select("id, lead_id, order_id, customer_name, customer_phone, schedule_date, schedule_time, branch_id, area_id, address, maps_url, notes, status, cs_id, advertiser_id, technician_id, vehicle_id, platform_id, sub_channel_id, service_id")
      .eq("lead_id", leadId)
      .eq("schedule_date", bookingScheduleDate)
      .eq("schedule_time", bookingScheduleTime)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    booking = data;
  }

  const autoAssignedTechnicianId =
    normalized.booking.technicianId ||
    resolvedRefs.technicianId ||
    booking?.technician_id ||
    (await assignTechnicianForBooking({
      branchId: resolvedRefs.branch.id,
      scheduleDate: bookingScheduleDate,
      scheduleTime: bookingScheduleTime,
      bookingId: booking?.id || null,
      targetLocationText:
        bookingAddress ||
        intelligence.extracted.areaText ||
        "",
    }));

  const payload = {
    id: booking?.id || crypto.randomUUID(),
    lead_id: leadId,
    order_id: booking?.order_id || null,
    customer_name: bookingCustomerName,
    customer_phone: bookingCustomerPhone,
    schedule_date: bookingScheduleDate,
    schedule_time: bookingScheduleTime,
    branch_id: resolvedRefs.branch.id,
    area_id: resolvedRefs.area?.id || null,
    address: bookingAddress,
    maps_url: intelligence.extracted.mapsUrl || normalized.booking.mapsUrl || booking?.maps_url || null,
    notes: selectPreferredSyncNotes({
      existingNotes: asString(booking?.notes),
      nextNotes: buildBookingNotes(normalized, intelligence),
      conversationId: normalized.conversationId,
    }),
    status:
      explicitBookingStatus === "cancelled" || explicitBookingStatus === "reschedule"
        ? explicitBookingStatus
        : finalReady && normalizedCommitMode === "final"
          ? "confirmed"
          : explicitBookingStatus === "confirmed" && finalReady
            ? "confirmed"
        : "tentative",
    cs_id: csId || normalized.booking.csId || defaultCsId || null,
    advertiser_id: normalized.booking.advertiserId || normalized.extracted.advertiserId || booking?.advertiser_id || defaultAdvertiserId || null,
    technician_id: autoAssignedTechnicianId || null,
    vehicle_id: bookingVehicleId,
    platform_id: normalized.booking.platformId || normalized.extracted.platformId || booking?.platform_id || defaultPlatformId || null,
    sub_channel_id: normalized.booking.subChannelId || normalized.extracted.subChannelId || booking?.sub_channel_id || defaultSubChannelId || null,
    service_id: resolvedRefs.service?.id || normalized.booking.serviceId || null,
    updated_at: new Date().toISOString(),
  };

  const query = booking
    ? supabase.from("prospect_bookings").update(payload).eq("id", payload.id).select().single()
    : supabase.from("prospect_bookings").insert(payload).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function alignLeadFromBooking(lead: any, booking: any) {
  if (!lead?.id || !booking?.id) return lead;

  const patch: Record<string, unknown> = {};
  if (booking.vehicle_id && booking.vehicle_id !== lead.vehicle_id) {
    patch.vehicle_id = booking.vehicle_id;
  }
  const normalizedBookingStatus = normalizeBookingStatusIntent(booking.status);
  if (
    booking.id &&
    ["tentative", "confirmed"].includes(normalizedBookingStatus) &&
    lead.status !== "Booking"
  ) {
    patch.status = "Booking";
  }

  if (!Object.keys(patch).length) {
    return lead;
  }

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .select("id, name, phone, notes, status, platform_id, sub_channel_id, advertiser_id, cs_id, vehicle_id, social_platform, social_username, social_profile_url, social_chat_url")
    .single();
  if (error) throw error;
  return data;
}

async function findBestExistingBookingMatch({
  leadId,
  conversationId,
  customerName,
  customerPhone,
  scheduleDate,
  scheduleTime,
  branchId,
  addressText,
}: {
  leadId: string | null;
  conversationId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  scheduleDate: string | null;
  scheduleTime: string | null;
  branchId: string | null;
  addressText: string | null;
}) {
  if (!leadId || !scheduleDate) return null;

  const { data, error } = await supabase
    .from("prospect_bookings")
    .select("id, lead_id, order_id, customer_name, customer_phone, schedule_date, schedule_time, branch_id, area_id, address, maps_url, notes, status, cs_id, advertiser_id, technician_id, vehicle_id, platform_id, sub_channel_id, service_id, created_at, updated_at")
    .eq("lead_id", leadId)
    .eq("schedule_date", scheduleDate)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const ranked = (data || [])
    .map((candidate) => ({
      ...candidate,
      __score: scoreExistingBookingMatch({
        booking: candidate,
        conversationId,
        customerName,
        customerPhone,
        scheduleTime,
        branchId,
        addressText,
      }),
    }))
    .filter((candidate) => candidate.__score >= 60)
    .sort((left, right) => {
      if (right.__score !== left.__score) return right.__score - left.__score;
      const leftOpen = isOpenBookingStatus(left.status) ? 1 : 0;
      const rightOpen = isOpenBookingStatus(right.status) ? 1 : 0;
      if (rightOpen !== leftOpen) return rightOpen - leftOpen;
      return String(left.id).localeCompare(String(right.id));
    });

  return ranked[0] || null;
}

function scoreExistingBookingMatch({
  booking,
  conversationId,
  customerName,
  customerPhone,
  scheduleTime,
  branchId,
  addressText,
}: {
  booking: Record<string, unknown>;
  conversationId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  scheduleTime: string | null;
  branchId: string | null;
  addressText: string | null;
}) {
  let score = 0;

  const bookingPhone = normalizePhone(asString(booking.customer_phone));
  const targetPhone = normalizePhone(asString(customerPhone));
  if (bookingPhone && targetPhone && bookingPhone === targetPhone) score += 50;

  const bookingName = normalizePersonForMatch(asString(booking.customer_name));
  const targetName = normalizePersonForMatch(asString(customerName));
  if (bookingName && targetName && bookingName === targetName) score += 40;

  const bookingAddress = normalizeAddressForMatch(asString(booking.address));
  const targetAddress = normalizeAddressForMatch(asString(addressText));
  const addressSimilarity = tokenSimilarity(bookingAddress, targetAddress);
  if (addressSimilarity >= 0.95) score += 90;
  else if (addressSimilarity >= 0.8) score += 75;
  else if (addressSimilarity >= 0.65) score += 55;
  else if (addressSimilarity >= 0.5) score += 35;

  if (branchId && asString(booking.branch_id) === branchId) score += 10;
  if (scheduleTime && snapToAllowedTime(asString(booking.schedule_time)) === scheduleTime) score += 20;
  if (conversationId && normalizeText(asString(booking.notes)).includes(`conversation=${normalizeText(conversationId)}`)) score += 15;
  if (isOpenBookingStatus(booking.status)) score += 5;

  return score;
}

async function attachMapsToExistingBooking({
  leadId,
  scheduleDate,
  mapsUrl,
}: {
  leadId: string | null;
  scheduleDate: string | null;
  mapsUrl: string;
}) {
  if (!leadId || !mapsUrl) return null;

  let query = supabase
    .from("prospect_bookings")
    .select("id, lead_id, maps_url, schedule_date, schedule_time, technician_id, status")
    .eq("lead_id", leadId)
    .order("schedule_date", { ascending: true })
    .order("schedule_time", { ascending: true })
    .limit(1);

  if (scheduleDate) {
    query = query.eq("schedule_date", scheduleDate);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (asString(data.maps_url) === mapsUrl) return data;

  const { data: updated, error: updateError } = await supabase
    .from("prospect_bookings")
    .update({
      maps_url: mapsUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    .select()
    .single();
  if (updateError) throw updateError;
  return updated;
}

async function findExistingBookingReference(leadId: string | null, scheduleDate: string | null) {
  if (!leadId || !scheduleDate) return null;
  const { data, error } = await supabase
    .from("prospect_bookings")
    .select("id, technician_id, schedule_date, schedule_time, status")
    .eq("lead_id", leadId)
    .eq("schedule_date", scheduleDate)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("findExistingBookingReference warning:", error);
    return null;
  }
  return data;
}

async function assignTechnicianForBooking({
  branchId,
  scheduleDate,
  scheduleTime,
  bookingId,
  targetLocationText,
}: {
  branchId: string;
  scheduleDate: string;
  scheduleTime: string;
  bookingId: string | null;
  targetLocationText: string;
}) {
  if (!branchId || !scheduleDate || !scheduleTime) return null;

  const { data: techniciansData, error: techniciansError } = await supabase
    .from("profiles")
    .select("id, name, role, status, branch_id")
    .eq("branch_id", branchId)
    .in("role", ["Teknisi", "teknisi", "Technician", "technician"]);
  if (techniciansError) throw techniciansError;

  const activeTechnicians = (techniciansData || []).filter((technician) => isActiveOperatorStatus(technician.status));
  if (activeTechnicians.length === 0) return null;

  const technicianIds = activeTechnicians.map((technician) => technician.id);

  const [{ data: schedulesData, error: schedulesError }, { data: ordersData, error: ordersError }, { data: bookingsData, error: bookingsError }] =
    await Promise.all([
      supabase
        .from("technician_schedules")
        .select("id, user_id, date, type, reason")
        .in("user_id", technicianIds)
        .eq("date", scheduleDate),
      supabase
        .from("orders")
        .select("id, technician_id, service_date, service_time, status, branch_id, address, maps_url")
        .eq("branch_id", branchId)
        .eq("service_date", scheduleDate),
      supabase
        .from("prospect_bookings")
        .select("id, technician_id, schedule_date, schedule_time, status, branch_id, order_id, address, maps_url")
        .eq("branch_id", branchId)
        .eq("schedule_date", scheduleDate),
    ]);

  if (schedulesError) throw schedulesError;
  if (ordersError) throw ordersError;
  if (bookingsError) throw bookingsError;

  const offDutyIds = new Set(
    (schedulesData || [])
      .map((row: Record<string, unknown>) => String(row.user_id || ""))
      .filter(Boolean),
  );

  const dayOrders = (ordersData || []).filter((row: Record<string, unknown>) => isOpenBookingStatus(row.status));
  const dayBookings = (bookingsData || [])
    .filter((row: Record<string, unknown>) => isOpenBookingStatus(row.status) && !row.order_id)
    .filter((row: Record<string, unknown>) => !bookingId || String(row.id) !== bookingId);

  const chosen = activeTechnicians
    .filter((technician) => !offDutyIds.has(String(technician.id)))
    .map((technician) => {
      const technicianId = String(technician.id);
      const assignedOrders = dayOrders.filter((row: Record<string, unknown>) => String(row.technician_id || "") === technicianId);
      const assignedBookings = dayBookings.filter((row: Record<string, unknown>) => String(row.technician_id || "") === technicianId);
      const dailyLoad = assignedOrders.length + assignedBookings.length;
      const sameTimeBusy = assignedOrders.some((row: Record<string, unknown>) => snapToAllowedTime(asString(row.service_time)) === scheduleTime) ||
        assignedBookings.some((row: Record<string, unknown>) => snapToAllowedTime(asString(row.schedule_time)) === scheduleTime);
      const routeFit = buildTechnicianRouteFit({
        scheduleTime,
        targetLocationText,
        tasks: [...assignedOrders, ...assignedBookings],
      });

      return {
        technicianId,
        dailyLoad,
        sameTimeBusy,
        remainingCapacity: Math.max(0, defaultTechnicianDailyCapacity - dailyLoad),
        routeScore: routeFit.score,
        routeGapScore: routeFit.gapScore,
        routeSimilarityScore: routeFit.similarityScore,
      };
    })
    .filter((item) => !item.sameTimeBusy && item.remainingCapacity > 0)
    .sort((left, right) => {
      if (right.routeScore !== left.routeScore) return right.routeScore - left.routeScore;
      if (left.dailyLoad !== right.dailyLoad) return left.dailyLoad - right.dailyLoad;
      if (right.remainingCapacity !== left.remainingCapacity) return right.remainingCapacity - left.remainingCapacity;
      return left.technicianId.localeCompare(right.technicianId);
    })[0];

  return chosen?.technicianId || null;
}

async function upsertConversationIntelligence({
  normalized,
  intelligence,
  existingRecord,
  leadId,
  bookingId,
  bookingStatus,
}: {
  normalized: ReturnType<typeof normalizePayload>;
  intelligence: any;
  existingRecord: any;
  leadId: string | null;
  bookingId: string | null;
  bookingStatus: string | null;
}) {
  const normalizedBookingStatus = normalizeBookingStatusIntent(asString(bookingStatus));
  const payload = {
    conversation_id: normalized.conversationId,
    business_id: normalized.businessId || null,
    inbox_id: normalized.inboxId || null,
    inbox_name: normalized.inboxName || null,
    contact_id: normalized.contactId || null,
    contact_name: intelligence.extracted.customerName || normalized.displayName || null,
    contact_phone: intelligence.extracted.customerPhone || normalized.customerPhone || null,
    social_username: normalized.socialUsername || null,
    last_message_at: normalized.lastMessageAt || null,
    stage_label: intelligence.stage,
    outcome_label: intelligence.outcome,
    qualification_label: intelligence.qualificationScore >= 60 ? "qualified" : "needs_follow_up",
    closing_label: intelligence.outcome === "booked" ? "closed_won" : intelligence.outcome === "soft_drop" ? "soft_drop" : intelligence.outcome,
    objection_label:
      intelligence.rawSignals.priceObjection
        ? "price"
        : intelligence.rawSignals.scheduleObjection
          ? "schedule"
          : intelligence.rawSignals.coverageObjection
            ? "coverage"
            : null,
    booking_status: bookingId
      ? normalizedBookingStatus || (intelligence.outcome === "booked" ? "confirmed" : "tentative")
      : "not_ready",
    booking_completeness_score: intelligence.bookingCompletenessScore,
    closing_strength_score: intelligence.closingStrengthScore,
    qualification_score: intelligence.qualificationScore,
    extracted_vehicle_text: intelligence.extracted.vehicleText || null,
    extracted_area_text: intelligence.extracted.areaText || null,
    extracted_address: intelligence.extracted.addressText || null,
    extracted_schedule_date: intelligence.extracted.scheduleDate || null,
    extracted_schedule_time: intelligence.extracted.scheduleTime || null,
    extracted_condition_text: intelligence.conditionHits.join(", ") || null,
    extracted_limitation_text: intelligence.limitationDisclosed ? "limitasi telah disampaikan" : null,
    next_best_action: intelligence.nextBestAction,
    labels: intelligence.labels,
    intelligence,
    raw_payload: normalized,
    synced_lead_id: leadId || existingRecord?.synced_lead_id || null,
    synced_booking_id: bookingId || existingRecord?.synced_booking_id || null,
    synced_order_id: existingRecord?.synced_order_id || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("cekat_conversation_intelligence")
    .upsert(payload, { onConflict: "conversation_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function hasConcreteBookingWorkflowSignal(intelligence: any, bookingStatusIntent = "") {
  const normalizedBookingStatusIntent = normalizeBookingStatusIntent(asString(bookingStatusIntent));
  return (
    ["tentative", "confirmed", "reschedule"].includes(normalizedBookingStatusIntent) ||
    intelligence.outcome === "booked" ||
    intelligence.operationalReadiness?.status === "confirmed" ||
    intelligence.stage === "booking_capture" ||
    intelligence.stage === "booking_confirmed"
  );
}

function inferLeadStatus(intelligence: any, explicitLeadIntent = "", bookingStatusIntent = "") {
  const normalizedIntent = normalizeLeadStatusIntent(explicitLeadIntent);
  if (normalizedIntent === "Cancel") return "Cancel";
  if (normalizedIntent === "Follow Up") return "Follow Up";
  if (normalizedIntent === "Pending") return "Pending";
  if (normalizedIntent === "Booking" || hasConcreteBookingWorkflowSignal(intelligence, bookingStatusIntent)) return "Booking";
  if (normalizedIntent === "Closing") return "Closing";
  if (intelligence.outcome === "complaint") return "Cancel";
  if (intelligence.outcome === "booked") return "Booking";
  if (intelligence.operationalReadiness?.status === "confirmed") return "Booking";
  if (intelligence.stage === "booking_capture" || intelligence.stage === "booking_confirmed") return "Booking";
  if (intelligence.outcome === "soft_drop") return "Follow Up";
  return "Pending";
}

function applyOperationalStatusGuard({
  intelligence,
  syncStatus,
}: {
  intelligence: any;
  syncStatus: {
    bookingStatus?: string | null;
    missingFields?: string[];
    buyerFacingMissingFields?: string[];
    hasCompleteBookingDetails: boolean;
    bookingInserted: boolean;
    bookingExistsForDate?: boolean;
  };
}) {
  const adjusted = {
    ...intelligence,
  };

  const missingFields = Array.isArray(syncStatus.missingFields) ? syncStatus.missingFields : [];
  const buyerFacingMissingFields = Array.isArray(syncStatus.buyerFacingMissingFields)
    ? syncStatus.buyerFacingMissingFields
    : deriveBuyerFacingRequiredFields(missingFields);
  const criticalMissingFields = buyerFacingMissingFields;
  const supportiveMissingFields = missingFields.filter((field) => !criticalMissingFields.includes(field));
  const hasBlockingMissingFields = criticalMissingFields.length > 0;
  const bookingStatusIsOpen = isOpenBookingStatus(syncStatus.bookingStatus);
  const bookingLooksFinal = !!(syncStatus.bookingInserted || syncStatus.bookingExistsForDate);
  const bookingIsOperationallyConfirmed =
    bookingLooksFinal &&
    isConfirmedBookingStatus(syncStatus.bookingStatus) &&
    criticalMissingFields.length === 0 &&
    syncStatus.hasCompleteBookingDetails;

  let readinessStatus = "collecting";
  if (!bookingStatusIsOpen && bookingLooksFinal) readinessStatus = "blocked";
  else if (bookingIsOperationallyConfirmed) readinessStatus = "confirmed";
  else if (bookingLooksFinal || syncStatus.hasCompleteBookingDetails) readinessStatus = "draft";
  else if (criticalMissingFields.length > 0) readinessStatus = "collecting";

  const readinessScore = Math.max(
    0,
    100 -
      criticalMissingFields.length * 16 -
      supportiveMissingFields.length * 5 -
      (!bookingStatusIsOpen && bookingLooksFinal ? 30 : 0) -
      (!syncStatus.hasCompleteBookingDetails ? 10 : 0),
  );

  adjusted.operationalReadiness = {
    status: readinessStatus,
    score: readinessScore,
    criticalMissingFields,
    supportiveMissingFields,
    bookingStatus: syncStatus.bookingStatus || null,
  };

  if (bookingIsOperationallyConfirmed) {
    adjusted.stage = "booking_confirmed";
    adjusted.outcome = "booked";
    adjusted.nextBestAction = "none";
  }

  if (
    adjusted.outcome === "booked" &&
    (!bookingLooksFinal || !bookingStatusIsOpen || hasBlockingMissingFields || !syncStatus.hasCompleteBookingDetails)
  ) {
    adjusted.outcome = "in_progress";
  }

  if (
    adjusted.outcome === "ready_to_close" &&
    (!bookingLooksFinal || !bookingStatusIsOpen || hasBlockingMissingFields || !syncStatus.hasCompleteBookingDetails)
  ) {
    adjusted.outcome = "in_progress";
  }

  if (
    adjusted.stage === "booking_confirmed" &&
    (!bookingLooksFinal || !bookingStatusIsOpen || hasBlockingMissingFields || !syncStatus.hasCompleteBookingDetails)
  ) {
    adjusted.stage = "booking_capture";
  }

  if (!bookingStatusIsOpen && bookingLooksFinal) {
    adjusted.nextBestAction = "complete_booking_fields";
  } else if (
    criticalMissingFields.includes("name") ||
    criticalMissingFields.includes("phone") ||
    criticalMissingFields.includes("address")
  ) {
    adjusted.nextBestAction = "complete_booking_fields";
  } else if (criticalMissingFields.includes("schedule_date") || criticalMissingFields.includes("schedule_time")) {
    adjusted.nextBestAction = "offer_slot";
  } else if (criticalMissingFields.includes("vehicle")) {
    adjusted.nextBestAction = "ask_vehicle";
  } else if (
    (adjusted.outcome === "booked" || adjusted.stage === "booking_confirmed") &&
    adjusted.nextBestAction === "none" &&
    criticalMissingFields.length > 0
  ) {
    adjusted.nextBestAction = "complete_booking_fields";
  }

  return adjusted;
}

async function applyConversionCore({
  normalized,
  intelligence,
  resolvedRefs,
  syncStatus,
  leadId,
  bookingStatus,
  trace,
}: {
  normalized: ReturnType<typeof normalizePayload>;
  intelligence: any;
  resolvedRefs: any;
  syncStatus: any;
  leadId: string | null;
  bookingStatus: string | null;
  trace: TraceContext;
}) {
  const customerText = normalized.messages
    .filter((message) => message.senderRole === "customer")
    .map((message) => message.text)
    .join("\n");
  const customerAttachmentCount = normalized.messages
    .filter((message) => message.senderRole === "customer")
    .reduce((sum, message) => sum + message.attachments.length, 0);
  const lastCustomerMessage = [...normalized.messages]
    .reverse()
    .find((message) => message.senderRole === "customer" && message.text)?.text || null;
  const signals = deriveCustomerSignals(normalized, intelligence, customerText);
  const leadCompleteness = assessLeadCompleteness({
    service_id: resolvedRefs.service?.id || intelligence.extracted.serviceId || normalized.booking.serviceId || "svc_headlamp_polish",
    vehicle_id: resolvedRefs.vehicle?.id || intelligence.extracted.vehicleId || normalized.booking.vehicleId || null,
    vehicle_text: intelligence.extracted.vehicleText || normalized.extracted.vehicleText || null,
    area_id: resolvedRefs.area?.id || intelligence.extracted.areaId || normalized.booking.areaId || null,
    area_text: intelligence.extracted.areaText || normalized.extracted.areaText || null,
    coverage_status: resolvedRefs.area?.id ? "covered" : resolvedRefs.branch?.id ? "conditional" : "unknown",
    condition_text: intelligence.conditionHits?.join(", ") || intelligence.extracted.conditionText || null,
    condition_confidence: intelligence.conditionHits?.length ? "clear" : "missing",
    photo_received: customerAttachmentCount > 0,
    raw_text: customerText,
    last_customer_message: lastCustomerMessage,
    customer_name: intelligence.extracted.customerName || normalized.displayName || null,
    contact_phone: intelligence.extracted.customerPhone || normalized.customerPhone || null,
    social_username: normalized.socialUsername || null,
    address_text: intelligence.extracted.addressText || normalized.booking.address || null,
    maps_url: intelligence.extracted.mapsUrl || normalized.booking.mapsUrl || null,
    schedule_date: syncStatus.requestedDate || intelligence.extracted.scheduleDate || null,
    schedule_time: syncStatus.requestedTime || intelligence.extracted.scheduleTime || null,
    quote_presented: Boolean(intelligence.rawSignals?.priceSent),
    soft_commit_received: signals.some((signal) => SOFT_COMMIT_SIGNAL_SET.has(signal)),
    booking_confirmed: bookingStatus === "confirmed" || intelligence.stage === "booking_confirmed",
    handoff_required: Boolean(intelligence.rawSignals?.complaintRisk || intelligence.rawSignals?.handoffDetected),
  });
  const objectionClassification = classifyObjection({
    text: customerText,
    signals,
    customer_repeat_count: countRecentCustomerObjectionRepeats(customerText),
  });
  const nextBestClose = recommendNextBestClose({
    sales_stage: leadCompleteness.sales_stage,
    objection_id: objectionClassification.objection_id,
    severity: objectionClassification.severity,
    availability_known: Boolean(syncStatus.requestedDate && syncStatus.requestedTimeAllowed),
    slot_options: buildSuggestedSlotOptions(syncStatus),
    missing_fields: [
      ...leadCompleteness.missing_fields,
      ...leadCompleteness.missing_operational_fields,
    ],
    human_required: objectionClassification.human_required,
  });
  const signalEvaluation = await evaluateSignals({
    tenant_id: normalized.businessId || normalized.inboxName || "polesheadlamp",
    conversation_id: normalized.conversationId,
    customer_id: leadId,
    trace_id: trace.traceId,
    signals,
    lead_qualified: leadCompleteness.ready_for_quote,
    ready_for_quote: leadCompleteness.ready_for_quote,
    sales_stage: leadCompleteness.sales_stage,
    payload_context: {
      lead_completeness_score: leadCompleteness.completeness_score,
      objection_id: objectionClassification.objection_id,
    },
  });
  logSpan(trace, "sales.decision", "ok", {
    stage_before: intelligence.stage || null,
    stage_after: leadCompleteness.sales_stage,
    objection_id: objectionClassification.objection_id || null,
    strategy_id: nextBestClose.strategy_id,
    must_ask_count: Array.isArray(nextBestClose.must_ask) ? nextBestClose.must_ask.length : 0,
    signals_count: signals.length,
  });

  return {
    ...intelligence,
    leadCompleteness,
    objectionClassification,
    nextBestClose,
    signalEvaluation,
    conversion: {
      version: "1.0.0",
      signals,
      leadCompleteness,
      objectionClassification,
      nextBestClose,
      signalEvaluation: {
        emitted_event_types: signalEvaluation.emitted_event_types,
        dropped: signalEvaluation.dropped,
      },
    },
    nextBestAction: nextBestClose.handoff_required
      ? "human_handoff"
      : mapMustAskToNextBestAction(nextBestClose.must_ask[0]) ||
        intelligence.nextBestAction,
  };
}

const SOFT_COMMIT_SIGNAL_SET = new Set<CustomerSignal>([
  "customer_confirmed_slot",
  "customer_asked_to_hold_slot",
  "customer_asked_what_to_prepare",
  "customer_agreed_time_window",
]);

function deriveCustomerSignals(
  normalized: ReturnType<typeof normalizePayload>,
  intelligence: any,
  customerText: string,
): CustomerSignal[] {
  const signals = new Set<CustomerSignal>(normalized.signals || []);
  const text = normalizeText(customerText);

  if (/\b(hold|booking|book|jadwalin|amankan|ambil slot|fix(?:\s+jam|\s+slot)?)\b/i.test(text)) {
    signals.add("customer_asked_to_hold_slot");
  }
  if (/\b(siapin apa|persiapan|yang perlu disiapkan|apa yang disiapkan)\b/i.test(text)) {
    signals.add("customer_asked_what_to_prepare");
  }
  if (/\b(ok|oke|boleh|siap|setuju)\b.*\b(jam|pagi|siang|sore|slot)\b/i.test(text)) {
    signals.add("customer_agreed_time_window");
  }
  if (/\b(tidak jadi|ga jadi|nggak jadi|cancel|batal)\b/i.test(text)) {
    signals.add("customer_declined");
  }
  if (/\b(admin|cs|orang|human|manusia)\b/i.test(text)) {
    signals.add("customer_wants_human");
  }
  if (intelligence.rawSignals?.priceObjection || /\b(mahal|harga|biaya)\b/i.test(text)) {
    signals.add("customer_asked_price_again");
  }
  if (/\b(tempat lain|bengkel lain|kompetitor|lebih murah di|bandingin)\b/i.test(text)) {
    signals.add("customer_mentioned_competitor");
  }
  if (/\b(diskon|nego|bisa kurang|potongan|harga net)\b/i.test(text)) {
    signals.add("customer_mentioned_discount");
  }
  if (/\b(takut|yakin|aman ga|beneran|hasilnya gimana|before after)\b/i.test(text)) {
    signals.add("customer_expressed_distrust");
  }

  return [...signals];
}

function normalizeCustomerSignals(values: unknown[]): CustomerSignal[] {
  const allowed = new Set<CustomerSignal>([
    "customer_confirmed_slot",
    "customer_asked_to_hold_slot",
    "customer_asked_what_to_prepare",
    "customer_agreed_time_window",
    "customer_declined",
    "customer_wants_human",
    "customer_asked_price_again",
    "customer_mentioned_competitor",
    "customer_mentioned_discount",
    "customer_expressed_distrust",
  ]);
  return Array.from(
    new Set(
      values
        .map((value) => asString(value))
        .filter((value): value is CustomerSignal => allowed.has(value as CustomerSignal)),
    ),
  );
}

function countRecentCustomerObjectionRepeats(customerText: string): number {
  const normalized = normalizeText(customerText);
  return [
    /\bmahal\b/g,
    /\bdiskon\b/g,
    /\bnego\b/g,
    /\btakut\b/g,
    /\byakin\b/g,
  ].reduce((sum, pattern) => sum + (normalized.match(pattern)?.length || 0), 0);
}

function buildSuggestedSlotOptions(syncStatus: any): string[] {
  const date = asString(syncStatus?.requestedDate);
  const time = asString(syncStatus?.requestedTime);
  if (date && time && isAllowedSlotTime(time)) {
    return [formatCustomerFacingScheduleLabel(date, time) || `${date} ${time}`];
  }
  return [];
}

function mapMustAskToNextBestAction(mustAsk: string | undefined): string | null {
  const map: Record<string, string> = {
    vehicle: "ask_vehicle",
    area: "ask_area",
    condition_or_photo: "ask_condition_or_photo",
    customer_name: "complete_booking_fields",
    contact_phone_or_social: "complete_booking_fields",
    address_or_maps: "complete_booking_fields",
    schedule_date: "offer_slot",
    schedule_time: "offer_slot",
    choose_slot_option: "offer_slot",
    preferred_day: "offer_slot",
    morning_or_afternoon: "offer_slot",
    hold_preferred_slot: "booking_tentative",
    hold_slot_temporarily: "booking_tentative",
    permission_to_followup: "schedule_followup",
    want_human_review: "human_handoff",
  };
  return mustAsk ? map[mustAsk] || null : null;
}

function prioritizeMissingFields(missingFields: unknown) {
  const order = ["name", "phone", "address", "schedule_date", "schedule_time", "vehicle", "branch", "maps_url"];
  const unique = Array.from(new Set(Array.isArray(missingFields) ? missingFields.map((item) => asString(item)).filter(Boolean) : []));
  return unique.sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    const safeLeft = leftIndex === -1 ? order.length + 1 : leftIndex;
    const safeRight = rightIndex === -1 ? order.length + 1 : rightIndex;
    return safeLeft - safeRight;
  });
}

function deriveBuyerFacingRequiredFields(missingFields: unknown) {
  const buyerFacingFields = new Set(["name", "phone", "address", "schedule_date", "schedule_time", "vehicle"]);
  return prioritizeMissingFields(missingFields).filter((field) => buyerFacingFields.has(field)).slice(0, 3);
}

function deriveCaptureState({
  leadId,
  bookingId,
  bookingStatus,
}: {
  leadId: string | null;
  bookingId: string | null;
  bookingStatus: string | null;
}) {
  if (bookingId && isOpenBookingStatus(bookingStatus)) return "booking_saved";
  if (leadId) return "lead_saved";
  return "partial_data_recorded";
}

function deriveResponseMode({
  captureState,
  bookingStatus,
  requiredNextFields,
  stage,
  outcome,
}: {
  captureState: "booking_saved" | "lead_saved" | "partial_data_recorded";
  bookingStatus: string | null;
  requiredNextFields: string[];
  stage: string;
  outcome: string;
}) {
  if (stage === "complaint" || outcome === "complaint") return "handoff_complaint";
  if (
    captureState === "booking_saved" &&
    requiredNextFields.length === 0 &&
    isConfirmedBookingStatus(bookingStatus)
  ) {
    return "send_final_confirmation";
  }
  return "collect_missing_fields";
}

function buildLeadNotes(normalized: ReturnType<typeof normalizePayload>, intelligence: any) {
  const segments = [
    `[CEKAT ${normalized.inboxName || "chat"}] conversation=${normalized.conversationId}`,
    `write_source=${normalized.writeSource || "transcript-sync"}`,
    normalized.commitMode ? `commit_mode=${normalized.commitMode}` : null,
    normalized.contactId ? `contact=${normalized.contactId}` : null,
    normalized.handledBy ? `handled_by=${normalized.handledBy}` : null,
    normalized.sourceAccount ? `source_account=${normalized.sourceAccount}` : null,
    normalized.socialPlatform ? `social_platform=${normalized.socialPlatform}` : null,
    normalized.socialUsername ? `social_username=${normalized.socialUsername}` : null,
    normalized.displayName ? `display=${normalized.displayName}` : null,
    intelligence.extracted.areaText ? `area=${intelligence.extracted.areaText}` : null,
    intelligence.extracted.vehicleText ? `vehicle=${intelligence.extracted.vehicleText}` : null,
    intelligence.conditionHits.length ? `condition=${intelligence.conditionHits.join(",")}` : null,
    `stage=${intelligence.stage}`,
    `outcome=${intelligence.outcome}`,
  ].filter(Boolean);
  return segments.join(" | ");
}

function buildBookingNotes(normalized: ReturnType<typeof normalizePayload>, intelligence: any) {
  const segments = [
    `[CEKAT ${normalized.writeSource === "structured-write" ? "structured write" : "closing sync"}] conversation=${normalized.conversationId}`,
    `write_source=${normalized.writeSource || "transcript-sync"}`,
    normalized.commitMode ? `commit_mode=${normalized.commitMode}` : null,
    normalized.contactId ? `contact=${normalized.contactId}` : null,
    normalized.handledBy ? `handled_by=${normalized.handledBy}` : null,
    normalized.sourceAccount ? `source_account=${normalized.sourceAccount}` : null,
    normalized.socialPlatform ? `social_platform=${normalized.socialPlatform}` : null,
    normalized.socialUsername ? `social_username=${normalized.socialUsername}` : null,
    normalized.displayName ? `display=${normalized.displayName}` : null,
    intelligence.extracted.areaText ? `area=${intelligence.extracted.areaText}` : null,
    intelligence.extracted.vehicleText ? `vehicle=${intelligence.extracted.vehicleText}` : null,
    intelligence.conditionHits.length ? `condition=${intelligence.conditionHits.join(",")}` : null,
    intelligence.extracted.notes || null,
  ].filter(Boolean);
  return segments.join(" | ");
}

function selectPreferredSyncNotes({
  existingNotes,
  nextNotes,
  conversationId,
}: {
  existingNotes: string;
  nextNotes: string;
  conversationId: string | null;
}) {
  const safeNext = asString(nextNotes).trim();
  const safeExisting = asString(existingNotes).trim();
  if (!safeExisting) return safeNext;

  const existingConversationId = extractConversationIdFromNotes(safeExisting);
  const nextConversationId = asString(conversationId).trim();

  if (!existingConversationId || !nextConversationId) {
    return safeNext;
  }

  if (normalizeText(existingConversationId) === normalizeText(nextConversationId)) {
    return safeNext;
  }

  const existingLooksReal = looksLikeUuid(existingConversationId);
  const nextLooksReal = looksLikeUuid(nextConversationId);

  if (nextLooksReal && !existingLooksReal) {
    return safeNext;
  }

  if (existingLooksReal && !nextLooksReal) {
    return safeExisting;
  }

  return safeExisting;
}

function extractConversationIdFromNotes(notes: string) {
  const match = notes.match(/conversation=([^|]+)/i);
  return match?.[1]?.trim() || "";
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asString(value).trim());
}

function isActiveOperatorStatus(value: unknown) {
  const normalized = normalizeText(asString(value));
  if (!normalized) return true;
  return !["inactive", "nonaktif", "resign", "disabled", "terminated"].some((token) => normalized.includes(token));
}

function isOpenBookingStatus(value: unknown) {
  const normalized = normalizeText(asString(value));
  if (!normalized) return true;
  return !["cancel", "canceled", "cancelled", "reschedul", "jadwalulang", "batal", "void", "done", "completed", "selesai", "reject", "rejected"].some((token) => normalized.includes(token));
}

function isConfirmedBookingStatus(value: unknown) {
  const normalized = normalizeText(asString(value));
  if (!normalized) return false;
  return normalized.includes("confirm");
}

function buildTechnicianRouteFit({
  scheduleTime,
  targetLocationText,
  tasks,
}: {
  scheduleTime: string;
  targetLocationText: string;
  tasks: Array<Record<string, unknown>>;
}) {
  const requestedSlotIndex = slotIndexOfTime(scheduleTime);
  if (requestedSlotIndex < 0) {
    return { score: 0, gapScore: 0, similarityScore: 0 };
  }

  const normalizedTarget = compactText(targetLocationText);
  const taskSnapshots = tasks
    .map((task) => {
      const taskTime = snapToAllowedTime(asString(task.service_time) || asString(task.schedule_time));
      const slotIndex = slotIndexOfTime(taskTime);
      if (slotIndex < 0) return null;
      return {
        slotIndex,
        addressText: compactText(`${asString(task.address)} ${asString(task.maps_url)}`),
      };
    })
    .filter(Boolean) as Array<{ slotIndex: number; addressText: string }>;

  const previousTask = taskSnapshots
    .filter((task) => task.slotIndex < requestedSlotIndex)
    .sort((left, right) => right.slotIndex - left.slotIndex)[0] || null;
  const nextTask = taskSnapshots
    .filter((task) => task.slotIndex > requestedSlotIndex)
    .sort((left, right) => left.slotIndex - right.slotIndex)[0] || null;

  let gapScore = 0;
  if (previousTask) {
    gapScore += Math.max(0, 4 - (requestedSlotIndex - previousTask.slotIndex)) * 10;
  }
  if (nextTask) {
    gapScore += Math.max(0, 4 - (nextTask.slotIndex - requestedSlotIndex)) * 10;
  }
  if (previousTask && nextTask) gapScore += 5;

  let similarityScoreTotal = 0;
  if (normalizedTarget && previousTask?.addressText) {
    similarityScoreTotal += similarityScore(normalizedTarget, previousTask.addressText) * 20;
  }
  if (normalizedTarget && nextTask?.addressText) {
    similarityScoreTotal += similarityScore(normalizedTarget, nextTask.addressText) * 20;
  }

  return {
    score: gapScore + similarityScoreTotal,
    gapScore,
    similarityScore: similarityScoreTotal,
  };
}

function slotIndexOfTime(value: string) {
  return SLOT_SEQUENCE.indexOf(snapToAllowedTime(value));
}

function selectNextBestAction(flags: any) {
  if (flags.complaintRisk) return "handoff_human_now";
  if (!flags.extractedVehicle) return "ask_vehicle";
  if (!flags.extractedArea) return "ask_area";
  if (flags.conditionHits.length === 0 && !flags.attachmentCount) return "ask_condition_or_photo";
  if (!flags.limitationDisclosed && flags.conditionHits.some((value: string) => value.includes("embun") || value.includes("retak"))) {
    return "disclose_limitation";
  }
  if (!flags.priceSent) return "send_price";
  if (!flags.slotOffered) return "offer_slot";
  if (!flags.bookingFieldsRequested) return "ask_booking_fields";
  if (flags.bookingCompletenessScore < 85) return "complete_booking_fields";
  if (!flags.bookingConfirmed && !flags.handoffDetected) return "confirm_booking_then_handoff";
  return "monitor";
}

function detectConditions(text: string) {
  const hits: string[] = [];
  if (/menguning|kuning|oksidasi/i.test(text)) hits.push("menguning_oksidasi");
  if (/kusam|buram|pudar|kabut/i.test(text)) hits.push("kusam_buram");
  if (/embun|jamur.*dalam|moisture|kondensasi/i.test(text)) hits.push("embun_jamur_dalam");
  if (/retak|pecah|baret|gores/i.test(text)) hits.push("retak_baret");
  if (/stiker|skotlet|scotlite|scotlite|sticker/i.test(text)) hits.push("stiker_skotlet");
  return hits;
}

function extractVehicle(text: string) {
  if (isToolTraceNoise(text)) return "";
  const normalized = normalizeText(text);
  const models = [
    "avanza", "xenia", "brio", "yaris", "mobilio", "rush", "terios", "vios",
    "city", "civic", "hrv", "crv", "freed", "innova", "fortuner", "calya",
    "sigra", "ertiga", "xl7", "baleno", "apv", "swift", "carry", "agya",
    "ayla", "jazz", "splash", "livina", "grand livina", "serena", "serena c26",
    "grandmax", "luxio", "pajero", "xpander", "outlander", "brv", "sienta",
    "alphard", "camry", "mazda2", "mazda 2", "bmw", "bmw e39",
    "kuda grandia", "peugeot 3008", "grand livina", "s-cross",
    "kuda", "grandia", "3008", "scross", "karimun",
  ];
  for (const model of models) {
    if (normalized.includes(model)) return model;
  }
  const brandModelMatch = text.match(/\b(mitsubishi|suzuki|honda|toyota|nissan|daihatsu|mazda|peugeot|hyundai|wuling|bmw|mercedes|mercy|land rover)\s+([a-z0-9\-\s]{2,40})/i);
  if (brandModelMatch) {
    const candidate = compactText(`${brandModelMatch[1]} ${brandModelMatch[2]}`);
    if (candidate && !/\b(harga|biaya|jadwal|tanggal|jam|alamat|nomor|whatsapp|wa|untuk|hari|produk|lokasi)\b/i.test(candidate)) {
      return candidate;
    }
  }
  const match = text.match(/mobil\s+([a-z0-9\-\s]{2,40})/i);
  if (!match) return "";
  const candidate = compactText(match[1]);
  if (!candidate) return "";
  if (/\b(rp|harga|biaya|jadwal|tanggal|jam|alamat|nomor|whatsapp|wa|jadi|untuk|besok|hari|produk|parkir|diparkir|parkiran|umum|listrik|tempat)\b/i.test(candidate)) return "";
  if (!/[a-z]/i.test(candidate)) return "";
  return candidate;
}

function extractArea(text: string) {
  const normalized = normalizeText(text);
  const keywords = [
    "jakarta", "bogor", "depok", "tangerang", "bekasi", "bandung", "karawang",
    "serang", "banten", "cimahi", "cilegon", "cikarang", "bsd", "ciracas",
    "jatiasih", "taktakan", "cicurug", "cijeruk", "tangerang selatan", "tangsel",
    "cibubur", "cimanggis", "cileungsi", "rancaekek", "metland", "purwakarta",
  ];
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) return keyword;
  }
  const match = text.match(/(di|dari|area|domisili|lokasi|daerah)\s+([a-z0-9\-\s]{3,40})/i);
  return match ? compactText(match[2]) : "";
}

function extractAddress(text: string) {
  if (isToolTraceNoise(text)) return "";
  const labeledFields = extractLabeledBookingFields(text);
  if (labeledFields.addressText) return labeledFields.addressText;
  const lines = text
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter(Boolean);
  for (const line of lines) {
    if (isToolTraceNoise(line)) continue;
    if (/jl\.|jalan|blok|no\.|nomor|km\s*\d+/i.test(line)) {
      return line;
    }
  }
  return "";
}

function extractName(text: string) {
  const labeledFields = extractLabeledBookingFields(text);
  if (labeledFields.customerName) return labeledFields.customerName;
  const directPatterns = [
    /atas nama\s+([a-z .,'-]{3,60})/i,
    /nama(?: saya| lengkap)?\s*[:\-]?\s*([a-z .'-]{3,60}?)(?=(?:,?\s*(?:alamat|wa|whatsapp|nomor|no\.?\s*(?:wa|hp)|telepon|telp)\s*[:\-])|$)/i,
    /(?:^|\n)\s*([a-z][a-z .,'-]{2,40})\s+(?:\+?62|0)\d{8,14}\b/i,
  ];
  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = compactText(match[1]);
      if (isConfidentCustomerName(candidate)) return candidate;
    }
  }

  const lines = text
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1] || "";
    const nextTwo = lines[index + 2] || "";
    if (!current || current.length < 3 || current.length > 60) continue;
    if (!/^[a-z][a-z .,'-]+$/i.test(current)) continue;
    if (looksLikeGreetingOnlyName(current)) continue;
    if (/\b(kak|ka|halo|siap|oke|ok|besok|hari|tanggal|jam|blok|jalan|jl\.|komp|cluster|nomor|no\.)\b/i.test(current)) continue;
    if (!/(?:\+?62|0)\d{8,14}/.test(next)) continue;
    if (nextTwo && !/jl\.|jalan|blok|no\.|nomor|komp|cluster|kec|kab|kota|rt|rw/i.test(nextTwo)) continue;
    if (isConfidentCustomerName(current)) return current;
  }

  return "";
}

function extractPhone(text: string) {
  const match = text.match(/(?:\+?62|0)\d{8,14}/);
  return match ? match[0] : "";
}

function resolveRelativeDate(referenceIso: string, dayOffset: number) {
  const base = referenceIso ? new Date(referenceIso) : new Date();
  if (Number.isNaN(base.getTime())) {
    const now = new Date();
    now.setDate(now.getDate() + dayOffset);
    return now.toISOString().slice(0, 10);
  }
  base.setDate(base.getDate() + dayOffset);
  return base.toISOString().slice(0, 10);
}

function extractDate(text: string, referenceIso = "") {
  const calendar = resolveCalendarForExtraction(text, referenceIso);
  if (calendar.invalidDate) return "";
  if (calendar.date) return calendar.date;

  const normalized = normalizeText(text);
  const monthMatch = normalized.match(/\b(?:tgl|tanggal)?\s*(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|agt|agu|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|sep|okt|nov|des)\s*(20\d{2})?\b/i);
  if (monthMatch) {
    const monthMap: Record<string, string> = {
      januari: "01",
      februari: "02",
      maret: "03",
      april: "04",
      mei: "05",
      juni: "06",
      juli: "07",
      agustus: "08",
      agu: "08",
      agt: "08",
      september: "09",
      oktober: "10",
      november: "11",
      desember: "12",
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      jun: "06",
      jul: "07",
      sep: "09",
      okt: "10",
      nov: "11",
      des: "12",
    };
    const day = monthMatch[1].padStart(2, "0");
    const month = monthMap[monthMatch[2]] || "";
    const year = monthMatch[3] || String(new Date().getFullYear());
    if (month) return `${year}-${month}-${day}`;
  }
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  if (normalized.includes("hari ini")) {
    return resolveRelativeDate(referenceIso, 0);
  }
  if (normalized.includes("besok")) {
    return resolveRelativeDate(referenceIso, 1);
  }
  const localMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}))?\b/);
  if (!localMatch) return "";
  const day = localMatch[1].padStart(2, "0");
  const month = localMatch[2].padStart(2, "0");
  const year = localMatch[3] || String(new Date().getFullYear());
  return `${year}-${month}-${day}`;
}

function extractTime(text: string) {
  if (looksLikeGreetingOnlyName(text)) return "";
  const calendar = resolveCalendarForExtraction(text);
  if (calendar.slot) return calendar.slot;

  const explicit = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (explicit) {
    return `${explicit[1].padStart(2, "0")}:${explicit[2]}`;
  }
  const normalized = normalizeText(text);
  if (normalized.includes("pagi")) return "08:00";
  if (normalized.includes("siang")) return "12:00";
  if (normalized.includes("sore")) return "15:00";
  if (normalized.includes("malam")) return "";
  return "";
}

function extractMapsUrl(text: string) {
  if (!text) return "";
  const match = String(text).match(/\bhttps?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com|maps\.g\.co|maps\.apple\.com)[^\s<>()]+/i);
  return match ? match[0] : "";
}

function normalizeRequestedScheduleTime(value: string) {
  if (!value) return "";
  const explicit = String(value).trim().match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  if (explicit) {
    return `${explicit[1].padStart(2, "0")}:${explicit[2]}`;
  }
  return extractTime(value);
}

function resolveCalendarForExtraction(text: string, referenceIso = "") {
  const raw = asString(text);
  if (!hasScheduleCue(raw)) return { date: "", slot: "", invalidDate: false };
  const safeRaw = raw.replace(/\bpasar\s+minggu\b/gi, "pasarminggu");
  const resolved = resolveCalendarInput({
    raw_text: safeRaw,
    reference_datetime: referenceIso || new Date().toISOString(),
  });
  return {
    date: resolved.date || "",
    slot: resolved.slot || "",
    invalidDate: resolved.ambiguities.includes("invalid_calendar_date"),
  };
}

function hasScheduleCue(text: string) {
  const safeText = asString(text).toLowerCase().replace(/\bpasar\s+minggu\b/g, "pasarminggu");
  return /\b(hari ini|besok|bsk|lusa|weekend|akhir pekan|minggu depan|pekan depan|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|tanggal|tgl|jam|pukul|pagi|siang|sore|malam|\d{1,2}[\/-]\d{1,2}|\d{1,2}\s+(jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|nov|des|januari|februari|maret|april|juni|juli|agustus|september|oktober|november|desember))\b/i
    .test(safeText);
}

function formatCustomerFacingScheduleLabel(dateValue: string | null, timeValue: string | null) {
  const cleanedDate = asString(dateValue);
  const cleanedTime = asString(timeValue);
  if (!cleanedDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanedDate)) return "";

  const [yearText, monthText, dayText] = cleanedDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "";

  const weekdayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const monthNames = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];

  const baseLabel = `${weekdayNames[date.getUTCDay()]}, ${day} ${monthNames[month - 1] || monthText}`;
  if (!cleanedTime) return baseLabel;
  return `${baseLabel}, jam ${cleanedTime}`;
}

function isAllowedSlotTime(value: string) {
  return SLOT_SEQUENCE_SET.has(String(value || "").trim());
}

function snapToAllowedTime(value: string) {
  if (!value) return "";
  const allowed = SLOT_SEQUENCE;
  if (allowed.includes(value)) return value;
  const valueMinutes = toMinutes(value);
  let best = allowed[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const slot of allowed) {
    const diff = Math.abs(toMinutes(slot) - valueMinutes);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }
  return best;
}

function findBestMatch(items: Array<Record<string, any>>, sourceText: string, fields: string[]) {
  const haystack = normalizeText(sourceText);
  if (!haystack) return null;

  let bestItem: Record<string, any> | null = null;
  let bestScore = 0;

  for (const item of items) {
    const values = fields.map((field) => asString(item[field])).filter(Boolean);
    const candidateText = normalizeText(values.join(" "));
    if (!candidateText) continue;
    const score = similarityScore(haystack, candidateText);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestScore >= 0.22 ? bestItem : null;
}

function similarityScore(a: string, b: string) {
  const aTokens = new Set(a.split(/[^a-z0-9]+/).filter(Boolean));
  const bTokens = new Set(b.split(/[^a-z0-9]+/).filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function buildPhoneVariants(phone: string) {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.startsWith("62")) variants.add(`0${digits.slice(2)}`);
  if (digits.startsWith("0")) variants.add(`62${digits.slice(1)}`);
  return [...variants];
}

function normalizeMessages(messagesInput: unknown[], transcript: string, firstMessage: string, createdAt: string) {
  const rows: NormalizedMessage[] = [];

  const push = (candidate: Record<string, unknown>) => {
    const text = compactText(
      asString(candidate.text) ||
        asString(candidate.message) ||
        asString(candidate.content) ||
        asString(candidate.body) ||
        asString(candidate.caption),
    );
    const attachments = normalizeAttachments(
      candidate.attachments ||
        candidate.files ||
        candidate.images ||
        candidate.media ||
        (asString(candidate.media_url)
          ? [{ url: asString(candidate.media_url), type: asString(candidate.media_type) || "file" }]
          : []),
    );
    if (!text && attachments.length === 0) return;
    rows.push({
      id: asString(candidate.id) || asString(candidate.message_id) || null,
      text,
      senderRole: normalizeSenderRole(
        asString(candidate.senderRole) ||
          asString(candidate.sent_by_type) ||
          asString(candidate.sender_type) ||
          asString(candidate.senderType) ||
          asString(candidate.role) ||
          asString(candidate.sender) ||
          asString(candidate.from),
      ),
      createdAt:
        asString(candidate.createdAt) ||
        asString(candidate.created_at) ||
        asString(candidate.sent_at) ||
        asString(candidate.timestamp) ||
        null,
      attachments,
    });
  };

  for (const raw of messagesInput) {
    if (raw && typeof raw === "object") {
      push(raw as Record<string, unknown>);
    }
  }

  if (rows.length === 0 && firstMessage) {
    rows.push({
      text: compactText(firstMessage),
      senderRole: "customer",
      createdAt: createdAt || null,
      attachments: [],
    });
  }

  if (rows.length === 0 && transcript) {
    for (const line of transcript.split(/\n+/)) {
      const text = compactText(line);
      if (!text) continue;
      rows.push({
        text,
        senderRole: "unknown",
        createdAt: createdAt || null,
        attachments: [],
      });
    }
  }

  const deduped: NormalizedMessage[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.senderRole}::${row.createdAt || "na"}::${row.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped.sort((a, b) => (Date.parse(a.createdAt || "0") || 0) - (Date.parse(b.createdAt || "0") || 0));
}

function normalizeAttachments(value: unknown): Array<{ type?: string | null; url?: string | null }> {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const normalized: Array<{ type?: string | null; url?: string | null }> = [];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === "string") {
      normalized.push({ type: "file", url: item });
      continue;
    }
    if (typeof item !== "object") continue;
    normalized.push({
      type: asString((item as Record<string, unknown>).type) || asString((item as Record<string, unknown>).mime_type) || "file",
      url: asString((item as Record<string, unknown>).url) || asString((item as Record<string, unknown>).src) || null,
    });
  }
  return normalized;
}

function normalizeSenderRole(value: string): "customer" | "admin" | "ai" | "unknown" {
  const text = normalizeText(value);
  if (text.includes("customer") || text.includes("contact") || text.includes("user") || text.includes("buyer")) return "customer";
  if (text.includes("ai")) return "ai";
  if (text.includes("admin") || text.includes("agent") || text.includes("cs") || text.includes("human") || text.includes("inbox")) return "admin";
  return "unknown";
}

function inferPlatformId(value: string) {
  const text = normalizeText(value);
  if (text.includes("instagram")) return "0locyp1eu";
  if (text.includes("messenger")) return "0locyp1eu";
  if (text.includes("facebook")) return "0locyp1eu";
  if (text.includes("whatsapp")) return "0locyp1eu";
  if (text.includes("tiktok")) return "zwzxh5k20";
  if (text.includes("google")) return "c9llusk05";
  return "";
}

function inferSubChannelId(value: string) {
  const text = normalizeText(value);
  if (text.includes("instagram")) return "kxs25q3di";
  if (text.includes("messenger")) return "snqgjwqd2";
  if (text.includes("facebook")) return "snqgjwqd2";
  if (text.includes("whatsapp")) return "g07e8qkc4";
  if (text.includes("tiktok dm")) return "gz9hyaybg";
  if (text.includes("tiktok")) return "gz9hyaybg";
  return "";
}

function inferSocialPlatform(value: string) {
  const text = normalizeText(value);
  if (text.includes("instagram")) return "instagram";
  if (text.includes("messenger")) return "messenger";
  if (text.includes("facebook")) return "facebook";
  if (text.includes("tiktok")) return "tiktok";
  if (text.includes("whatsapp")) return "whatsapp";
  return "";
}

function normalizeLeadStatusIntent(value: string) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.includes("cancel")) return "Cancel";
  if (text.includes("follow")) return "Follow Up";
  if (text.includes("closing")) return "Closing";
  if (text.includes("pending")) return "Pending";
  if (text.includes("booking")) return "Booking";
  return "";
}

function normalizeBookingStatusIntent(value: string) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.includes("cancel")) return "cancelled";
  if (text.includes("reschedul") || text.includes("jadwalulang")) return "reschedule";
  if (text.includes("confirm")) return "confirmed";
  if (text.includes("tentative") || text.includes("draft") || text.includes("review")) return "tentative";
  return "";
}

function score(value: unknown, amount: number) {
  return value ? amount : 0;
}

function toMinutes(value: string) {
  const [hour, minute] = String(value).split(":").map((part) => Number(part));
  return (hour || 0) * 60 + (minute || 0);
}

function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

function buildSyncStatus({
  intelligence,
  leadId,
  bookingId,
  existingDateBookingId,
  branchId,
  mapsUrl,
  bookingStatus,
  missingFields,
}: {
  intelligence: any;
  leadId: string | null;
  bookingId: string | null;
  existingDateBookingId: string | null;
  branchId: string | null;
  mapsUrl: string | null;
  bookingStatus?: string | null;
  missingFields?: string[];
}) {
  const requestedDate = asString(intelligence?.extracted?.scheduleDate);
  const requestedTime = asString(intelligence?.extracted?.scheduleTime);
  const buyerFacingMissingFields = deriveBuyerFacingRequiredFields(missingFields || []);
  const hasCompleteBookingDetails =
    Boolean(asString(intelligence?.extracted?.customerName)) &&
    Boolean(asString(intelligence?.extracted?.customerPhone)) &&
    Boolean(asString(intelligence?.extracted?.addressText)) &&
    Boolean(requestedDate) &&
    Boolean(requestedTime);

  let bookingReviewReason: string | null = null;
  if (!bookingId && hasCompleteBookingDetails) {
    if (!isAllowedSlotTime(requestedTime)) bookingReviewReason = "requested_time_not_supported";
    else if (!branchId) bookingReviewReason = "branch_unresolved";
    else bookingReviewReason = "booking_not_inserted";
  } else if (bookingId && hasCompleteBookingDetails && normalizeBookingStatusIntent(asString(bookingStatus)) === "tentative") {
    bookingReviewReason = "booking_still_tentative";
  }

  return {
    leadInserted: Boolean(leadId),
    bookingInserted: Boolean(bookingId),
    bookingStatus: bookingStatus || null,
    bookingExistsForDate: Boolean(existingDateBookingId),
    hasCompleteBookingDetails,
    requestedDate: requestedDate || null,
    requestedTime: requestedTime || null,
    requestedTimeAllowed: isAllowedSlotTime(requestedTime),
    bookingReviewReason,
    mapsPresent: Boolean(asString(mapsUrl)),
    missingFields: missingFields || [],
    buyerFacingMissingFields,
  };
}

function deriveMissingFields({
  intelligence,
  resolvedRefs,
}: {
  intelligence: any;
  resolvedRefs: any;
}) {
  const missing: string[] = [];
  const hasVehicleText = Boolean(asString(intelligence?.extracted?.vehicleText));
  if (!asString(intelligence?.extracted?.customerName)) missing.push("name");
  if (!asString(intelligence?.extracted?.customerPhone)) missing.push("phone");
  if (!isCompleteAddressText(asString(intelligence?.extracted?.addressText))) missing.push("address");
  if (!asString(intelligence?.extracted?.scheduleDate)) missing.push("schedule_date");
  if (!asString(intelligence?.extracted?.scheduleTime) || !isAllowedSlotTime(asString(intelligence?.extracted?.scheduleTime))) {
    missing.push("schedule_time");
  }
  if (!resolvedRefs?.branch?.id) missing.push("branch");
  if (!resolvedRefs?.vehicle?.id && !hasVehicleText) missing.push("vehicle");
  return missing;
}

async function syncCekatLabels({
  conversationId,
  syncStatus,
  looksConversationallyBooked = false,
}: {
  conversationId: string;
  syncStatus: {
    leadInserted: boolean;
    bookingInserted: boolean;
    bookingStatus?: string | null;
    bookingExistsForDate?: boolean;
    hasCompleteBookingDetails: boolean;
    bookingReviewReason: string | null;
    mapsPresent?: boolean;
    missingFields?: string[];
  };
  looksConversationallyBooked?: boolean;
}) {
  if (!cekatAccessToken || !conversationId) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_cekat_access_token_or_conversation",
    };
  }

  const labelsToAssign: string[] = [];
  const hasOpenBookingRecord =
    !!(syncStatus.bookingInserted || syncStatus.bookingExistsForDate) && isOpenBookingStatus(syncStatus.bookingStatus);
  const buyerFacingMissingFields = deriveBuyerFacingRequiredFields(syncStatus.missingFields || []);
  const bookingRecordIsOperationallyReady =
    hasOpenBookingRecord &&
    syncStatus.hasCompleteBookingDetails &&
    buyerFacingMissingFields.length === 0;
  if (syncStatus.leadInserted) labelsToAssign.push("AI Data Buyer Sudah Dicatat");
  if (bookingRecordIsOperationallyReady) {
    labelsToAssign.push(syncStatus.bookingStatus === "tentative" ? "AI Booking Masih Draft" : "AI Booking Sudah Fix");
  } else if (hasOpenBookingRecord) {
    labelsToAssign.push("AI Booking Masih Draft");
  }
  if (!hasOpenBookingRecord && (syncStatus.hasCompleteBookingDetails || looksConversationallyBooked)) {
    labelsToAssign.push("AI Jadwal Belum Fix");
  }
  if (buyerFacingMissingFields.includes("vehicle")) labelsToAssign.push("AI Butuh Type Mobil");
  if (buyerFacingMissingFields.length > 0 && !buyerFacingMissingFields.includes("vehicle")) labelsToAssign.push("AI Butuh Data Buyer Tambahan");
  if (hasOpenBookingRecord) {
    labelsToAssign.push(syncStatus.mapsPresent ? "AI Link Maps Sudah Tersimpan" : "AI Menunggu Link Maps Buyer");
  }
  if (labelsToAssign.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "no_labels_needed",
    };
  }

  const headers = {
    access_token: cekatAccessToken,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
  };

  const labelsResponse = await fetch("https://server.cekat.ai/labels", {
    method: "GET",
    headers,
  });
  const labelsBody = await labelsResponse.json().catch(() => null);
  if (!labelsResponse.ok) {
    throw new Error(`Gagal ambil label Cekat: ${labelsResponse.status} ${JSON.stringify(labelsBody)}`);
  }

  const existingLabels = Array.isArray(labelsBody?.data?.labels) ? labelsBody.data.labels : [];
  const labelMap = new Map(existingLabels.map((label: Record<string, unknown>) => [normalizeText(asString(label.name)), label]));

  for (const definition of CEKAT_SYNC_LABELS) {
    if (labelMap.has(normalizeText(definition.name))) continue;
    const createResponse = await fetch("https://server.cekat.ai/labels", {
      method: "POST",
      headers,
      body: JSON.stringify(definition),
    });
    const createBody = await createResponse.json().catch(() => null);
    if (!createResponse.ok) {
      throw new Error(`Gagal buat label Cekat ${definition.name}: ${createResponse.status} ${JSON.stringify(createBody)}`);
    }
    const created = (createBody?.data || createBody) as Record<string, unknown>;
    labelMap.set(normalizeText(definition.name), created);
  }

  const assignedResponse = await fetch(`https://server.cekat.ai/labels/assign?conversation_id=${encodeURIComponent(conversationId)}`, {
    method: "GET",
    headers,
  });
  const assignedBody = await assignedResponse.json().catch(() => null);
  if (!assignedResponse.ok) {
    throw new Error(`Gagal ambil label conversation: ${assignedResponse.status} ${JSON.stringify(assignedBody)}`);
  }
  const assignedEntries = Array.isArray(assignedBody?.data) ? assignedBody.data : [];
  const assignedIds = new Set(
    assignedEntries
      .map((entry: Record<string, unknown>) => asString((entry.label as Record<string, unknown> | undefined)?.id || entry.label_id || entry.id))
      .filter(Boolean),
  );
  const assignmentsToRemove: Array<{ assignmentId: string; name: string }> = [];
  const oppositePairs = new Map<string, string>([
    ["AI Link Maps Sudah Tersimpan", "AI Menunggu Link Maps Buyer"],
    ["AI Menunggu Link Maps Buyer", "AI Link Maps Sudah Tersimpan"],
    ["AI Booking Masih Draft", "AI Booking Sudah Fix"],
    ["AI Booking Sudah Fix", "AI Booking Masih Draft"],
  ]);
  const namesToKeep = new Set(labelsToAssign.map((name) => normalizeText(name)));
  const managedLabelNames = new Set(CEKAT_SYNC_LABELS.map((definition) => normalizeText(asString(definition.name))));
  const namesToRetire = new Set<string>();
  for (const name of labelsToAssign) {
    for (const legacyName of CEKAT_LABEL_LEGACY_ALIASES[name] || []) {
      namesToRetire.add(normalizeText(legacyName));
    }
    const oppositeName = oppositePairs.get(name);
    if (oppositeName && !namesToKeep.has(normalizeText(oppositeName))) {
      namesToRetire.add(normalizeText(oppositeName));
      for (const legacyName of CEKAT_LABEL_LEGACY_ALIASES[oppositeName] || []) {
        namesToRetire.add(normalizeText(legacyName));
      }
    }
  }
  for (const [currentName, legacyNames] of Object.entries(CEKAT_LABEL_LEGACY_ALIASES)) {
    if (namesToKeep.has(normalizeText(currentName))) continue;
    for (const legacyName of legacyNames) {
      namesToRetire.add(normalizeText(legacyName));
    }
  }
  for (const entry of assignedEntries) {
    const assignmentId = asString(entry.id);
    const labelName = normalizeText(asString((entry.label as Record<string, unknown> | undefined)?.name));
    if (!assignmentId || !labelName) continue;
    if (managedLabelNames.has(labelName) && !namesToKeep.has(labelName)) {
      assignmentsToRemove.push({
        assignmentId,
        name: asString((entry.label as Record<string, unknown> | undefined)?.name),
      });
      continue;
    }
    if (!namesToRetire.has(labelName)) continue;
    assignmentsToRemove.push({
      assignmentId,
      name: asString((entry.label as Record<string, unknown> | undefined)?.name),
    });
  }

  for (const assignment of assignmentsToRemove) {
    const removeResponse = await fetch(`https://server.cekat.ai/labels/assign/${encodeURIComponent(assignment.assignmentId)}`, {
      method: "DELETE",
      headers,
    });
    const removeBody = await removeResponse.json().catch(() => null);
    if (!removeResponse.ok && removeResponse.status !== 404) {
      throw new Error(`Gagal hapus label lama ${assignment.name}: ${removeResponse.status} ${JSON.stringify(removeBody)}`);
    }
  }

  const applied: string[] = [];
  for (const name of labelsToAssign) {
    const label = labelMap.get(normalizeText(name));
    const labelId = asString((label as Record<string, unknown> | undefined)?.id);
    if (!labelId || assignedIds.has(labelId)) continue;
    const assignResponse = await fetch(`https://server.cekat.ai/labels/assign?conversation_id=${encodeURIComponent(conversationId)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label_id: labelId }),
    });
    const assignBody = await assignResponse.json().catch(() => null);
    if (!assignResponse.ok) {
      if (assignResponse.status === 400) {
        continue;
      }
      throw new Error(`Gagal assign label ${name}: ${assignResponse.status} ${JSON.stringify(assignBody)}`);
    }
    applied.push(name);
  }

  return {
    ok: true,
    applied,
    intended: labelsToAssign,
  };
}

function normalizeText(value: string) {
  return compactText(String(value || "").toLowerCase());
}

function compactText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePersonForMatch(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressForMatch(value: string) {
  return normalizeText(value)
    .replace(/(?:\+?62|0)\d{8,14}/g, " ")
    .replace(/\b(nomor|nomer|whatsapp|wa|telp|telepon|hp)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(" ").filter((token) => token.length >= 3));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length >= 3));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function isConfidentCustomerName(value: string, socialUsername = "") {
  const raw = asString(value);
  if (!raw) return false;
  if (!validateName(raw).valid) return false;
  if (looksLikeGreetingOnlyName(raw)) return false;
  if (looksLikeNonNameCustomerPhrase(raw)) return false;
  const normalized = normalizePersonForMatch(raw);
  if (!normalized) return false;
  if (/[0-9_.]/.test(raw)) return false;
  if (socialUsername && normalized === normalizePersonForMatch(socialUsername)) return false;
  if (normalized.length < 3) return false;
  return true;
}

function looksLikeGreetingOnlyName(value: string) {
  const phrase = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase) return false;
  if (GREETING_ONLY_NAME_PHRASES.has(phrase)) return true;
  if (/^(oh )?(ok|oke)$/.test(phrase)) return true;
  if (/^(chat|lead) cekat$/.test(phrase)) return true;
  if (/^(brp|berapa) harganya$/.test(phrase)) return true;
  if (/^bisa minta info harganya?$/.test(phrase)) return true;
  return /^(pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam)( kak)?$/.test(phrase);
}

function looksLikeNonNameCustomerPhrase(value: string) {
  const phrase = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase) return false;
  const cleaned = cleanFragment(value);
  if (looksLikeAreaFragment(cleaned)) return true;
  if (looksLikeAddressFragment(cleaned)) return true;
  if (/^(brp|berapa)(\s+\w+){0,3}$/.test(phrase)) return true;
  if (/^(booking|book)(\s+\w+){0,3}$/.test(phrase)) return true;
  if (/\b(harga|harganya|nomer|nomor|wa|whatsapp|telp|telepon|panggil|kerumah|krmh|dirumah|rumah|bisa|boleh|ada|minta|cari|nanti|dulu|libur|kerja)\b/.test(phrase)) return true;
  if (/\b(ka|kak|min|admin|bro|sis)\b/.test(phrase) && phrase.split(" ").length <= 3) return true;
  return false;
}

function selectBestCustomerName({
  extractedCustomerName,
  displayName,
  socialUsername,
  existingName,
}: {
  extractedCustomerName: string;
  displayName: string;
  socialUsername?: string;
  existingName?: string;
}) {
  if (isConfidentCustomerName(extractedCustomerName, socialUsername || "")) return compactText(extractedCustomerName);
  if (isConfidentCustomerName(existingName || "", socialUsername || "")) return compactText(existingName || "");
  if (isConfidentCustomerName(displayName, socialUsername || "")) return compactText(displayName);
  return "";
}

function accumulateCustomerProfile(
  messages: Array<{
    senderRole: string;
    text: string;
    attachments: Array<unknown>;
  }>,
  normalized: ReturnType<typeof normalizePayload>,
) {
  const areaParts: string[] = [];
  const addressParts: string[] = [];
  let customerName = "";
  let customerPhone = normalizePhone(normalized.customerPhone || "");
  let vehicleText = "";
  let scheduleDate = "";
  let scheduleTime = "";
  let mapsUrl = "";

  const pushUnique = (bucket: string[], value: string) => {
    const cleaned = cleanFragment(value);
    if (!cleaned) return;
    const normalizedValue = normalizeText(cleaned);
    if (!normalizedValue) return;
    if (!bucket.some((item) => normalizeText(item) === normalizedValue)) {
      bucket.push(cleaned);
    }
  };

  for (const message of messages) {
    if (message.senderRole !== "customer") continue;
    const text = cleanFragment(message.text);
    if (!text) continue;

    const lines = String(text)
      .split(/\n+/)
      .map((line) => cleanFragment(line))
      .filter(Boolean);

    const explicitName = extractName(text);
    if (explicitName && isConfidentCustomerName(explicitName, normalized.socialUsername)) {
      customerName = explicitName;
    }

    const standaloneName = extractStandaloneNameCandidate(text, normalized.socialUsername);
    if (!customerName && standaloneName) {
      customerName = standaloneName;
    }

    const detectedPhone = extractPhone(text);
    if (detectedPhone) {
      customerPhone = normalizePhone(detectedPhone);
    }

    const detectedVehicle = extractVehicle(text);
    if (detectedVehicle && isStrongVehicleCandidate(detectedVehicle)) {
      vehicleText = detectedVehicle;
    }

    const detectedDate = extractDate(
      text,
      asString((message as Record<string, unknown>).createdAt || (message as Record<string, unknown>).created_at),
    );
    if (detectedDate) {
      scheduleDate = detectedDate;
    }

    const detectedTime = normalizeRequestedScheduleTime(extractTime(text));
    if (detectedTime) {
      scheduleTime = detectedTime;
    }

    const detectedMaps = extractMapsUrl(text);
    if (detectedMaps) {
      mapsUrl = detectedMaps;
    }

    const explicitAddress = extractAddress(text);
    if (explicitAddress) {
      pushUnique(addressParts, explicitAddress);
    }

    const explicitArea = extractArea(text);
    if (explicitArea) {
      pushUnique(areaParts, explicitArea);
    }

    for (const line of lines) {
      if (!line) continue;
      if (extractPhone(line)) continue;
      if (
        extractDate(
          line,
          asString((message as Record<string, unknown>).createdAt || (message as Record<string, unknown>).created_at),
        ) || extractTime(line)
      ) continue;
      if (extractMapsUrl(line)) continue;
      if (extractVehicle(line)) continue;
      if (extractName(line)) continue;
      if (isStandaloneNameCandidate(line, normalized.socialUsername)) continue;

      if (looksLikeAddressFragment(line)) {
        pushUnique(addressParts, line);
        continue;
      }

      if (looksLikeAreaFragment(line)) {
        pushUnique(areaParts, line);
      }
    }
  }

  const areaText = combineFragments(areaParts);
  const addressText = buildAddressFromFragments({
    areaParts,
    addressParts,
    fallbackAddress: normalized.booking.address || normalized.extracted.addressText || "",
  });

  return {
    customerName,
    customerPhone,
    vehicleText,
    areaText,
    addressText,
    scheduleDate,
    scheduleTime,
    mapsUrl,
  };
}

function extractConfirmedAdminProfile(
  messages: Array<{
    senderRole: string;
    text: string;
    attachments: Array<unknown>;
  }>,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.senderRole === "customer") continue;
    const text = cleanFragment(message.text);
    if (!text) continue;
    if (!/booking sudah kami amankan|slotnya sudah kami amankan|sudah saya catat untuk tanggal|berikut konfirmasinya|jadwal sudah kami catat|sudah kami amankan untuk tanggal|data booking sudah saya catat/i.test(normalizeText(text))) {
      continue;
    }
    const labeledFields = extractLabeledBookingFields(text);
    return {
      customerName: labeledFields.customerName || extractName(text),
      customerPhone: normalizePhone(labeledFields.customerPhone || extractPhone(text)),
      addressText: labeledFields.addressText || extractAddress(text),
      scheduleDate: extractDate(text, asString((message as Record<string, unknown>).createdAt)),
      scheduleTime: normalizeRequestedScheduleTime(extractTime(text)),
      mapsUrl: extractMapsUrl(text),
    };
  }

  return {
    customerName: "",
    customerPhone: "",
    addressText: "",
    scheduleDate: "",
    scheduleTime: "",
    mapsUrl: "",
  };
}

function extractLabeledBookingFields(text: string) {
  const source = String(text || "");
  const customerNameMatch = source.match(
    /(?:^|[,\n])\s*\**\s*(?:nama|atas nama)\s*\**\s*[:\-]?\s*([a-z][a-z .'-]{1,60}?)(?=(?:,?\s*\**\s*(?:alamat|wa|whatsapp|nomor|no\.?\s*(?:wa|hp)|telepon|telp)\s*\**\s*[:\-])|$)/i,
  );
  const addressMatch = source.match(
    /(?:^|[,\n])\s*\**\s*alamat(?: lengkap)?\s*\**\s*[:\-]?\s*(.+?)(?=(?:,?\s*\**\s*(?:wa|whatsapp|nomor|no\.?\s*(?:wa|hp)|telepon|telp)\s*\**\s*[:\-])|$)/i,
  );
  const phoneMatch = source.match(
    /(?:^|[,\n])\s*\**\s*(?:wa|whatsapp|nomor|no\.?\s*(?:wa|hp)|telepon|telp)\s*\**\s*[:\-]?\s*((?:\+?62|0)\d{8,14})/i,
  );

  return {
    customerName: (() => {
      const candidate = cleanFragment(customerNameMatch?.[1] || "");
      return looksLikeGreetingOnlyName(candidate) ? "" : candidate;
    })(),
    addressText: cleanFragment(addressMatch?.[1] || ""),
    customerPhone: cleanFragment(phoneMatch?.[1] || ""),
  };
}

function extractStandaloneNameCandidate(text: string, socialUsername: string) {
  const cleaned = cleanFragment(text);
  if (!cleaned) return "";
  if (!isStandaloneNameCandidate(cleaned, socialUsername)) return "";
  return cleaned;
}

function isStandaloneNameCandidate(text: string, socialUsername: string) {
  const cleaned = cleanFragment(text);
  if (!cleaned) return false;
  if (isToolTraceNoise(cleaned)) return false;
  if (looksLikeGreetingOnlyName(cleaned)) return false;
  if (cleaned.length < 2 || cleaned.length > 40) return false;
  if (cleaned.split(/\s+/).filter(Boolean).length > 3) return false;
  if (/[0-9]/.test(cleaned)) return false;
  if (/[?.,/\\]/.test(cleaned)) return false;
  if (!/^[a-zA-Z\s.'-]+$/.test(cleaned)) return false;

  const normalizedValue = normalizeText(cleaned);
  if (!normalizedValue) return false;
  if (looksLikeNonNameCustomerPhrase(cleaned)) return false;
  if (normalizedValue.includes("nama")) return false;
  if (normalizedValue.includes("alamat")) return false;
  if (normalizedValue.includes("wa") || normalizedValue.includes("whatsapp")) return false;
  if (normalizedValue.includes("jakarta") || normalizedValue.includes("depok") || normalizedValue.includes("bekasi")) return false;
  if (normalizedValue.includes("mobil") || normalizedValue.includes("headlamp")) return false;
  if (/\b(saya|aku|coba|cari|tempat|tepat|dulu|nanti|mohon|maaf|bisa|boleh|butuh|perlu|diparkir|parkiran)\b/i.test(normalizedValue)) return false;

  return isConfidentCustomerName(cleaned, socialUsername);
}

function cleanFragment(value: string) {
  return asString(value)
    .replace(/\s+/g, " ")
    .replace(/^[,.;:-]+/, "")
    .replace(/[,.;:-]+$/, "")
    .trim();
}

function isToolTraceNoise(value: string) {
  const cleaned = cleanFragment(value);
  if (!cleaned) return false;
  if (cleaned.length > 400) return true;
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) return true;
  return /Successfully executed tool calls|tool_call_message|call_id|customerFacingSummary|humanSummary|recommendedNextQuestion|No handoff needed|Handing off to human|Ai Agent assigned|Instagram shared content received|Facebook shared content received|\"source\"\\s*:\\s*\"cekat-|\"availability\"\\s*:|\"technicianBreakdown\"\\s*:|\"nextAvailableDateOptions\"\\s*:/i.test(cleaned);
}

function isConversationNoiseFragment(value: string) {
  const cleaned = cleanFragment(value);
  if (!cleaned) return false;
  const normalizedValue = normalizeText(cleaned);
  if (!normalizedValue) return false;
  if (isToolTraceNoise(cleaned)) return true;
  return /\b(instagram shared content received|facebook shared content received|nanti saya hub|nnti saya hub|terima kasih|makasih|trimakasih|sama sama|oh oke|oh ok|oke ka|oke kak|siap kak|baik kak|weekend|hari ini memungkinkan|bisa minta info harga)\b/i.test(normalizedValue);
}

function looksLikeAddressFragment(text: string) {
  const cleaned = cleanFragment(text);
  if (!cleaned) return false;
  if (isConversationNoiseFragment(cleaned)) return false;
  const normalizedValue = normalizeText(cleaned);
  if (!normalizedValue) return false;
  if (/harga|biaya|jadwal|tanggal|jam|slot|besok|today|hari ini|weekend|payment|bayar/i.test(normalizedValue)) {
    return false;
  }

  const hasStreetCue = /(jl|jalan|\bgg\b|gang|blok|block|no\\b|nomor|rt|rw|perum|komplek|komp|cluster|sektor|kav|desa|kel|kec|kecamatan|kab|kabupaten|kota|ruko|rumah|residence|permai|indah)/i
    .test(cleaned);
  if (hasStreetCue) return true;

  const segmentCount = cleaned.split(",").map((part) => part.trim()).filter(Boolean).length;
  return /[0-9]/.test(cleaned) && segmentCount >= 2 && !/[?]/.test(cleaned);
}

function looksLikeAreaFragment(text: string) {
  const cleaned = cleanFragment(text);
  if (!cleaned) return false;
  if (isConversationNoiseFragment(cleaned)) return false;
  const normalizedValue = normalizeText(cleaned);
  if (!normalizedValue) return false;
  if (normalizedValue.length < 3 || normalizedValue.length > 80) return false;
  if (/[?]/.test(cleaned)) return false;
  if (/harga|biaya|jadwal|tanggal|jam|slot|besok|today|hari ini|weekend|payment|bayar|merk|mercy|serena|livina|bmw|retak|kusam|kuning|embun|foto|listrik|parkir|parkiran|akhir bulan|pengerjaan|membutuhkan|coba|cari|tempat|mitsubishi|suzuki|honda|toyota|nissan|daihatsu|mazda|peugeot|land rover|hyundai|wuling|kuda|grandia|swift|karimun|3008/i.test(normalizedValue)) {
    return false;
  }
  if (/^((baik|oke|ok|owh|siap|terima kasih|makasih|thank you|trimakasih|boleh|bisa|iya|ya|engga|tidak|ga|gak)\b|.*\bkak\b.*)$/.test(normalizedValue)) {
    return false;
  }
  if (looksLikeAddressFragment(cleaned)) return false;
  if (extractPhone(cleaned)) return false;
  if (extractDate(cleaned) || extractTime(cleaned)) return false;

  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return wordCount >= 1 && wordCount <= 6;
}

function combineFragments(parts: string[]) {
  return parts
    .map((part) => cleanFragment(part))
    .filter(Boolean)
    .filter((part, index, array) => array.findIndex((candidate) => normalizeText(candidate) === normalizeText(part)) === index)
    .join(", ");
}

function sanitizeExtractedArea({
  candidate,
  customerText,
  addressText,
  fallbackAreaText,
}: {
  candidate: string;
  customerText: string;
  addressText: string;
  fallbackAreaText: string;
}) {
  const cleanedCandidate = cleanFragment(candidate);
  const normalizedCandidate = normalizeText(cleanedCandidate);
  const isConversationalGarbage =
    !cleanedCandidate ||
    isConversationNoiseFragment(cleanedCandidate) ||
    /^((baik|oke|ok|owh|siap|terima kasih|makasih|thank you|trimakasih|boleh|bisa|iya|ya|engga|tidak|ga|gak)\b|.*\bkak\b.*)$/.test(normalizedCandidate);

  if (!isConversationalGarbage) {
    return cleanedCandidate;
  }

  const fallbackCandidates = [
    extractArea(customerText),
    extractArea(addressText),
    cleanFragment(fallbackAreaText),
  ].map((value) => cleanFragment(value)).filter(Boolean);

  for (const value of fallbackCandidates) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) continue;
    if (/^((baik|oke|ok|owh|siap|terima kasih|makasih|thank you|trimakasih|boleh|bisa|iya|ya|engga|tidak|ga|gak)\b|.*\bkak\b.*)$/.test(normalizedValue)) {
      continue;
    }
    return value;
  }

  return "";
}

function buildAddressFromFragments({
  areaParts,
  addressParts,
  fallbackAddress,
}: {
  areaParts: string[];
  addressParts: string[];
  fallbackAddress: string;
}) {
  const filteredAddressParts = addressParts
    .map((part) => cleanFragment(part))
    .filter(Boolean)
    .filter((part) => looksLikeAddressFragment(part) || isCompleteAddressText(part))
    .filter((part, index, array) => array.findIndex((candidate) => normalizeText(candidate) === normalizeText(part)) === index);

  const filteredAreaParts = areaParts
    .map((part) => cleanFragment(part))
    .filter(Boolean)
    .filter((part) => looksLikeAreaFragment(part))
    .filter((part, index, array) => array.findIndex((candidate) => normalizeText(candidate) === normalizeText(part)) === index);

  const combined = [...filteredAddressParts, ...filteredAreaParts].join(", ").trim();
  if (isCompleteAddressText(combined)) return combined;

  const fallback = cleanFragment(fallbackAddress);
  if (isCompleteAddressText(fallback)) return fallback;

  if (!filteredAddressParts.length) return "";

  return combined || fallback;
}

function resolveConversationAddress({
  bookingAddress,
  customerAddress,
  accumulatedAddress,
  confirmedAdminAddress,
  payloadAddress,
  adminAddress,
  areaText,
}: {
  bookingAddress: string;
  customerAddress: string;
  accumulatedAddress: string;
  confirmedAdminAddress: string;
  payloadAddress: string;
  adminAddress: string;
  areaText: string;
}) {
  const candidates = [
    cleanFragment(bookingAddress),
    cleanFragment(customerAddress),
    cleanFragment(accumulatedAddress),
    cleanFragment(confirmedAdminAddress),
    cleanFragment(payloadAddress),
    cleanFragment(adminAddress),
  ].filter(Boolean);

  const uniqueCandidates = candidates.filter(
    (part, index, array) => array.findIndex((candidate) => normalizeText(candidate) === normalizeText(part)) === index,
  );

  const bestCandidate = [...uniqueCandidates].sort((left, right) => addressSpecificityScore(right) - addressSpecificityScore(left))[0] || "";
  if (isCompleteAddressText(bestCandidate)) return bestCandidate;

  const merged = buildAddressFromFragments({
    areaParts: areaText ? areaText.split(",").map((part) => cleanFragment(part)).filter(Boolean) : [],
    addressParts: uniqueCandidates,
    fallbackAddress: bestCandidate,
  });

  return merged || bestCandidate;
}

function addressSpecificityScore(value: string) {
  const cleaned = cleanFragment(value);
  if (!cleaned) return 0;
  const segmentCount = cleaned.split(",").map((part) => part.trim()).filter(Boolean).length;
  const hasStreetCue = /(jl|jalan|gg|gang|blok|block|no\b|nomor|rt|rw|perum|komplek|komp|cluster|sektor|kav|desa|kel|kec|kecamatan|kab|kabupaten|kota|ruko|rumah)/i.test(cleaned);
  const hasDigits = /[0-9]/.test(cleaned);
  return (
    (isCompleteAddressText(cleaned) ? 100 : 0) +
    segmentCount * 10 +
    (hasStreetCue ? 15 : 0) +
    (hasDigits ? 10 : 0) +
    Math.min(cleaned.length, 80) / 10
  );
}

function isCompleteAddressText(value: string) {
  const cleaned = cleanFragment(value);
  if (!cleaned || cleaned.length < 10) return false;
  const validation = validateAddressSufficiency({ address_text: cleaned });
  if (validation.sufficient) return true;
  const segmentCount = cleaned.split(",").map((part) => part.trim()).filter(Boolean).length;
  const hasStreetCue =
    /(jl|jalan|gg|gang|blok|block|no\\b|nomor|rt|rw|perum|komplek|komp|cluster|sektor|kav|desa|kel|kec|kecamatan|kab|kabupaten|kota|ruko|rumah)/i
      .test(cleaned);
  const hasDigits = /[0-9]/.test(cleaned);

  return hasStreetCue || (segmentCount >= 3 && hasDigits);
}

function isStrongVehicleCandidate(value: string) {
  const cleaned = cleanFragment(value);
  if (!cleaned) return false;
  const normalizedValue = normalizeText(cleaned);
  if (!normalizedValue) return false;
  return !/(harga|biaya|jadwal|tanggal|jam|alamat|nomor|whatsapp|wa|jadi|untuk|besok|hari|produk|lokasi)/i.test(normalizedValue);
}

function buildFieldConfidence({
  normalized,
  accumulatedProfile,
  extractedName,
  extractedPhone,
  extractedVehicle,
  extractedArea,
  extractedAddress,
  extractedDate,
  extractedTime,
  extractedMapsUrl,
}: {
  normalized: ReturnType<typeof normalizePayload>;
  accumulatedProfile: {
    customerName: string;
    customerPhone: string;
    vehicleText: string;
    areaText: string;
    addressText: string;
    scheduleDate: string;
    scheduleTime: string;
    mapsUrl: string;
  };
  extractedName: string;
  extractedPhone: string;
  extractedVehicle: string;
  extractedArea: string;
  extractedAddress: string;
  extractedDate: string;
  extractedTime: string;
  extractedMapsUrl: string;
}) {
  const fromCustomerName = Boolean(accumulatedProfile.customerName || extractName(normalized.messages.filter((message) => message.senderRole === "customer").map((message) => message.text).join("\n")));
  const fromCustomerPhone = Boolean(accumulatedProfile.customerPhone || normalized.customerPhone);
  const fromCustomerVehicle = Boolean(accumulatedProfile.vehicleText);
  const areaPartsCount = accumulatedProfile.areaText
    ? accumulatedProfile.areaText.split(",").map((part) => part.trim()).filter(Boolean).length
    : 0;
  const addressPartsCount = extractedAddress
    ? extractedAddress.split(",").map((part) => part.trim()).filter(Boolean).length
    : 0;

  return {
    customerName: !extractedName
      ? "missing"
      : fromCustomerName
        ? "high"
        : isConfidentCustomerName(normalized.displayName, normalized.socialUsername)
          ? "medium"
          : "low",
    customerPhone: !extractedPhone
      ? "missing"
      : fromCustomerPhone
        ? "high"
        : "medium",
    vehicleText: !extractedVehicle
      ? "missing"
      : fromCustomerVehicle || normalized.booking.vehicleId
        ? "high"
        : isStrongVehicleCandidate(extractedVehicle)
          ? "medium"
          : "low",
    areaText: !extractedArea
      ? "missing"
      : areaPartsCount >= 2
        ? "high"
        : areaPartsCount === 1
          ? "medium"
          : "low",
    addressText: !extractedAddress
      ? "missing"
      : isCompleteAddressText(extractedAddress)
        ? "high"
        : addressPartsCount >= 2
          ? "medium"
          : "low",
    scheduleDate: !extractedDate
      ? "missing"
      : accumulatedProfile.scheduleDate || normalized.booking.scheduleDate
        ? "high"
        : "medium",
    scheduleTime: !extractedTime
      ? "missing"
      : isAllowedSlotTime(extractedTime)
        ? "high"
        : "low",
    mapsUrl: !extractedMapsUrl
      ? "missing"
      : "high",
  };
}

function buildConversationMemory({
  normalized,
  accumulatedProfile,
  confirmedAdminProfile,
  extracted,
  fieldConfidence,
}: {
  normalized: ReturnType<typeof normalizePayload>;
  accumulatedProfile: {
    customerName: string;
    customerPhone: string;
    vehicleText: string;
    areaText: string;
    addressText: string;
    scheduleDate: string;
    scheduleTime: string;
    mapsUrl: string;
  };
  confirmedAdminProfile: {
    customerName: string;
    customerPhone: string;
    addressText: string;
    scheduleDate: string;
    scheduleTime: string;
    mapsUrl: string;
  };
  extracted: {
    customerName: string;
    customerPhone: string;
    vehicleText: string;
    areaText: string;
    addressText: string;
    scheduleDate: string;
    scheduleTime: string;
    mapsUrl: string;
  };
  fieldConfidence: Record<string, string>;
}) {
  const fields = {
    customerName: buildMemoryField({
      kind: "text",
      value: extracted.customerName,
      confidence: fieldConfidence.customerName || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.customerName },
        { source: "customer_fragments", value: accumulatedProfile.customerName },
        { source: "admin_confirmed", value: confirmedAdminProfile.customerName },
        { source: "payload_extracted", value: normalized.extracted.customerName },
        { source: "display_name_fallback", value: isConfidentCustomerName(normalized.displayName, normalized.socialUsername) ? normalized.displayName : "" },
      ],
    }),
    customerPhone: buildMemoryField({
      kind: "phone",
      value: extracted.customerPhone,
      confidence: fieldConfidence.customerPhone || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.customerPhone },
        { source: "customer_fragments", value: accumulatedProfile.customerPhone },
        { source: "admin_confirmed", value: confirmedAdminProfile.customerPhone },
        { source: "contact_profile", value: normalized.customerPhone },
        { source: "payload_extracted", value: normalized.extracted.customerPhone },
      ],
    }),
    vehicleText: buildMemoryField({
      kind: "text",
      value: extracted.vehicleText,
      confidence: fieldConfidence.vehicleText || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.vehicleId },
        { source: "customer_fragments", value: accumulatedProfile.vehicleText },
        { source: "payload_extracted", value: normalized.extracted.vehicleText },
      ],
    }),
    areaText: buildMemoryField({
      kind: "text",
      value: extracted.areaText,
      confidence: fieldConfidence.areaText || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.areaId },
        { source: "customer_fragments", value: accumulatedProfile.areaText },
        { source: "payload_extracted", value: normalized.extracted.areaText },
      ],
    }),
    addressText: buildMemoryField({
      kind: "text",
      value: extracted.addressText,
      confidence: fieldConfidence.addressText || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.address },
        { source: "customer_fragments", value: accumulatedProfile.addressText },
        { source: "admin_confirmed", value: confirmedAdminProfile.addressText },
        { source: "payload_extracted", value: normalized.extracted.addressText },
      ],
    }),
    scheduleDate: buildMemoryField({
      kind: "date",
      value: extracted.scheduleDate,
      confidence: fieldConfidence.scheduleDate || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.scheduleDate },
        { source: "admin_confirmed", value: confirmedAdminProfile.scheduleDate },
        { source: "customer_fragments", value: accumulatedProfile.scheduleDate },
        { source: "payload_extracted", value: normalized.extracted.scheduleDate },
      ],
    }),
    scheduleTime: buildMemoryField({
      kind: "time",
      value: extracted.scheduleTime,
      confidence: fieldConfidence.scheduleTime || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.scheduleTime },
        { source: "admin_confirmed", value: confirmedAdminProfile.scheduleTime },
        { source: "customer_fragments", value: accumulatedProfile.scheduleTime },
        { source: "payload_extracted", value: normalized.extracted.scheduleTime },
      ],
    }),
    mapsUrl: buildMemoryField({
      kind: "text",
      value: extracted.mapsUrl,
      confidence: fieldConfidence.mapsUrl || "missing",
      candidates: [
        { source: "booking_payload", value: normalized.booking.mapsUrl },
        { source: "customer_fragments", value: accumulatedProfile.mapsUrl },
        { source: "admin_confirmed", value: confirmedAdminProfile.mapsUrl },
        { source: "payload_extracted", value: normalized.extracted.mapsUrl },
      ],
    }),
  };

  const criticalFields = ["customerName", "customerPhone", "vehicleText", "addressText", "scheduleDate", "scheduleTime"];
  const capturedCritical = criticalFields.filter((field) => asString((fields as Record<string, any>)[field]?.value));

  return {
    fields,
    completeness: {
      capturedCriticalCount: capturedCritical.length,
      totalCriticalCount: criticalFields.length,
      missingCriticalFields: criticalFields.filter((field) => !asString((fields as Record<string, any>)[field]?.value)),
    },
  };
}

function buildMemoryField({
  kind,
  value,
  confidence,
  candidates,
}: {
  kind: "text" | "phone" | "date" | "time";
  value: string;
  confidence: string;
  candidates: Array<{ source: string; value: string }>;
}) {
  const cleanedValue = cleanFragment(value);
  if (!cleanedValue) {
    return {
      value: "",
      source: "missing",
      confidence: confidence || "missing",
    };
  }

  const matched = candidates.find((candidate) => sameMemoryFieldValue(kind, cleanedValue, candidate.value));

  return {
    value: cleanedValue,
    source: matched?.source || "derived_merge",
    confidence: confidence || "medium",
  };
}

function sameMemoryFieldValue(kind: "text" | "phone" | "date" | "time", left: string, right: string) {
  if (!left || !right) return false;
  if (kind === "phone") return normalizePhone(left) === normalizePhone(right);
  if (kind === "time") return snapToAllowedTime(left) === snapToAllowedTime(right);
  if (kind === "date") return asString(left).trim() === asString(right).trim();
  return normalizeText(left) === normalizeText(right);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export default app;
