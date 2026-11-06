// Deterministic pricing guard for Polesheadlamp.id
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §6.2, §7.4, §14

import type { AreaTier, CoverageStatus } from "./area_resolver.ts";
import { resolveConditionEvidence } from "./condition_evidence.ts";

export type VehicleClassId =
  | "veh_car_small"
  | "veh_suv_small"
  | "veh_suv_large"
  | "veh_mpv"
  | "veh_pickup"
  | "veh_luxury";

export interface PriceEstimateInput {
  vehicle_class_id?: VehicleClassId | string | null;
  vehicle_text?: string | null;
  area_id?: string | null;
  area_tier?: AreaTier | null;
  coverage_status?: CoverageStatus | null;
  condition_confidence?: "missing" | "broad_only" | "clear" | "photo_verified" | "unclear" | string | null;
  condition_text?: string | null;
  photo_received?: boolean | null;
  service_id?: "svc_headlamp_polish" | "headlamp_polish" | string | null;
  quote_requested?: boolean | null;
  customer_asked_price?: boolean | null;
  customer_intent?: string | null;
  raw_text?: string | null;
  last_customer_message?: string | null;
}

export interface PriceEstimateOutput {
  disclosure_allowed: boolean;
  reason_if_blocked:
    | "vehicle_unknown"
    | "area_unknown"
    | "out_of_coverage"
    | "condition_unclear"
    | "price_not_requested"
    | null;
  service_id: "svc_headlamp_polish";
  base_price_idr: number | null;
  estimated_range_idr: [number, number] | null;
  multiplier_applied: number | null;
  quote_frame_id: string | null;
  customer_facing_text: string;
  next_action:
    | "ask_vehicle"
    | "ask_area"
    | "ask_condition_or_photo"
    | "handoff_or_alternate_area"
    | "continue_qualification"
    | "show_quote_range";
}

const BASE_PRICE_IDR = 350000;

const VEHICLE_MULTIPLIERS: Record<VehicleClassId, number> = {
  veh_car_small: 1.0,
  veh_suv_small: 1.1,
  veh_suv_large: 1.2,
  veh_mpv: 1.1,
  veh_pickup: 1.15,
  veh_luxury: 1.5,
};

export function getPriceEstimate(
  input: PriceEstimateInput,
): PriceEstimateOutput {
  const vehicleClassId = normalizeVehicleClassId(
    input.vehicle_class_id,
    input.vehicle_text,
    input.last_customer_message,
    input.raw_text,
  );
  const conditionConfidence = normalizeConditionConfidence({
    conditionConfidence: input.condition_confidence,
    conditionText: input.condition_text,
    rawText: input.raw_text,
    lastCustomerMessage: input.last_customer_message,
    photoReceived: Boolean(input.photo_received),
  });

  if (!vehicleClassId) {
    return blocked(
      "vehicle_unknown",
      "ask_vehicle",
      "Boleh info merk/model mobilnya kak? Kalau belum hafal tipe lengkap, nama mobilnya saja cukup biar saya arahin estimasi yang paling pas.",
    );
  }
  if (!input.area_id || !input.area_tier || !input.coverage_status) {
    return blocked(
      "area_unknown",
      "ask_area",
      "Boleh info area atau kecamatan kakak di mana? Nanti saya cekkan estimasinya.",
    );
  }
  if (input.coverage_status === "out_of_coverage") {
    return blocked(
      "out_of_coverage",
      "handoff_or_alternate_area",
      "Area itu sementara belum bisa kami cover kak. Kalau ada alamat alternatif yang lebih dekat, boleh saya cekkan.",
    );
  }
  if (conditionConfidence === "missing") {
    return blocked(
      "condition_unclear",
      "ask_condition_or_photo",
      "Boleh kirim foto lampunya atau info apakah ada embun/retak juga kak? Biar estimasinya tidak asal.",
    );
  }
  return {
    disclosure_allowed: true,
    reason_if_blocked: null,
    service_id: "svc_headlamp_polish",
    base_price_idr: BASE_PRICE_IDR,
    estimated_range_idr: [BASE_PRICE_IDR, BASE_PRICE_IDR],
    multiplier_applied: 1,
    quote_frame_id: input.coverage_status === "conditional"
      ? "conditional_area_quote"
      : "standard_home_service_quote",
    customer_facing_text: `Untuk poles headlamp sepasang kanan-kiri di Rp${
      formatIdr(BASE_PRICE_IDR)
    } ya kak, sudah termasuk deep clean, finishing, dan nano coating. Mau saya bantu cek slot hari apa? 😊`,
    next_action: "show_quote_range",
  };
}

function blocked(
  reason: NonNullable<PriceEstimateOutput["reason_if_blocked"]>,
  nextAction: PriceEstimateOutput["next_action"],
  text: string,
): PriceEstimateOutput {
  return {
    disclosure_allowed: false,
    reason_if_blocked: reason,
    service_id: "svc_headlamp_polish",
    base_price_idr: null,
    estimated_range_idr: null,
    multiplier_applied: null,
    quote_frame_id: null,
    customer_facing_text: text,
    next_action: nextAction,
  };
}

function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

const VEHICLE_CLASS_ALIASES: Record<string, VehicleClassId> = {
  veh_city_car: "veh_car_small",
  veh_citycar: "veh_car_small",
  veh_sedan: "veh_car_small",
  veh_hatchback: "veh_car_small",
  sedan: "veh_car_small",
  hatchback: "veh_car_small",
  citycar: "veh_car_small",
  city_car: "veh_car_small",
  veh_suv: "veh_suv_small",
  suv: "veh_suv_small",
  crossover: "veh_suv_small",
  veh_crossover: "veh_suv_small",
  veh_double_cabin: "veh_pickup",
  double_cabin: "veh_pickup",
  veh_premium: "veh_luxury",
  premium: "veh_luxury",
  luxury: "veh_luxury",
};

function normalizeVehicleClassId(
  rawVehicleClassId: unknown,
  ...fallbackTexts: Array<string | null | undefined>
): VehicleClassId | null {
  const normalized = normalizeToken(rawVehicleClassId);
  if (normalized && normalized in VEHICLE_MULTIPLIERS) {
    return normalized as VehicleClassId;
  }
  if (normalized && normalized in VEHICLE_CLASS_ALIASES) {
    return VEHICLE_CLASS_ALIASES[normalized];
  }
  return inferVehicleClassFromText(fallbackTexts.filter(Boolean).join(" "));
}

function inferVehicleClassFromText(text: string): VehicleClassId | null {
  const normalized = normalizeFreeText(text);
  if (!normalized) return null;
  if (/\b(avanza|xenia|innova|livina|ertiga|xpander|mobilio|freed)\b/.test(normalized)) {
    return "veh_mpv";
  }
  if (/\b(brio|jazz|yaris|city|swift|march|agya|ayla|baleno|vios|altis)\b/.test(normalized)) {
    return "veh_car_small";
  }
  if (/\b(terios|rush|hrv|hr-v|creta|corolla cross|cx3|cx-3)\b/.test(normalized)) {
    return "veh_suv_small";
  }
  if (/\b(fortuner|pajero|pajero sport|crv|cr-v|captiva|harrier|santa fe|santafe)\b/.test(normalized)) {
    return "veh_suv_large";
  }
  if (/\b(hilux|triton|ranger|dmax|d-max|pickup|double cabin|doublecabin)\b/.test(normalized)) {
    return "veh_pickup";
  }
  if (/\b(bmw|mercedes|mercy|mini cooper|alphard|vellfire|lexus|camry)\b/.test(normalized)) {
    return "veh_luxury";
  }
  return null;
}

function normalizeConditionConfidence(input: {
  conditionConfidence: unknown;
  conditionText?: string | null;
  rawText?: string | null;
  lastCustomerMessage?: string | null;
  photoReceived?: boolean;
}): "missing" | "broad_only" | "clear" | "photo_verified" {
  return resolveConditionEvidence({
    conditionConfidence: input.conditionConfidence,
    conditionText: input.conditionText,
    rawText: input.rawText,
    lastCustomerMessage: input.lastCustomerMessage,
    photoReceived: input.photoReceived,
  });
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function normalizeFreeText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}
