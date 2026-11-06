// Deterministic calendar resolver for Polesheadlamp.id
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §7.5 (ResolveCalendarOutput), §14.4 (slots), §1.2 (cutoff)
//
// Rules enforced here (NOT in the prompt):
//   1. Slot enum is exactly ["08:00","10:00","12:00","15:00","17:00"].
//   2. Timezone is Asia/Jakarta (UTC+7, no DST). All arithmetic happens in Jakarta local.
//   3. Same-day cutoff: once local clock >= 10:00, today's 08:00 and 10:00 slots are no longer offerable.
//   4. If the raw text yields no unambiguous slot, return slot=null with ambiguities, never guess.
//   5. Parser is explicit and case-insensitive; no LLM fallback.

export const SLOTS = ["08:00", "10:00", "12:00", "15:00", "17:00"] as const;
export type Slot = typeof SLOTS[number];

export const SAME_DAY_CUTOFF_HOUR = 10;
export const BOOKING_HORIZON_DAYS = 14;
export const TIMEZONE = "Asia/Jakarta";
export const JAKARTA_OFFSET_HOURS = 7;

export interface ResolveCalendarOutput {
  date: string | null; // YYYY-MM-DD in Jakarta local
  slot: Slot | null;
  confidence: "high" | "medium" | "low";
  ambiguities: string[];
  applied_rules: string[];
  interpretation: string; // human-readable, for logs
  customer_facing_label: string | null;
  need_clarification: boolean;
  clarification_question: string | null;
}

// Jakarta-local date components. No Date objects used in arithmetic — avoids TZ bugs.
export interface JakartaLocal {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  dayOfWeek: number; // 0=Sun..6=Sat
}

// -----------------------------------------------------------------------------
// Timezone helpers — convert ISO strings ↔ Jakarta-local components
// -----------------------------------------------------------------------------

export function toJakarta(iso: string): JakartaLocal {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    throw new Error(`invalid_iso_datetime: ${iso}`);
  }
  // Shift UTC by +7h to get Jakarta local components
  const jakartaMs = d.getTime() + JAKARTA_OFFSET_HOURS * 3600 * 1000;
  const j = new Date(jakartaMs);
  return {
    year: j.getUTCFullYear(),
    month: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    hour: j.getUTCHours(),
    minute: j.getUTCMinutes(),
    dayOfWeek: j.getUTCDay(),
  };
}

export function formatDate(j: JakartaLocal): string {
  const mm = String(j.month).padStart(2, "0");
  const dd = String(j.day).padStart(2, "0");
  return `${j.year}-${mm}-${dd}`;
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day;
}

function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

function nextValidDayOfMonth(
  now: JakartaLocal,
  targetDay: number,
): string | null {
  for (let offset = 0; offset <= 12; offset++) {
    const candidate = addMonths(now.year, now.month, offset);
    if (!isValidYmd(candidate.year, candidate.month, targetDay)) continue;
    const ymd = formatYmd(candidate.year, candidate.month, targetDay);
    if (ymd >= formatDate(now)) return ymd;
  }
  return null;
}

export function addDays(j: JakartaLocal, n: number): JakartaLocal {
  // Build a UTC date from Jakarta components (no-offset, just date arithmetic), add days, re-read.
  const ms = Date.UTC(j.year, j.month - 1, j.day, j.hour, j.minute, 0);
  const shifted = new Date(ms + n * 86400 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

// -----------------------------------------------------------------------------
// Slot snapping
// -----------------------------------------------------------------------------

// Convert "HH:MM" to minutes since midnight.
function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// If customer says exactly "09:00" or "14:30" → not a slot. We REJECT (return null) rather than
// silently snap. The LLM will use the returned ambiguity to ask the customer to pick from slots.
// EXCEPTION: allow snapping within ±15 min of a slot — "jam 10 pas" / "jam 10 kurang 5" both → 10:00.
export function snapToSlot(
  hhmm: string,
): { slot: Slot | null; snappedFrom: string | null } {
  const requested = toMinutes(hhmm);
  if (isNaN(requested)) return { slot: null, snappedFrom: null };

  for (const s of SLOTS) {
    const slotMin = toMinutes(s);
    if (Math.abs(requested - slotMin) <= 15) {
      return { slot: s, snappedFrom: requested === slotMin ? null : hhmm };
    }
  }
  return { slot: null, snappedFrom: hhmm };
}

// -----------------------------------------------------------------------------
// Same-day cutoff
// -----------------------------------------------------------------------------

// At or after 10:00 local, today's 08:00 and 10:00 slots are no longer offerable.
// Any slot within 2h of `now` is also rejected (booking prep buffer).
export function applySameDayCutoff(
  now: JakartaLocal,
  requestedDate: string,
  requestedSlot: Slot | null,
): { allowed: boolean; reason: string | null } {
  if (!requestedSlot) return { allowed: false, reason: "no_slot" };
  const today = formatDate(now);
  if (requestedDate !== today) return { allowed: true, reason: null };

  const nowMin = now.hour * 60 + now.minute;
  const slotMin = toMinutes(requestedSlot);

  if (
    now.hour >= SAME_DAY_CUTOFF_HOUR && slotMin <= SAME_DAY_CUTOFF_HOUR * 60
  ) {
    return { allowed: false, reason: "same_day_cutoff" };
  }
  if (slotMin - nowMin < 120) {
    return { allowed: false, reason: "too_close_to_now" };
  }
  return { allowed: true, reason: null };
}

// -----------------------------------------------------------------------------
// Indonesian natural language parsing
// -----------------------------------------------------------------------------

const DAY_NAMES_ID = [
  "minggu",
  "senin",
  "selasa",
  "rabu",
  "kamis",
  "jumat",
  "sabtu",
];
// Index alignment: 0=Sunday ... 6=Saturday (matches JS getDay)
const DAY_NAME_TO_DOW: Record<string, number> = {
  minggu: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
};

const MONTH_NAMES_ID: Record<string, number> = {
  januari: 1,
  jan: 1,
  februari: 2,
  feb: 2,
  pebruari: 2,
  maret: 3,
  mar: 3,
  mart: 3,
  april: 4,
  apr: 4,
  mei: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  agustus: 8,
  agu: 8,
  agst: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  nop: 11,
  desember: 12,
  des: 12,
  dec: 12,
};

// Normalize text: lowercase, collapse whitespace, strip diacritics not expected in Bahasa.
function normalize(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

// Parse date portion → returns {date, confidence, ambiguity, rule}
function parseDate(
  text: string,
  now: JakartaLocal,
): {
  date: string | null;
  confidence: "high" | "medium" | "low";
  ambiguities: string[];
  applied: string[];
} {
  const ambiguities: string[] = [];
  const applied: string[] = [];

  // "hari ini" / "harini"
  if (/\bhari\s*ini\b|\bharini\b|\bhr\s*ini\b/.test(text)) {
    applied.push("today");
    return { date: formatDate(now), confidence: "high", ambiguities, applied };
  }
  // "besok" / "bsk" / "esok"
  if (/\bbesok\b|\bbsk\b|\besok\b/.test(text)) {
    applied.push("tomorrow");
    return {
      date: formatDate(addDays(now, 1)),
      confidence: "high",
      ambiguities,
      applied,
    };
  }
  // "lusa"
  if (/\blusa\b/.test(text)) {
    applied.push("day_after_tomorrow");
    return {
      date: formatDate(addDays(now, 2)),
      confidence: "high",
      ambiguities,
      applied,
    };
  }
  // "minggu depan" → next Monday (business convention)
  if (/\bminggu\s+depan\b|\bmgg\s+depan\b|\bpekan\s+depan\b/.test(text)) {
    const daysToNextMon = ((1 - now.dayOfWeek + 7) % 7) || 7;
    applied.push("next_week_defaulted_monday");
    ambiguities.push("week_specified_no_specific_day");
    return {
      date: formatDate(addDays(now, daysToNextMon)),
      confidence: "medium",
      ambiguities,
      applied,
    };
  }

  // "senin/selasa/... depan" → next occurrence of that weekday in the following week
  const dayDepan =
    /\b(minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\s+depan\b/.exec(
      text,
    );
  if (dayDepan) {
    const targetDow = DAY_NAME_TO_DOW[dayDepan[1]];
    const daysAhead = ((targetDow - now.dayOfWeek + 7) % 7) + 7; // always next week
    applied.push("next_specific_weekday");
    return {
      date: formatDate(addDays(now, daysAhead)),
      confidence: "high",
      ambiguities,
      applied,
    };
  }
  // "senin/selasa/..." standalone → nearest upcoming occurrence (same day → next week)
  const dayAlone = /\b(minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\b/
    .exec(text);
  if (dayAlone) {
    const targetDow = DAY_NAME_TO_DOW[dayAlone[1]];
    let daysAhead = (targetDow - now.dayOfWeek + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // avoid same-day ambiguity — always forward
    applied.push("upcoming_weekday");
    ambiguities.push("weekday_could_be_this_or_next");
    return {
      date: formatDate(addDays(now, daysAhead)),
      confidence: "medium",
      ambiguities,
      applied,
    };
  }

  // "25 april" / "25 apr" / "25-04" / "25/4" / "25/4/2026"
  const monthWord = /\b(?:tanggal|tgl)?\s*(\d{1,2})\s+([a-z]+)\b/.exec(text);
  if (monthWord && MONTH_NAMES_ID[monthWord[2]]) {
    const day = parseInt(monthWord[1], 10);
    const month = MONTH_NAMES_ID[monthWord[2]];
    let year = now.year;
    // If the date already passed this year, roll to next year
    if (month < now.month || (month === now.month && day < now.day)) year += 1;
    if (!isValidYmd(year, month, day)) {
      applied.push("date_with_month_word_invalid");
      ambiguities.push("invalid_calendar_date");
      return { date: null, confidence: "low", ambiguities, applied };
    }
    applied.push("date_with_month_word");
    return {
      date: formatYmd(year, month, day),
      confidence: "high",
      ambiguities,
      applied,
    };
  }

  // "tanggal 25" / "tgl 25" -> this month or nearest future month with that date.
  const tglMatch = /\b(?:tanggal|tgl)\s+(\d{1,2})\b/.exec(text);
  if (tglMatch) {
    const day = parseInt(tglMatch[1], 10);
    if (day >= 1 && day <= 31) {
      const target = nextValidDayOfMonth(now, day);
      applied.push("explicit_day_of_month");
      return {
        date: target,
        confidence: target ? "medium" : "low",
        ambiguities,
        applied,
      };
    }
  }

  const slashMatch = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/.exec(
    text,
  );
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10);
    let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : now.year;
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      if (
        !slashMatch[3] &&
        (month < now.month || (month === now.month && day < now.day))
      ) year += 1;
      if (!isValidYmd(year, month, day)) {
        applied.push("date_numeric_invalid");
        ambiguities.push("invalid_calendar_date");
        return { date: null, confidence: "low", ambiguities, applied };
      }
      applied.push("date_numeric");
      return {
        date: formatYmd(year, month, day),
        confidence: "high",
        ambiguities,
        applied,
      };
    }
  }

  // "weekend" / "akhir pekan" → next Saturday
  if (/\bweekend\b|\bakhir\s+pekan\b/.test(text)) {
    const daysToSat = ((6 - now.dayOfWeek + 7) % 7) || 7;
    applied.push("weekend_defaulted_saturday");
    ambiguities.push("weekend_could_be_sat_or_sun");
    return {
      date: formatDate(addDays(now, daysToSat)),
      confidence: "medium",
      ambiguities,
      applied,
    };
  }

  return {
    date: null,
    confidence: "low",
    ambiguities: ["no_date_phrase_found"],
    applied,
  };
}

// Parse time portion → returns {slot, confidence, ambiguity}
function parseTime(
  text: string,
): {
  slot: Slot | null;
  confidence: "high" | "medium" | "low";
  ambiguities: string[];
  applied: string[];
} {
  const ambiguities: string[] = [];
  const applied: string[] = [];

  // "jam 10 kurang 5" -> 09:55, then snap to a canonical slot if within tolerance.
  const kurangMatch = /\b(?:jam|pukul|j)\s*(\d{1,2})\s+kurang\s+(\d{1,2})\b/
    .exec(text);
  if (kurangMatch) {
    let hour = parseInt(kurangMatch[1], 10);
    const minus = parseInt(kurangMatch[2], 10);
    if (hour >= 1 && hour <= 7) {
      ambiguities.push("time_could_be_am_or_pm");
      hour += 12;
    }
    let total = hour * 60 - minus;
    if (total < 0) total += 24 * 60;
    const hhmm = `${String(Math.floor(total / 60)).padStart(2, "0")}:${
      String(total % 60).padStart(2, "0")
    }`;
    const { slot, snappedFrom } = snapToSlot(hhmm);
    if (slot && snappedFrom) applied.push("snapped_to_nearest_slot");
    applied.push("explicit_hour_minus_minutes");
    if (!slot) ambiguities.push("time_not_in_slot_enum");
    return {
      slot,
      confidence: slot ? (ambiguities.length ? "medium" : "high") : "low",
      ambiguities,
      applied,
    };
  }

  // "jam 8 pagi", "jam 10 pagi"
  const jamMatch =
    /\b(?:jam|pukul|j)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?\b/
      .exec(text);
  if (jamMatch) {
    let hour = parseInt(jamMatch[1], 10);
    const min = jamMatch[2] ? parseInt(jamMatch[2], 10) : 0;
    const qual = jamMatch[3];

    // Disambiguate hour with period qualifier
    if (qual === "pagi" && hour >= 12) hour -= 12;
    if (qual === "siang" && hour < 10) hour += 12;
    if (qual === "sore" && hour >= 1 && hour <= 7) hour += 12;
    if (qual === "malam" && hour >= 1 && hour <= 11) hour += 12;

    // If no qualifier and hour is 1..7, it's ambiguous in Indonesian usage
    if (!qual && hour >= 1 && hour <= 7) {
      ambiguities.push("time_could_be_am_or_pm");
      applied.push("hour_without_period_qualifier");
      // Default to PM for "jam 3" (sore) is usual but we mark it ambiguous
      hour += 12;
    }

    const hhmm = `${String(hour).padStart(2, "0")}:${
      String(min).padStart(2, "0")
    }`;
    const { slot, snappedFrom } = snapToSlot(hhmm);
    if (slot && snappedFrom) applied.push("snapped_to_nearest_slot");
    applied.push("explicit_hour");
    if (!slot) ambiguities.push("time_not_in_slot_enum");
    return {
      slot,
      confidence: slot ? (ambiguities.length ? "medium" : "high") : "low",
      ambiguities,
      applied,
    };
  }

  // Period-only qualifiers — map to canonical slot
  if (/\bpagi\b/.test(text) && !/\bjam\b/.test(text)) {
    applied.push("period_pagi");
    return {
      slot: "08:00",
      confidence: "medium",
      ambiguities: ["period_only_no_exact_time"],
      applied,
    };
  }
  if (/\bsiang\b/.test(text) && !/\bjam\b/.test(text)) {
    applied.push("period_siang");
    return {
      slot: "12:00",
      confidence: "medium",
      ambiguities: ["period_only_no_exact_time"],
      applied,
    };
  }
  if (/\bsore\b/.test(text) && !/\bjam\b/.test(text)) {
    applied.push("period_sore");
    ambiguities.push("sore_could_be_15_or_17");
    return { slot: "15:00", confidence: "low", ambiguities, applied };
  }
  if (/\bmalam\b/.test(text) && !/\bjam\b/.test(text)) {
    applied.push("period_malam_rejected");
    ambiguities.push("malam_not_in_slot_enum");
    return { slot: null, confidence: "low", ambiguities, applied };
  }

  return {
    slot: null,
    confidence: "low",
    ambiguities: ["no_time_phrase_found"],
    applied,
  };
}

// -----------------------------------------------------------------------------
// Top-level orchestrator
// -----------------------------------------------------------------------------

export interface ResolveCalendarInput {
  raw_text: string;
  reference_datetime: string; // ISO 8601
  timezone?: string; // must be "Asia/Jakarta" if provided
}

export function resolveCalendarInput(
  input: ResolveCalendarInput,
): ResolveCalendarOutput {
  if (input.timezone && input.timezone !== TIMEZONE) {
    return {
      date: null,
      slot: null,
      confidence: "low",
      ambiguities: [`unsupported_timezone:${input.timezone}`],
      applied_rules: [],
      interpretation: `Unsupported timezone. Only ${TIMEZONE} is supported.`,
      customer_facing_label: null,
      need_clarification: true,
      clarification_question:
        "Untuk jadwalnya, saya pakai waktu WIB ya kak. Mau hari dan jam berapa?",
    };
  }

  const now = toJakarta(input.reference_datetime);
  const text = normalize(input.raw_text);

  const d = parseDate(text, now);
  const t = parseTime(text);

  const ambiguities = [...d.ambiguities, ...t.ambiguities];
  const applied = [...d.applied, ...t.applied];

  // Horizon check
  if (d.date) {
    const today = formatDate(now);
    const horizonEnd = formatDate(addDays(now, BOOKING_HORIZON_DAYS));
    if (d.date > horizonEnd) {
      ambiguities.push("beyond_booking_horizon");
    }
    if (d.date < today) {
      ambiguities.push("date_in_past");
    }
  }

  // Same-day cutoff check
  if (d.date && t.slot) {
    const cutoff = applySameDayCutoff(now, d.date, t.slot);
    if (!cutoff.allowed && cutoff.reason) {
      ambiguities.push(cutoff.reason);
      applied.push("same_day_cutoff_evaluated");
    }
  }

  // Confidence aggregation: high only if both parts high, otherwise lower of the two.
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const combined = Math.min(rank[d.confidence], rank[t.confidence]);
  const confidence: "high" | "medium" | "low" = combined >= 3
    ? "high"
    : combined >= 2
    ? "medium"
    : "low";

  const interpretation = buildInterpretation(text, d.date, t.slot, ambiguities);
  const customerFacingLabel = buildCustomerFacingLabel(
    d.date,
    t.slot,
    ambiguities,
  );
  const clarificationQuestion = buildClarificationQuestion(
    d.date,
    t.slot,
    ambiguities,
  );

  return {
    date: d.date,
    slot: t.slot,
    confidence: ambiguities.length
      ? (confidence === "high" ? "medium" : confidence)
      : confidence,
    ambiguities,
    applied_rules: applied,
    interpretation,
    customer_facing_label: customerFacingLabel,
    need_clarification: clarificationQuestion !== null,
    clarification_question: clarificationQuestion,
  };
}

function buildInterpretation(
  raw: string,
  date: string | null,
  slot: Slot | null,
  ambiguities: string[],
): string {
  const parts: string[] = [`input="${raw}"`];
  parts.push(`date=${date ?? "null"}`);
  parts.push(`slot=${slot ?? "null"}`);
  if (ambiguities.length) parts.push(`amb=[${ambiguities.join(",")}]`);
  return parts.join(" ");
}

const DAY_LABELS_ID = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];
const MONTH_LABELS_ID = [
  "",
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

function buildCustomerFacingLabel(
  date: string | null,
  slot: Slot | null,
  ambiguities: string[],
): string | null {
  if (!date || !slot) return null;
  const hardBlocks = new Set([
    "same_day_cutoff",
    "too_close_to_now",
    "beyond_booking_horizon",
    "date_in_past",
    "time_not_in_slot_enum",
    "malam_not_in_slot_enum",
    "invalid_calendar_date",
  ]);
  if (
    ambiguities.some((a) =>
      hardBlocks.has(a) || a.startsWith("unsupported_timezone")
    )
  ) return null;

  const [year, month, day] = date.split("-").map((v) => parseInt(v, 10));
  if (!isValidYmd(year, month, day)) return null;
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${DAY_LABELS_ID[dow]}, ${day} ${MONTH_LABELS_ID[month]}, jam ${slot}`;
}

function buildClarificationQuestion(
  date: string | null,
  slot: Slot | null,
  ambiguities: string[],
): string | null {
  if (ambiguities.some((a) => a.startsWith("unsupported_timezone"))) {
    return "Untuk jadwalnya, saya pakai waktu WIB ya kak. Mau hari dan jam berapa?";
  }
  if (ambiguities.includes("invalid_calendar_date")) {
    return "Tanggalnya sepertinya belum valid kak. Boleh tulis ulang tanggal yang dimaksud?";
  }
  if (ambiguities.includes("beyond_booking_horizon")) {
    return "Untuk booking kami cek maksimal 14 hari ke depan dulu ya kak. Mau pilih tanggal yang lebih dekat?";
  }
  if (
    ambiguities.includes("same_day_cutoff") ||
    ambiguities.includes("too_close_to_now")
  ) {
    return "Untuk slot itu waktunya terlalu mepet kak. Mau saya cekkan jam berikutnya yang tersedia?";
  }
  if (ambiguities.includes("malam_not_in_slot_enum")) {
    return "Untuk malam belum ada slot ya kak. Yang tersedia biasanya 08:00, 10:00, 12:00, 15:00, atau 17:00.";
  }
  if (!date) return "Untuk harinya kakak mau kapan ya?";
  if (!slot || ambiguities.includes("time_not_in_slot_enum")) {
    return "Untuk jamnya, kakak lebih cocok 08:00, 10:00, 12:00, 15:00, atau 17:00?";
  }
  return null;
}
