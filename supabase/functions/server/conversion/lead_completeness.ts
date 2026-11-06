// Deterministic lead completeness scorer.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §7.4, §9.3, §14.4, §30 task 14.

import { validateAddressSufficiency } from "../domain/address_sufficiency.ts";
import { resolveConditionEvidence } from "../domain/condition_evidence.ts";
import { validateName } from "../domain/name_validator.ts";

export type SalesStage =
  | "new_inquiry"
  | "lead_partial"
  | "qualified"
  | "quote_shown"
  | "soft_commit"
  | "booking_pending_confirm"
  | "booking_confirmed"
  | "handoff"
  | "lost";

export interface LeadCompletenessInput {
  service_id?: string | null;
  vehicle_id?: string | null;
  vehicle_text?: string | null;
  area_id?: string | null;
  area_text?: string | null;
  coverage_status?: "covered" | "conditional" | "out_of_coverage" | "unknown" | string | null;
  condition_text?: string | null;
  condition_confidence?: "missing" | "broad_only" | "clear" | "photo_verified" | string | null;
  photo_received?: boolean | null;
  raw_text?: string | null;
  last_customer_message?: string | null;
  customer_name?: string | null;
  contact_phone?: string | null;
  social_username?: string | null;
  address_text?: string | null;
  maps_url?: string | null;
  schedule_date?: string | null;
  schedule_time?: string | null;
  quote_presented?: boolean | null;
  soft_commit_received?: boolean | null;
  booking_confirmed?: boolean | null;
  lost?: boolean | null;
  handoff_required?: boolean | null;
}

export interface LeadCompletenessOutput {
  completeness_score: number;
  ready_for_quote: boolean;
  ready_for_booking: boolean;
  missing_fields: string[];
  missing_operational_fields: string[];
  sales_stage: SalesStage;
  field_status: Record<string, boolean>;
  next_missing_field: string | null;
  suggested_customer_text: string | null;
}

type CompletionField =
  | "service"
  | "vehicle"
  | "area"
  | "condition"
  | "name"
  | "contact"
  | "address"
  | "schedule_date"
  | "schedule_time";

type FieldStatus = Record<CompletionField, boolean>;

const SCORE_WEIGHTS: Array<[CompletionField, number]> = [
  ["service", 0.08],
  ["vehicle", 0.15],
  ["area", 0.15],
  ["condition", 0.12],
  ["name", 0.12],
  ["contact", 0.12],
  ["address", 0.14],
  ["schedule_date", 0.06],
  ["schedule_time", 0.06],
];

export function assessLeadCompleteness(
  input: LeadCompletenessInput,
): LeadCompletenessOutput {
  const name = validateName(input.customer_name);
  const address = validateAddressSufficiency({
    address_text: input.address_text,
    maps_url: input.maps_url,
    area_text: input.area_text,
  });

  const fieldStatus: FieldStatus = {
    service: hasText(input.service_id) || hasServiceHint(input.condition_text),
    vehicle: hasText(input.vehicle_id) || hasText(input.vehicle_text),
    area: hasText(input.area_id) || hasText(input.area_text),
    condition: hasClearCondition({
      conditionConfidence: input.condition_confidence,
      conditionText: input.condition_text,
      rawText: input.raw_text,
      lastCustomerMessage: input.last_customer_message,
      photoReceived: Boolean(input.photo_received),
    }),
    name: name.valid,
    contact: hasValidContact(input.contact_phone) || hasText(input.social_username),
    address: address.sufficient,
    schedule_date: isIsoDate(input.schedule_date),
    schedule_time: isAllowedSlot(input.schedule_time),
  };

  const coverageOk = input.coverage_status !== "out_of_coverage";
  const missingFields = collectMissingFields(fieldStatus, coverageOk);
  const missingOperationalFields = collectMissingOperationalFields(fieldStatus);
  const readyForQuote = fieldStatus.service && fieldStatus.vehicle &&
    fieldStatus.area && fieldStatus.condition && coverageOk;
  const readyForBooking = readyForQuote && fieldStatus.name &&
    fieldStatus.contact && fieldStatus.address && fieldStatus.schedule_date &&
    fieldStatus.schedule_time;

  const score = SCORE_WEIGHTS.reduce(
    (sum, [field, weight]) => sum + (fieldStatus[field] ? weight : 0),
    0,
  );

  const salesStage = inferSalesStage(input, {
    readyForQuote,
    readyForBooking,
    hasAnyField: Object.values(fieldStatus).some(Boolean),
  });
  const nextMissingField = pickNextMissingField(
    missingFields,
    missingOperationalFields,
  );

  return {
    completeness_score: round2(score),
    ready_for_quote: readyForQuote,
    ready_for_booking: readyForBooking,
    missing_fields: missingFields,
    missing_operational_fields: missingOperationalFields,
    sales_stage: salesStage,
    field_status: fieldStatus,
    next_missing_field: nextMissingField,
    suggested_customer_text: suggestedText(nextMissingField, address.suggested_customer_text),
  };
}

function inferSalesStage(
  input: LeadCompletenessInput,
  state: {
    readyForQuote: boolean;
    readyForBooking: boolean;
    hasAnyField: boolean;
  },
): SalesStage {
  if (input.lost) return "lost";
  if (input.handoff_required || input.coverage_status === "out_of_coverage") {
    return "handoff";
  }
  if (input.booking_confirmed) return "booking_confirmed";
  if (state.readyForBooking) return "booking_pending_confirm";
  if (input.soft_commit_received && state.readyForQuote) return "soft_commit";
  if (input.quote_presented && state.readyForQuote) return "quote_shown";
  if (state.readyForQuote) return "qualified";
  return state.hasAnyField ? "lead_partial" : "new_inquiry";
}

function collectMissingFields(
  status: LeadCompletenessOutput["field_status"],
  coverageOk: boolean,
): string[] {
  const missing: string[] = [];
  if (!status.service) missing.push("service");
  if (!status.vehicle) missing.push("vehicle");
  if (!status.area) missing.push("area");
  if (!coverageOk) missing.push("coverage");
  if (!status.condition) missing.push("condition_or_photo");
  if (!status.name) missing.push("customer_name");
  if (!status.contact) missing.push("contact_phone_or_social");
  return missing;
}

function collectMissingOperationalFields(
  status: LeadCompletenessOutput["field_status"],
): string[] {
  const missing: string[] = [];
  if (!status.address) missing.push("address_or_maps");
  if (!status.schedule_date) missing.push("schedule_date");
  if (!status.schedule_time) missing.push("schedule_time");
  return missing;
}

function pickNextMissingField(
  missingFields: string[],
  missingOperationalFields: string[],
): string | null {
  const qualificationPriority = [
    "vehicle",
    "area",
    "condition_or_photo",
    "service",
    "customer_name",
    "contact_phone_or_social",
  ];
  for (const field of qualificationPriority) {
    if (missingFields.includes(field)) return field;
  }

  const operationalPriority = ["address_or_maps", "schedule_date", "schedule_time"];
  for (const field of operationalPriority) {
    if (missingOperationalFields.includes(field)) return field;
  }
  return null;
}

function suggestedText(
  field: string | null,
  addressText: string,
): string | null {
  switch (field) {
    case "vehicle":
      return "Boleh info merk/model mobilnya kak? Kalau belum hafal tipe lengkap, nama mobilnya saja cukup biar saya arahin treatment dan slot yang pas.";
    case "area":
      return "Lokasi kakak area atau kecamatan mana ya?";
    case "condition_or_photo":
      return "Kondisi lampunya menguning, kusam, embun, atau ada retak rambut kak?";
    case "customer_name":
      return "Boleh nama lengkapnya kak?";
    case "contact_phone_or_social":
      return "Nomor WhatsApp aktifnya boleh kak?";
    case "address_or_maps":
      return addressText;
    case "schedule_date":
      return "Mau dibantu jadwalkan hari apa kak?";
    case "schedule_time":
      return "Kakak prefer slot pagi, siang, atau sore?";
    default:
      return null;
  }
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasServiceHint(value: unknown): boolean {
  return /\b(headlamp|lampu|mika|poles)\b/i.test(String(value || ""));
}

function hasClearCondition(input: {
  conditionConfidence: unknown;
  conditionText: unknown;
  rawText?: unknown;
  lastCustomerMessage?: unknown;
  photoReceived?: boolean;
}): boolean {
  const evidence = resolveConditionEvidence({
    conditionConfidence: input.conditionConfidence,
    conditionText: String(input.conditionText || ""),
    rawText: String(input.rawText || ""),
    lastCustomerMessage: String(input.lastCustomerMessage || ""),
    photoReceived: Boolean(input.photoReceived),
  });
  return evidence === "clear" || evidence === "photo_verified";
}

function hasValidContact(value: unknown): boolean {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function isIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function isAllowedSlot(value: unknown): boolean {
  return ["08:00", "10:00", "12:00", "15:00", "17:00"].includes(
    String(value || "").trim(),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
