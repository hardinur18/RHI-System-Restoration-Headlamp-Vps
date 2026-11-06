// Deterministic next-best-close selector.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §14.5-§14.6, §30 task 16.

import type { ObjectionSeverity } from "./objection_classifier.ts";
import type { SalesStage } from "./lead_completeness.ts";

export interface ClosingStrategy {
  id: string;
  when: {
    sales_stage?: SalesStage | string | null;
    objection_id?: string | null;
    severity?: ObjectionSeverity | null;
    availability_known?: boolean | null;
  };
  assistant_goal: string;
  must_ask?: string[];
  must_avoid?: string[];
  suggested_options_template?: string | null;
  handoff_required?: boolean;
}

export interface NextBestCloseInput {
  sales_stage: SalesStage | string;
  objection_id?: string | null;
  severity?: ObjectionSeverity | null;
  availability_known?: boolean | null;
  slot_options?: string[] | null;
  missing_fields?: string[] | null;
  human_required?: boolean | null;
  strategies?: ClosingStrategy[] | null;
}

export interface NextBestCloseOutput {
  strategy_id: string;
  assistant_goal: string;
  must_ask: string[];
  must_avoid: string[];
  suggested_options: string[];
  handoff_required: boolean;
}

export const DEFAULT_CLOSING_STRATEGIES: ClosingStrategy[] = [
  strategy("NBC-001", "qualified", null, null, true, "propose two concrete slot options", ["choose_slot_option"], ["discount mention", "scarcity claim", "price-first"]),
  strategy("NBC-002", "qualified", null, null, false, "check availability before asking for booking commitment", ["preferred_day"], ["inventing slots", "saying fully booked without tool"]),
  strategy("NBC-003", "lead_partial", null, null, null, "collect the single most important missing qualification field", ["next_missing_field"], ["asking many questions", "quoting price"]),
  strategy("NBC-004", "quote_shown", null, null, null, "move from quote to tentative booking", ["hold_preferred_slot"], ["pressure", "fake urgency"]),
  strategy("NBC-005", "quote_shown", "price_expensive", "low", null, "acknowledge price concern, frame included value, ask if slot should be held", ["hold_preferred_slot"], ["fake discount", "arguing"]),
  strategy("NBC-006", "quote_shown", "price_expensive", "medium", null, "reframe value and reduce risk with process clarity", ["want_photo_check_first"], ["discount promise", "apology loop"]),
  strategy("NBC-007", "quote_shown", "price_expensive", "high", null, "queue human review for commercial exception", [], ["discount promise"], true),
  strategy("NBC-008", "quote_shown", "discount_request", "low", null, "state fixed-price policy and keep booking path open", ["continue_with_available_slot"], ["special price promise"]),
  strategy("NBC-009", "quote_shown", "discount_request", "medium", null, "state policy and offer human review only if needed", ["want_human_review"], ["fake approval"]),
  strategy("NBC-010", "quote_shown", "discount_request", "high", null, "handoff for exception handling", [], ["discount promise"], true),
  strategy("NBC-011", "quote_shown", "need_to_think", "low", null, "summarize fit and ask permission for follow-up", ["permission_to_followup"], ["pressure"]),
  strategy("NBC-012", "quote_shown", "need_to_think", "medium", null, "offer to hold slot tentatively without pressure", ["hold_slot_temporarily"], ["repeat price"]),
  strategy("NBC-013", "quote_shown", "need_to_think", "high", null, "respect pause and schedule low-pressure follow-up", ["permission_to_followup"], ["nudging repeatedly"]),
  strategy("NBC-014", "quote_shown", "compare_first", "low", null, "compare factually and keep next step simple", ["want_slot_checked"], ["badmouthing competitor"]),
  strategy("NBC-015", "quote_shown", "compare_first", "medium", null, "explain process difference and offer photo check", ["want_photo_check_first"], ["guaranteed result"]),
  strategy("NBC-016", "quote_shown", "compare_first", "high", null, "keep door open without pressure", ["permission_to_followup"], ["negative competitor claim"]),
  strategy("NBC-017", "quote_shown", "trust_quality", "low", null, "explain process honestly and offer approved proof", ["want_before_after_example"], ["invented testimonial"]),
  strategy("NBC-018", "quote_shown", "trust_quality", "medium", null, "use approved case and explain result depends on condition", ["send_photo_for_check"], ["perfect restoration claim"]),
  strategy("NBC-019", "quote_shown", "trust_quality", "high", null, "handoff if customer distrust is strong", [], ["defensive answer"], true),
  strategy("NBC-020", "qualified", "timing_busy", "low", null, "offer another day or tentative hold", ["preferred_day"], ["forcing today"]),
  strategy("NBC-021", "qualified", "timing_busy", "medium", null, "make rescheduling easy", ["morning_or_afternoon"], ["too many slot options"]),
  strategy("NBC-022", "qualified", "coverage_uncertain", "low", null, "resolve area before promise", ["share_area_or_maps"], ["pretending coverage exists"]),
  strategy("NBC-023", "qualified", "coverage_uncertain", "medium", null, "offer workshop fallback if home-service uncertain", ["want_workshop_option"], ["inventing technician route"]),
  strategy("NBC-024", "handoff", "complaint_after_sales", "high", null, "stop AI and queue human support", [], ["diagnosing complaint", "promising refund"], true),
];

export function recommendNextBestClose(
  input: NextBestCloseInput,
): NextBestCloseOutput {
  const salesStage = normalizeStage(input.sales_stage);
  const objectionId = normalizeObjection(input.objection_id);
  const severity = input.severity || "medium";
  const strategies = input.strategies?.length
    ? input.strategies
    : DEFAULT_CLOSING_STRATEGIES;

  if (input.human_required) {
    return renderStrategy({
      id: "NBC-HANDOFF",
      when: { sales_stage: salesStage, objection_id: objectionId, severity },
      assistant_goal: "queue human support and stop AI from improvising",
      must_ask: [],
      must_avoid: ["continuing automated close"],
      handoff_required: true,
    }, input);
  }

  const matched = strategies.find((candidate) =>
    matches(candidate, {
      salesStage,
      objectionId,
      severity,
      availabilityKnown: input.availability_known,
    })
  ) || fallbackStrategy(salesStage, objectionId, severity, input);

  return renderStrategy(matched, input);
}

function strategy(
  id: string,
  salesStage: string | null,
  objectionId: string | null,
  severity: ObjectionSeverity | null,
  availabilityKnown: boolean | null,
  assistantGoal: string,
  mustAsk: string[],
  mustAvoid: string[],
  handoffRequired = false,
): ClosingStrategy {
  return {
    id,
    when: {
      sales_stage: salesStage,
      objection_id: objectionId,
      severity,
      availability_known: availabilityKnown,
    },
    assistant_goal: assistantGoal,
    must_ask: mustAsk,
    must_avoid: mustAvoid,
    handoff_required: handoffRequired,
  };
}

function matches(
  strategy: ClosingStrategy,
  input: {
    salesStage: SalesStage;
    objectionId: string | null;
    severity: ObjectionSeverity;
    availabilityKnown?: boolean | null;
  },
): boolean {
  const when = strategy.when;
  if (when.sales_stage && normalizeStage(when.sales_stage) !== input.salesStage) return false;
  if (when.objection_id !== undefined && normalizeObjection(when.objection_id) !== input.objectionId) return false;
  if (when.severity && when.severity !== input.severity) return false;
  if (when.availability_known !== undefined && when.availability_known !== null) {
    if (Boolean(input.availabilityKnown) !== when.availability_known) return false;
  }
  return true;
}

function fallbackStrategy(
  salesStage: SalesStage,
  objectionId: string | null,
  severity: ObjectionSeverity,
  input: NextBestCloseInput,
): ClosingStrategy {
  if (salesStage === "lead_partial" || input.missing_fields?.length) {
    return DEFAULT_CLOSING_STRATEGIES.find((item) => item.id === "NBC-003")!;
  }
  if (salesStage === "qualified") {
    return DEFAULT_CLOSING_STRATEGIES.find((item) =>
      item.id === (input.availability_known ? "NBC-001" : "NBC-002")
    )!;
  }
  if (salesStage === "handoff" || severity === "high") {
    return strategy("NBC-HANDOFF", salesStage, objectionId, severity, null, "handoff to human safely", [], ["automated promise"], true);
  }
  return DEFAULT_CLOSING_STRATEGIES.find((item) => item.id === "NBC-004")!;
}

function renderStrategy(
  strategy: ClosingStrategy,
  input: NextBestCloseInput,
): NextBestCloseOutput {
  const mustAsk = normalizeMustAsk(strategy.must_ask || [], input);
  return {
    strategy_id: strategy.id,
    assistant_goal: strategy.assistant_goal,
    must_ask: mustAsk.slice(0, 1),
    must_avoid: Array.from(new Set(strategy.must_avoid || [])),
    suggested_options: suggestedOptions(mustAsk[0] || null, input).slice(0, 2),
    handoff_required: Boolean(strategy.handoff_required),
  };
}

function normalizeMustAsk(
  mustAsk: string[],
  input: NextBestCloseInput,
): string[] {
  return mustAsk.map((ask) => {
    if (ask !== "next_missing_field") return ask;
    return input.missing_fields?.[0] || "vehicle";
  }).filter(Boolean);
}

function suggestedOptions(
  ask: string | null,
  input: NextBestCloseInput,
): string[] {
  if (ask === "choose_slot_option" && input.slot_options?.length) {
    return input.slot_options.slice(0, 2);
  }
  const options: Record<string, string[]> = {
    preferred_day: ["besok", "weekend"],
    morning_or_afternoon: ["pagi", "sore"],
    hold_preferred_slot: ["hold slot sementara", "cek jadwal lain"],
    hold_slot_temporarily: ["hold tanpa DP dulu", "follow up besok"],
    want_photo_check_first: ["kirim foto lampu", "lanjut cek slot"],
    permission_to_followup: ["follow up besok", "stop dulu"],
    share_area_or_maps: ["kirim kecamatan", "kirim titik maps"],
    want_workshop_option: ["cek home service", "opsi workshop Bogor"],
  };
  return ask ? options[ask] || [] : [];
}

export function normalizeStage(value: unknown): SalesStage {
  const text = String(value || "").trim();
  const aliases: Record<string, SalesStage> = {
    session_created: "new_inquiry",
    lead_partial: "lead_partial",
    lead_qualified: "qualified",
    qualified: "qualified",
    quote_prepared: "qualified",
    quote_presented: "quote_shown",
    quote_shown: "quote_shown",
    soft_commit_received: "soft_commit",
    booking_capture: "booking_pending_confirm",
    booking_pending_confirm: "booking_pending_confirm",
    booking_confirmed: "booking_confirmed",
    handoff_queued: "handoff",
    handoff: "handoff",
    lost_unresponsive: "lost",
    lost_price: "lost",
  };
  return aliases[text] || "lead_partial";
}

export function normalizeObjection(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const aliases: Record<string, string> = {
    trust_concern: "trust_quality",
    coverage_far: "coverage_uncertain",
    complaint: "complaint_after_sales",
  };
  return aliases[text] || text;
}
