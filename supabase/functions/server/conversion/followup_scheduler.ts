// Deterministic follow-up scheduler.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §7.4, §15, §30 task 17.

import { buildEventIdempotencyKey } from "../persistence/events.ts";

export interface FollowupHistoryItem {
  sent_at: string;
  reason?: string | null;
  template_id?: string | null;
}

export interface FollowupStopEvent {
  type: string;
  occurred_at: string;
}

export interface ScheduleFollowupPlanInput {
  conversation_id: string;
  reason: "quote_sent_no_reply" | "soft_commit_no_booking_fields" | "booking_fields_incomplete" | string;
  anchor_at: string;
  now_iso: string;
  timezone?: string | null;
  previous_followups?: FollowupHistoryItem[] | null;
  stop_events?: FollowupStopEvent[] | null;
  max_followups_per_lead_7d?: number | null;
}

export interface ScheduleFollowupPlanOutput {
  plan_id: string;
  next_send_at: string | null;
  template_id: string | null;
  reason: string;
  remaining_budget_7d: number;
  suppressed: boolean;
  suppression_reason: string | null;
}

interface CadenceRule {
  windows: string[];
  stop_on: string[];
}

const DEFAULT_MAX_FOLLOWUPS_7D = 4;
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;

const CADENCES: Record<string, CadenceRule> = {
  quote_sent_no_reply: {
    windows: ["15m", "2h", "24h", "72h"],
    stop_on: ["customer_replied", "booking_confirmed", "handoff_human", "lead_lost"],
  },
  soft_commit_no_booking_fields: {
    windows: ["15m", "2h", "24h"],
    stop_on: ["customer_replied", "booking_confirmed", "handoff_human", "lead_lost"],
  },
  booking_fields_incomplete: {
    windows: ["15m", "2h", "24h"],
    stop_on: ["customer_replied", "booking_confirmed", "handoff_human", "lead_lost"],
  },
};

const STOP_EVENT_ALIASES: Record<string, string> = {
  "customer.replied": "customer_replied",
  "booking.confirmed": "booking_confirmed",
  "handoff.queued": "handoff_human",
  "lead.lost": "lead_lost",
};

export async function scheduleFollowupPlan(
  input: ScheduleFollowupPlanInput,
): Promise<ScheduleFollowupPlanOutput> {
  const cadence = CADENCES[input.reason] || CADENCES.quote_sent_no_reply;
  const maxBudget = input.max_followups_per_lead_7d || DEFAULT_MAX_FOLLOWUPS_7D;
  const previous = input.previous_followups || [];
  const recentCount = countRecentFollowups(previous, input.now_iso);
  const remainingBudget = Math.max(0, maxBudget - recentCount);
  const sentForReason = previous.filter((item) => item.reason === input.reason).length;
  const window = cadence.windows[sentForReason] || null;
  const stopped = findStopEvent(input.stop_events || [], cadence.stop_on, input.anchor_at);
  const planId = await buildPlanId(input, sentForReason);

  if (stopped) {
    return suppressed(planId, input.reason, remainingBudget, "stop_event_after_anchor");
  }
  if (remainingBudget <= 0) {
    return suppressed(planId, input.reason, 0, "followup_budget_exhausted");
  }
  if (!window) {
    return suppressed(planId, input.reason, remainingBudget, "cadence_complete");
  }

  const rawNext = addWindow(input.anchor_at, window);
  const nextSendAt = applyQuietHours(rawNext);
  return {
    plan_id: planId,
    next_send_at: nextSendAt,
    template_id: `${input.reason}_${sentForReason + 1}`,
    reason: input.reason,
    remaining_budget_7d: remainingBudget,
    suppressed: false,
    suppression_reason: null,
  };
}

function suppressed(
  planId: string,
  reason: string,
  remainingBudget: number,
  suppressionReason: string,
): ScheduleFollowupPlanOutput {
  return {
    plan_id: planId,
    next_send_at: null,
    template_id: null,
    reason,
    remaining_budget_7d: remainingBudget,
    suppressed: true,
    suppression_reason: suppressionReason,
  };
}

async function buildPlanId(
  input: ScheduleFollowupPlanInput,
  sentForReason: number,
): Promise<string> {
  return await buildEventIdempotencyKey([
    "followup.scheduled",
    input.conversation_id,
    input.reason,
    input.anchor_at,
    sentForReason + 1,
  ]);
}

function countRecentFollowups(
  previous: FollowupHistoryItem[],
  nowIso: string,
): number {
  const now = toMs(nowIso);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  return previous.filter((item) => {
    const sent = toMs(item.sent_at);
    return Number.isFinite(sent) && sent >= sevenDaysAgo && sent <= now;
  }).length;
}

function findStopEvent(
  stopEvents: FollowupStopEvent[],
  stopOn: string[],
  anchorAt: string,
): FollowupStopEvent | null {
  const anchorMs = toMs(anchorAt);
  return stopEvents.find((event) => {
    const normalized = STOP_EVENT_ALIASES[event.type] || event.type;
    return stopOn.includes(normalized) && toMs(event.occurred_at) >= anchorMs;
  }) || null;
}

function addWindow(anchorAt: string, window: string): string {
  const match = /^(\d+)(m|h|d)$/.exec(window.trim());
  if (!match) return new Date(toMs(anchorAt)).toISOString();
  const amount = Number(match[1]);
  const unit = match[2];
  const ms = unit === "m"
    ? amount * 60 * 1000
    : unit === "h"
    ? amount * 60 * 60 * 1000
    : amount * 24 * 60 * 60 * 1000;
  return new Date(toMs(anchorAt) + ms).toISOString();
}

function applyQuietHours(iso: string): string {
  const date = new Date(toMs(iso));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  if (hour < QUIET_START_HOUR && hour >= QUIET_END_HOUR) return iso;

  const jakartaDate = `${parts.year}-${parts.month}-${parts.day}`;
  const nextDay = hour >= QUIET_START_HOUR
    ? addDays(jakartaDate, 1)
    : jakartaDate;
  return jakartaLocalToUtc(`${nextDay}T08:00:00`);
}

function jakartaLocalToUtc(localIsoNoZone: string): string {
  return new Date(`${localIsoNoZone}+07:00`).toISOString();
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00+07:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function toMs(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
