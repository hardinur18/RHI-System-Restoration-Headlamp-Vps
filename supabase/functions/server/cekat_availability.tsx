import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCalendarInput } from "./domain/calendar.ts";
import {
  childTraceContext,
  createTraceContext,
  hashForTelemetry,
  headersFromRequest,
  logError,
  logSpan,
} from "./observability.ts";

const route = new Hono();

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
const authSupabase = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey);

const API_KEY = Deno.env.get("CEKAT_AVAILABILITY_API_KEY")?.trim() || "";
const sharedSecret = Deno.env.get("CEKAT_SYNC_SHARED_SECRET")?.trim() || "";
const DEFAULT_DAILY_CAPACITY = clampInteger(
  Deno.env.get("CEKAT_TECHNICIAN_DAILY_CAPACITY"),
  3,
  1,
  12,
);
const DEFAULT_LOOKAHEAD_DAYS = clampInteger(
  Deno.env.get("CEKAT_AVAILABILITY_LOOKAHEAD_DAYS"),
  7,
  1,
  14,
);
const DEFAULT_TIME_OPTIONS = ["08:00", "10:00", "12:00", "15:00", "17:00"] as const;
const SALES_OFFER_TIME_PRIORITY = ["10:00", "12:00", "15:00", "17:00", "08:00"] as const;
const SERVICE_COVERAGE_NOTE =
  "Home service mencakup Jabodetabek, Karawang, Bandung, Serang, dan area sekitar hingga kurang lebih 40 km dari coverage utama selama teknisi tersedia.";
const SERVICE_COVERAGE_ANCHORS = [
  "Jakarta",
  "Bogor",
  "Depok",
  "Tangerang",
  "Bekasi",
  "Karawang",
  "Bandung",
  "Serang",
] as const;
const COVERAGE_BRANCH_ALIASES = [
  ["jakarta", "jaksel", "jakbar", "jakpus", "jakut", "jaktim"],
  ["bogor", "depok", "cibinong", "sentul", "gunungputri", "cileungsi"],
  ["tangerang", "tangsel", "serpong", "bsd", "bintaro", "ciputat", "gadingserpong"],
  ["bekasi", "cikarang", "tambun", "jatiasih", "harapanindah"],
  ["karawang", "cikampek", "purwakarta"],
  ["bandung", "cimahi", "soreang"],
  ["serang", "cilegon", "banten", "merak"],
] as const;

type OutputDetail = "slim" | "full";

type GenericRow = Record<string, any>;

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizedTokens(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function prioritizeOfferTimeOptions<T extends { time?: string }>(items: T[]) {
  const priorityMap = new Map<string, number>(SALES_OFFER_TIME_PRIORITY.map((time, index) => [time, index]));
  return [...items].sort((left, right) => {
    const leftTime = String(left?.time || "");
    const rightTime = String(right?.time || "");
    const leftPriority = priorityMap.has(leftTime) ? priorityMap.get(leftTime)! : SALES_OFFER_TIME_PRIORITY.length;
    const rightPriority = priorityMap.has(rightTime) ? priorityMap.get(rightTime)! : SALES_OFFER_TIME_PRIORITY.length;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return leftTime.localeCompare(rightTime);
  });
}

function extractBearerToken(value?: string | null) {
  if (!value) return "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function isActiveUserStatus(status: unknown) {
  const normalized = normalizeText(status);
  if (!normalized) return true;
  return ![
    "inactive",
    "nonactive",
    "nonaktif",
    "resign",
    "terminated",
    "disabled",
  ].some((blocked) => normalized.includes(blocked));
}

function isOpenOperationalStatus(status: unknown) {
  const normalized = normalizeText(status);
  if (!normalized) return true;
  return ![
    "cancel",
    "cancelled",
    "canceled",
    "reschedul",
    "jadwalulang",
    "batal",
    "void",
    "reject",
    "rejected",
    "spam",
    "duplicate",
    "selesai",
    "completed",
    "done",
  ].some((blocked) => normalized.includes(blocked));
}

function isActiveBranchStatus(status: unknown) {
  const normalized = normalizeText(status);
  if (!normalized) return true;
  if (normalized.includes("comingsoon")) return false;
  return normalized.includes("active");
}

function pickText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function areaNameOf(area: GenericRow) {
  return pickText(area.name, area.area_name, area.label, area.title, area.nama);
}

function branchNameOf(branch: GenericRow | null) {
  return pickText(branch?.name, branch?.branch_name, branch?.label, branch?.title, branch?.nama);
}

function technicianNameOf(technician: GenericRow) {
  return pickText(technician.name, technician.full_name, technician.nama, technician.email, technician.id);
}

function getBranchIdFromArea(area: GenericRow | null) {
  if (!area) return "";
  return pickText(area.branch_id, area.branchId, area.parent_branch_id, area.parentBranchId);
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function todayJakarta() {
  return formatDateInTimeZone(new Date(), "Asia/Jakarta");
}

function currentJakartaClock() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  const hour = parts.find((part) => part.type === "hour")?.value || "00";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}`;
  return {
    timezone: "Asia/Jakarta",
    date,
    time,
    minutes: timeToMinutes(time),
  };
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const WEEKDAY_LABELS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;
const WEEKDAY_ALIASES = new Map<string, number>([
  ["minggu", 0],
  ["ahad", 0],
  ["sunday", 0],
  ["sun", 0],
  ["senin", 1],
  ["monday", 1],
  ["mon", 1],
  ["selasa", 2],
  ["tuesday", 2],
  ["tue", 2],
  ["rabu", 3],
  ["wednesday", 3],
  ["wed", 3],
  ["kamis", 4],
  ["thursday", 4],
  ["thu", 4],
  ["jumat", 5],
  ["jumaat", 5],
  ["friday", 5],
  ["fri", 5],
  ["sabtu", 6],
  ["saturday", 6],
  ["sat", 6],
]);

function parsePreferredDayType(rawValue: unknown) {
  const normalized = normalizeText(rawValue);
  if (!normalized) return "";
  if (["weekday", "weekdays", "harikerja", "seninjumat"].includes(normalized)) {
    return "weekday";
  }
  if (["weekend", "weekends", "sabtuminggu", "akhirpekan"].includes(normalized)) {
    return "weekend";
  }
  return "";
}

function parsePreferredDays(rawValue: unknown) {
  const rawList = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(/[,|/]+/g)
        .map((value) => value.trim())
        .filter(Boolean);

  const indexes = new Set<number>();
  for (const value of rawList) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const dayIndex = WEEKDAY_ALIASES.get(normalized);
    if (typeof dayIndex === "number") {
      indexes.add(dayIndex);
    }
  }

  return [...indexes].sort((left, right) => left - right);
}

function dayIndexOfDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return -1;
  return date.getUTCDay();
}

function matchesDayPreference(
  dateString: string,
  preferredDayType: string,
  preferredDayIndexes: number[],
) {
  const dayIndex = dayIndexOfDate(dateString);
  if (dayIndex < 0) return false;

  if (preferredDayIndexes.length > 0 && !preferredDayIndexes.includes(dayIndex)) {
    return false;
  }

  if (preferredDayType === "weekday" && [0, 6].includes(dayIndex)) {
    return false;
  }

  if (preferredDayType === "weekend" && ![0, 6].includes(dayIndex)) {
    return false;
  }

  return true;
}

function describeDayPreference(preferredDayType: string, preferredDayIndexes: number[]) {
  if (preferredDayIndexes.length > 0) {
    return preferredDayIndexes.map((dayIndex) => WEEKDAY_LABELS[dayIndex]).join(", ");
  }
  if (preferredDayType === "weekday") return "hari kerja";
  if (preferredDayType === "weekend") return "weekend";
  return "";
}

function resolveWeekdayPhraseDate(rawValue: unknown, baseDate = todayJakarta()) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) return null;

  const tokens = raw
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);

  let targetDayIndex: number | null = null;
  for (const token of tokens) {
    const normalized = normalizeText(token);
    const matched = WEEKDAY_ALIASES.get(normalized);
    if (typeof matched === "number") {
      targetDayIndex = matched;
      break;
    }
  }

  if (targetDayIndex === null) return null;

  const baseDayIndex = dayIndexOfDate(baseDate);
  if (baseDayIndex < 0) return null;

  let offset = (targetDayIndex - baseDayIndex + 7) % 7;
  const normalizedRaw = normalizeText(raw);
  const explicitForwardPhrase =
    raw.includes("next week") ||
    raw.includes("minggu depan") ||
    raw.includes("pekan depan") ||
    raw.includes("next saturday") ||
    raw.includes("next sunday") ||
    raw.includes("next friday") ||
    raw.includes("next thursday") ||
    raw.includes("next wednesday") ||
    raw.includes("next tuesday") ||
    raw.includes("next monday") ||
    normalizedRaw.includes("depan") ||
    normalizedRaw.includes("next");

  if (explicitForwardPhrase && offset === 0) {
    offset = 7;
  }

  return addDays(baseDate, offset);
}

function resolveDateInput(rawValue: unknown) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return todayJakarta();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const resolved = resolveCalendarInput({
    raw_text: value,
    reference_datetime: new Date().toISOString(),
  });
  if (resolved.date && !resolved.ambiguities.includes("invalid_calendar_date")) return resolved.date;
  if (["today", "hariini", "hari ini"].includes(value)) return todayJakarta();
  if (["tomorrow", "besok"].includes(value)) return addDays(todayJakarta(), 1);
  const weekdayPhraseDate = resolveWeekdayPhraseDate(rawValue);
  if (weekdayPhraseDate) return weekdayPhraseDate;
  return null;
}

function normalizeTimeValue(rawValue: unknown) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return "";
  const resolved = resolveCalendarInput({
    raw_text: value,
    reference_datetime: new Date().toISOString(),
  });
  if (resolved.slot) return resolved.slot;
  const cleaned = value
    .replace(/^jam\s+/i, "")
    .replace(/\s*wib$/i, "")
    .replace(/\./g, ":")
    .trim();

  const compactMatch = cleaned.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (compactMatch) {
    const hour = compactMatch[1].padStart(2, "0");
    const minute = (compactMatch[2] || "00").padStart(2, "0");
    return `${hour}:${minute}`;
  }

  const fullMatch = cleaned.match(/^(\d{1,2}):(\d{2})/);
  if (fullMatch) {
    return `${fullMatch[1].padStart(2, "0")}:${fullMatch[2].padStart(2, "0")}`;
  }

  return cleaned.replace(/\s+/g, "");
}

function timeToMinutes(value: string) {
  const normalized = normalizeTimeValue(value);
  const [hourText, minuteText] = normalized.split(":");
  const hour = Number(hourText || "0");
  const minute = Number(minuteText || "0");
  return hour * 60 + minute;
}

function isPastTodayTime(
  date: string,
  time: string,
  currentClock: { date: string; minutes: number },
) {
  return date === currentClock.date && timeToMinutes(time) <= currentClock.minutes;
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveOutputDetail(input: Record<string, unknown>, fallback: OutputDetail = "slim"): OutputDetail {
  const explicit = String(
    input.outputDetail ??
      input.output_detail ??
      input.responseDetail ??
      input.response_detail ??
      input.detail ??
      "",
  )
    .trim()
    .toLowerCase();

  if (["full", "debug", "verbose", "detail"].includes(explicit)) return "full";
  if (["slim", "compact", "minimal", "min"].includes(explicit)) return "slim";
  if (parseBoolean(input.debug, false) || parseBoolean(input.verbose, false)) return "full";
  return fallback;
}

async function readInput(c: any) {
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  if (["GET", "HEAD"].includes(c.req.method.toUpperCase())) return query;

  try {
    const body = await c.req.json();
    return {
      ...query,
      ...(body && typeof body === "object" ? body : {}),
    };
  } catch {
    return query;
  }
}

async function authorizeRequest(c: any) {
  const authorization = c.req.header("Authorization");
  const bearerToken = extractBearerToken(authorization);
  const clientToken = pickText(
    c.req.header("x-client-token"),
    c.req.header("X-Client-Token"),
  );

  const allowedTokens = [
    API_KEY,
    sharedSecret,
    supabaseServiceKey,
    supabaseAnonKey,
  ].filter(Boolean);

  if (allowedTokens.includes(bearerToken) || allowedTokens.includes(clientToken)) {
    return { ok: true as const, mode: "api-key" as const };
  }

  if (bearerToken) {
    const { data, error } = await authSupabase.auth.getUser(bearerToken);
    if (!error && data?.user) {
      return {
        ok: true as const,
        mode: "session" as const,
        userId: data.user.id,
      };
    }
  }

  if (allowedTokens.length) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized",
    };
  }

  return {
    ok: false as const,
    status: 503,
    error: "CEKAT_AVAILABILITY_API_KEY belum dikonfigurasi di server.",
  };
}

function buildAreaCandidates(areas: GenericRow[], query: string) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const scored = areas
    .map((area) => {
      const areaName = areaNameOf(area);
      const normalizedAreaName = normalizeText(areaName);
      if (!normalizedAreaName) return null;

      let score = 0;
      if (normalizedAreaName === normalizedQuery) score = 100;
      else if (normalizedAreaName.startsWith(normalizedQuery)) score = 80;
      else if (normalizedAreaName.includes(normalizedQuery)) score = 60;
      else if (normalizedQuery.includes(normalizedAreaName)) score = 50;
      else {
        const queryTokens = String(query || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/i)
          .filter(Boolean)
          .map((token) => normalizeText(token));
        const tokenHits = queryTokens.filter((token) => normalizedAreaName.includes(token)).length;
        if (tokenHits > 0) score = 20 + tokenHits;
      }

      if (!score) return null;

      return {
        area,
        score,
        areaName,
      };
    })
    .filter(Boolean) as Array<{ area: GenericRow; score: number; areaName: string }>;

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.areaName.length - right.areaName.length;
  });

  return scored.map((item) => item.area);
}

function buildBranchCandidates(branches: GenericRow[], query: string) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = normalizedTokens(query);
  if (!normalizedQuery) return [];

  const scored = branches
    .map((branch) => {
      const branchName = branchNameOf(branch);
      const normalizedBranchName = normalizeText(branchName);
      if (!normalizedBranchName) return null;

      let score = 0;
      if (normalizedBranchName === normalizedQuery) score = 100;
      else if (normalizedBranchName.startsWith(normalizedQuery)) score = 80;
      else if (normalizedBranchName.includes(normalizedQuery)) score = 60;
      else if (normalizedQuery.includes(normalizedBranchName)) score = 50;
      else {
        const tokenHits = queryTokens.filter((token) => normalizedBranchName.includes(token)).length;
        if (tokenHits > 0) score = 20 + tokenHits;

        for (const aliases of COVERAGE_BRANCH_ALIASES) {
          const aliasHitOnQuery = aliases.some((alias) => {
            const normalizedAlias = normalizeText(alias);
            return normalizedQuery.includes(normalizedAlias) || normalizedAlias.includes(normalizedQuery);
          });
          const aliasHitOnBranch = aliases.some((alias) => {
            const normalizedAlias = normalizeText(alias);
            return normalizedBranchName.includes(normalizedAlias) ||
              normalizedAlias.includes(normalizedBranchName);
          });

          if (aliasHitOnQuery && aliasHitOnBranch) {
            score = Math.max(score, 45);
          }
        }
      }

      if (!score) return null;

      return {
        branch,
        score,
        branchName,
      };
    })
    .filter(Boolean) as Array<{ branch: GenericRow; score: number; branchName: string }>;

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.branchName.length - right.branchName.length;
  });

  return scored.map((item) => item.branch);
}

function resolveCoverageCluster(value: unknown) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return null;

  for (const aliases of COVERAGE_BRANCH_ALIASES) {
    if (aliases.some((alias) => normalizedValue.includes(normalizeText(alias)))) {
      return aliases[0];
    }
  }

  return null;
}

function numericCoordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const originLat = toRadians(lat1);
  const targetLat = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(originLat) * Math.cos(targetLat);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function branchRadiusKm(branch: GenericRow) {
  return clampInteger(branch.radius ?? branch.coverage_radius ?? branch.radius_km, 20, 1, 100);
}

function branchGeo(branch: GenericRow) {
  const lat = numericCoordinate(branch.lat ?? branch.latitude);
  const lng = numericCoordinate(branch.lng ?? branch.longitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

async function geocodeCoverageQuery(areaQuery: string) {
  const cleaned = String(areaQuery || "").trim();
  if (!cleaned) return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", `${cleaned}, Indonesia`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Polesheadlamp-Cekat-Availability/1.0",
        "Accept-Language": "id,en",
      },
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    const lat = numericCoordinate(first?.lat);
    const lng = numericCoordinate(first?.lon);
    if (lat === null || lng === null) return null;

    return {
      lat,
      lng,
      label: String(first?.display_name || cleaned),
    };
  } catch (error) {
    console.warn("Cekat availability geocode failed:", error);
    return null;
  }
}

function buildRadiusBranchCandidates(branches: GenericRow[], geoPoint: { lat: number; lng: number }) {
  return branches
    .map((branch) => {
      const geo = branchGeo(branch);
      if (!geo) return null;
      const radiusKm = branchRadiusKm(branch);
      const distanceKm = haversineKm(geoPoint.lat, geoPoint.lng, geo.lat, geo.lng);
      return {
        branch,
        radiusKm,
        distanceKm,
        withinRadius: distanceKm <= radiusKm,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (Number(left!.withinRadius) !== Number(right!.withinRadius)) {
        return Number(right!.withinRadius) - Number(left!.withinRadius);
      }
      return left!.distanceKm - right!.distanceKm;
    }) as Array<{
      branch: GenericRow;
      radiusKm: number;
      distanceKm: number;
      withinRadius: boolean;
    }>;
}

function dateAvailabilitySummary({
  date,
  time,
  technicians,
  schedules,
  orders,
  bookings,
  perTechDailyLimit,
  currentClock,
}: {
  date: string;
  time?: string;
  technicians: GenericRow[];
  schedules: GenericRow[];
  orders: GenericRow[];
  bookings: GenericRow[];
  perTechDailyLimit: number;
  currentClock: { date: string; minutes: number };
}) {
  const offTechnicianIds = new Set(
    schedules
      .filter((schedule) => String(schedule.date || "") === date)
      .map((schedule) => String(schedule.user_id || schedule.userId || "")),
  );

  const onDutyTechnicians = technicians.filter(
    (technician) => !offTechnicianIds.has(String(technician.id)),
  );
  const onDutyTechnicianIds = new Set(onDutyTechnicians.map((technician) => String(technician.id)));

  const dayOrders = orders.filter((order) => String(order.service_date || "") === date);
  const dayBookings = bookings.filter((booking) => String(booking.schedule_date || "") === date);

  if (time) {
    if (isPastTodayTime(date, time, currentClock)) {
      return {
        mode: "time-specific",
        date,
        time,
        totalTechnicians: technicians.length,
        onDutyTechnicians: onDutyTechnicians.length,
        offTechnicians: offTechnicianIds.size,
        occupiedTechnicians: 0,
        unassignedReservations: 0,
        remainingSlots: 0,
        availableTechnicianIds: [],
        status: "past-time",
        capacity: onDutyTechnicians.length,
        usedCapacity: onDutyTechnicians.length,
      };
    }

    const occupiedTechnicianIds = new Set<string>();
    let unassignedReservations = 0;

    const inspectTime = (value: unknown) => normalizeTimeValue(value) === time;

    for (const order of dayOrders) {
      if (!inspectTime(order.service_time)) continue;
      const technicianId = String(order.technician_id || "");
      if (technicianId && onDutyTechnicianIds.has(technicianId)) {
        occupiedTechnicianIds.add(technicianId);
      } else {
        unassignedReservations += 1;
      }
    }

    for (const booking of dayBookings) {
      if (!inspectTime(booking.schedule_time)) continue;
      const technicianId = String(booking.technician_id || "");
      if (technicianId && onDutyTechnicianIds.has(technicianId)) {
        occupiedTechnicianIds.add(technicianId);
      } else {
        unassignedReservations += 1;
      }
    }

    const remainingSlots = Math.max(
      0,
      onDutyTechnicians.length - occupiedTechnicianIds.size - unassignedReservations,
    );

    return {
      mode: "time-specific",
      date,
      time,
      totalTechnicians: technicians.length,
      onDutyTechnicians: onDutyTechnicians.length,
      offTechnicians: offTechnicianIds.size,
      occupiedTechnicians: occupiedTechnicianIds.size,
      unassignedReservations,
      remainingSlots,
      availableTechnicianIds: onDutyTechnicians
        .filter((technician) => !occupiedTechnicianIds.has(String(technician.id)))
        .map((technician) => String(technician.id))
        .slice(0, remainingSlots),
      status: remainingSlots > 0 ? "available" : "full",
      capacity: onDutyTechnicians.length,
      usedCapacity: occupiedTechnicianIds.size + unassignedReservations,
    };
  }

  const branchLoad = dayOrders.length + dayBookings.length;
  const dailyCapacity = onDutyTechnicians.length * perTechDailyLimit;
  const remainingSlots = Math.max(0, dailyCapacity - branchLoad);

  return {
    mode: "daily",
    date,
    totalTechnicians: technicians.length,
    onDutyTechnicians: onDutyTechnicians.length,
    offTechnicians: offTechnicianIds.size,
    occupiedTechnicians: Math.min(onDutyTechnicians.length, branchLoad),
    unassignedReservations: 0,
    remainingSlots,
    availableTechnicianIds: onDutyTechnicians.map((technician) => String(technician.id)),
    status: remainingSlots > 0 ? "available" : "full",
    capacity: dailyCapacity,
    usedCapacity: branchLoad,
  };
}

function buildAvailableTimeOptions({
  date,
  technicians,
  schedules,
  orders,
  bookings,
  perTechDailyLimit,
  currentClock,
}: {
  date: string;
  technicians: GenericRow[];
  schedules: GenericRow[];
  orders: GenericRow[];
  bookings: GenericRow[];
  perTechDailyLimit: number;
  currentClock: { date: string; minutes: number };
}) {
  return DEFAULT_TIME_OPTIONS
    .filter((time) => !isPastTodayTime(date, time, currentClock))
    .map((time) => {
      const snapshot = dateAvailabilitySummary({
        date,
        time,
        technicians,
        schedules,
        orders,
        bookings,
        perTechDailyLimit,
        currentClock,
      });
      return {
        time,
        remainingSlots: snapshot.remainingSlots,
        status: snapshot.status,
        capacity: snapshot.capacity,
        usedCapacity: snapshot.usedCapacity,
      };
    })
    .filter((item) => item.remainingSlots > 0);
}

function slotIndexOfTime(value: string) {
  const normalized = normalizeTimeValue(value);
  return DEFAULT_TIME_OPTIONS.indexOf(normalized as typeof DEFAULT_TIME_OPTIONS[number]);
}

function buildTechnicianRouteFit({
  scheduleTime,
  targetLocationText,
  tasks,
}: {
  scheduleTime: string;
  targetLocationText: string;
  tasks: GenericRow[];
}) {
  const requestedSlotIndex = slotIndexOfTime(scheduleTime);
  if (requestedSlotIndex < 0) {
    return { score: 0, gapScore: 0, similarityScore: 0 };
  }

  const normalizedTarget = compactText(String(targetLocationText || ""));
  const taskSnapshots = tasks
    .map((task) => {
      const taskTime = normalizeTimeValue(task.service_time || task.schedule_time || "");
      const slotIndex = slotIndexOfTime(taskTime);
      if (slotIndex < 0) return null;
      return {
        slotIndex,
        addressText: compactText(`${pickText(task.address)} ${pickText(task.maps_url)}`),
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

  let similarityScore = 0;
  if (normalizedTarget && previousTask?.addressText) {
    similarityScore += similarityTokenScore(normalizedTarget, previousTask.addressText) * 20;
  }
  if (normalizedTarget && nextTask?.addressText) {
    similarityScore += similarityTokenScore(normalizedTarget, nextTask.addressText) * 20;
  }

  return {
    score: gapScore + similarityScore,
    gapScore,
    similarityScore,
  };
}

function compactText(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function similarityTokenScore(left: string, right: string) {
  const leftTokens = new Set(left.split(/[^a-z0-9]+/).filter(Boolean));
  const rightTokens = new Set(right.split(/[^a-z0-9]+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function summarizeBranchAvailability({
  branch,
  matchedArea,
  technicians,
  schedules,
  orders,
  bookings,
  date,
  time,
  perTechDailyLimit,
  hasDayPreference,
  preferredDayType,
  preferredDayIndexes,
  dateWasExplicit,
  lookaheadDays,
  currentClock,
  targetLocationText,
}: {
  branch: GenericRow;
  matchedArea: GenericRow | null;
  technicians: GenericRow[];
  schedules: GenericRow[];
  orders: GenericRow[];
  bookings: GenericRow[];
  date: string;
  time: string;
  perTechDailyLimit: number;
  hasDayPreference: boolean;
  preferredDayType: string;
  preferredDayIndexes: number[];
  dateWasExplicit: boolean;
  lookaheadDays: number;
  currentClock: { date: string; time: string; minutes: number };
  targetLocationText: string;
}) {
  const dailySeriesDetailed = Array.from({ length: lookaheadDays }, (_, index) => {
    const currentDate = addDays(date, index);
    const availability = dateAvailabilitySummary({
      date: currentDate,
      technicians,
      schedules,
      orders,
      bookings,
      perTechDailyLimit,
      currentClock,
    });
    const timeOptions = buildAvailableTimeOptions({
      date: currentDate,
      technicians,
      schedules,
      orders,
      bookings,
      perTechDailyLimit,
      currentClock,
    });

    return {
      ...availability,
      timeOptions,
    };
  });

  const dailyAvailabilityToday = dailySeriesDetailed[0];

  const timeScopedAvailability = time
    ? dateAvailabilitySummary({
      date,
      time,
      technicians,
      schedules,
      orders,
      bookings,
      perTechDailyLimit,
      currentClock,
    })
    : null;
  const requestedTimeAlreadyPassed = Boolean(
    time && timeScopedAvailability && timeScopedAvailability.status === "past-time",
  );

  const requestedTimeDowngradedToDaily = Boolean(
    time && timeScopedAvailability && (dailyAvailabilityToday.remainingSlots <= 0 || requestedTimeAlreadyPassed),
  );
  const preferredSeries = hasDayPreference
    ? dailySeriesDetailed.filter((item) => matchesDayPreference(item.date, preferredDayType, preferredDayIndexes))
    : dailySeriesDetailed;

  const preferShiftedDate =
    !dateWasExplicit &&
    !time &&
    hasDayPreference &&
    preferredSeries.length > 0 &&
    !matchesDayPreference(date, preferredDayType, preferredDayIndexes);

  const selectedAvailability = preferShiftedDate
    ? preferredSeries[0]
    : timeScopedAvailability && !requestedTimeDowngradedToDaily
    ? timeScopedAvailability
    : dailyAvailabilityToday;

  const selectedDate = selectedAvailability.date;
  const requestedDateMatchesPreference = hasDayPreference
    ? matchesDayPreference(date, preferredDayType, preferredDayIndexes)
    : true;

  const nextAvailableDates = preferredSeries
    .filter((item) => item.remainingSlots > 0 && (item.date !== currentClock.date || item.timeOptions.length > 0))
    .slice(0, 2)
    .map((item) => ({
      date: item.date,
      remainingSlots: item.remainingSlots,
      status: item.status,
    }));

  const nextAvailableDatesIgnoringPreference = hasDayPreference
    ? dailySeriesDetailed
        .filter((item) => item.remainingSlots > 0 && (item.date !== currentClock.date || item.timeOptions.length > 0))
        .slice(0, 2)
        .map((item) => ({
          date: item.date,
          remainingSlots: item.remainingSlots,
          status: item.status,
        }))
    : [];

  const dateOrders = orders.filter((order) => String(order.service_date || "") === selectedDate);
  const dateBookings = bookings.filter((booking) => String(booking.schedule_date || "") === selectedDate);
  const areaIdForLoad = matchedArea?.id ? String(matchedArea.id) : "";
  const areaLoad = areaIdForLoad
    ? {
        orders: dateOrders.filter((order) => String(order.area_id || "") === areaIdForLoad).length,
        prospectBookings: dateBookings.filter((booking) => String(booking.area_id || "") === areaIdForLoad).length,
      }
    : { orders: 0, prospectBookings: 0 };

  const selectedDateDaily = dailySeriesDetailed.find((item) => item.date === selectedDate);
  const availableTimeOptions = prioritizeOfferTimeOptions(selectedDateDaily?.timeOptions || []);

  const offSelectedDate = new Set(
    schedules
      .filter((schedule) => String(schedule.date || "") === selectedDate)
      .map((schedule) => String(schedule.user_id || schedule.userId || "")),
  );

  const technicianRouteCandidates = time && !requestedTimeAlreadyPassed
    ? technicians
        .filter((technician) => !offSelectedDate.has(String(technician.id)))
        .map((technician) => {
          const technicianId = String(technician.id);
          const assignedOrders = dateOrders.filter((order) => String(order.technician_id || "") === technicianId);
          const assignedBookings = dateBookings.filter((booking) => String(booking.technician_id || "") === technicianId);
          const sameTimeBusy =
            assignedOrders.some((order) => normalizeTimeValue(order.service_time) === time) ||
            assignedBookings.some((booking) => normalizeTimeValue(booking.schedule_time) === time);
          const routeFit = buildTechnicianRouteFit({
            scheduleTime: time,
            targetLocationText,
            tasks: [...assignedOrders, ...assignedBookings],
          });
          return {
            technicianId,
            name: technicianNameOf(technician),
            sameTimeBusy,
            assignedCount: assignedOrders.length + assignedBookings.length,
            score: routeFit.score,
            gapScore: routeFit.gapScore,
            similarityScore: routeFit.similarityScore,
          };
        })
        .filter((item) => !item.sameTimeBusy)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          if (left.assignedCount !== right.assignedCount) return left.assignedCount - right.assignedCount;
          return left.technicianId.localeCompare(right.technicianId);
        })
    : [];
  const bestTechnicianRoute = technicianRouteCandidates[0] || null;

  const nextAvailableDateOptions = preferredSeries
    .filter((item) => item.remainingSlots > 0 && (item.date !== currentClock.date || item.timeOptions.length > 0))
    .slice(0, 2)
    .map((item) => ({
      date: item.date,
      remainingSlots: item.remainingSlots,
      status: item.status,
      timeOptions: prioritizeOfferTimeOptions(item.timeOptions).slice(0, 2),
    }));

  return {
    branch,
    technicians,
    schedules,
    orders,
    bookings,
    dailyAvailabilityToday,
    timeScopedAvailability,
    requestedTimeDowngradedToDaily,
    preferShiftedDate,
    preferredSeries,
    selectedAvailability,
    selectedDate,
    requestedDateMatchesPreference,
    requestedTimeAlreadyPassed,
    nextAvailableDates,
    nextAvailableDateOptions,
    nextAvailableDatesIgnoringPreference,
    dateOrders,
    dateBookings,
    areaLoad,
    availableTimeOptions,
    bestTechnicianRoute,
  };
}

function formatDateListLabel(items: Array<{ date: string }>) {
  const labels = items.map((item) => formatHumanDateLabel(item.date)).filter(Boolean);
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} atau ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, atau ${labels[labels.length - 1]}`;
}

function formatHumanDateLabel(value: string) {
  const cleaned = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const [yearText, monthText, dayText] = cleaned.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return cleaned;

  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
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

  return `${dayNames[date.getUTCDay()]}, ${day} ${monthNames[month - 1] || monthText}`;
}

route.on(["GET", "POST"], "/availability", async (c) => {
  let trace = createTraceContext({
    service: "cekat-availability",
    method: c.req.method,
    path: c.req.path,
    headers: headersFromRequest(c),
  });
  try {
    const authorization = await authorizeRequest(c);
    if (!authorization.ok) {
      logSpan(trace, "tool.call", "unauthorized", { tool_name: "availability" });
      return c.json(
        { ok: false, trace_id: trace.traceId, error: authorization.error },
        { status: authorization.status as 401 | 403 },
      );
    }

    const input = await readInput(c);
    trace = childTraceContext(trace, input && typeof input === "object" ? input : {});
    const inputHash = hashForTelemetry(input);
    const areaId = pickText(input.areaId, input.area_id);
    const branchIdFromInput = pickText(input.branchId, input.branch_id);
    const areaQuery = pickText(input.area, input.wilayah, input.domisili, input.location);
    const rawDateInput = pickText(input.date);
    const dateWasExplicit = Boolean(rawDateInput);
    const date = resolveDateInput(rawDateInput);
    const currentClock = currentJakartaClock();
    const time = normalizeTimeValue(input.time);
    const preferredDayType = parsePreferredDayType(
      input.preferredDayType ?? input.preferred_day_type ?? input.dayType ?? input.day_type,
    );
    const preferredDayIndexes = parsePreferredDays(
      input.preferredDays ?? input.preferred_days ?? input.days ?? input.day_names,
    );
    const outputDetail = resolveOutputDetail(input, "slim");
    const hasDayPreference = Boolean(preferredDayType || preferredDayIndexes.length > 0);
    const preferredDayLabel = describeDayPreference(preferredDayType, preferredDayIndexes);
    const includeTechnicians = parseBoolean(input.includeTechnicians, outputDetail === "full");
    const perTechDailyLimit = clampInteger(
      input.perTechDailyLimit ?? input.per_tech_daily_limit,
      DEFAULT_DAILY_CAPACITY,
      1,
      12,
    );
    const lookaheadDays = clampInteger(
      input.lookaheadDays ?? input.lookahead_days,
      DEFAULT_LOOKAHEAD_DAYS,
      1,
      14,
    );

    if (!date) {
      logSpan(trace, "tool.call", "invalid", {
        tool_name: "availability",
        reason: "invalid_date",
        input_hash: inputHash,
      });
      return c.json(
        {
          ok: false,
          trace_id: trace.traceId,
          error: "Parameter date wajib format YYYY-MM-DD, atau gunakan today/besok.",
        },
        400,
      );
    }

    if (!areaId && !areaQuery && !branchIdFromInput) {
      logSpan(trace, "tool.call", "invalid", {
        tool_name: "availability",
        reason: "missing_area_or_branch",
        input_hash: inputHash,
      });
      return c.json(
        {
          ok: false,
          trace_id: trace.traceId,
          error: "Minimal kirim salah satu: areaId, area, atau branchId.",
        },
        400,
      );
    }

    const { data: activeAreas, error: areasError } = await supabase
      .from("areas")
      .select("*");

    if (areasError) {
      logError(trace, "tool.call", areasError, { tool_name: "availability", target: "areas" });
      return c.json({ ok: false, trace_id: trace.traceId, error: areasError.message }, 500);
    }

    const areaRows = (activeAreas || []).filter((area: GenericRow) =>
      isOpenOperationalStatus(area.status),
    );

    const { data: branchesData, error: branchesError } = await supabase
      .from("branches")
      .select("*");

    if (branchesError) {
      logError(trace, "tool.call", branchesError, { tool_name: "availability", target: "branches" });
      return c.json({ ok: false, trace_id: trace.traceId, error: branchesError.message }, 500);
    }

    const branchRows = (branchesData || []).filter((branch: GenericRow) =>
      isActiveBranchStatus(branch.status),
    );

    let matchedArea: GenericRow | null = null;
    let areaMatchMode = "";
    let matchedBranch: GenericRow | null = null;
    const areaCandidates =
      areaQuery && !areaId ? buildAreaCandidates(areaRows, areaQuery).slice(0, 5) : [];
    const branchCandidates =
      areaQuery && !branchIdFromInput
        ? buildBranchCandidates(branchRows, areaQuery).slice(0, 5)
        : [];
    const geocodedLocation = areaQuery ? await geocodeCoverageQuery(areaQuery) : null;
    const radiusBranchCandidates = geocodedLocation
      ? buildRadiusBranchCandidates(branchRows, geocodedLocation).slice(0, 8)
      : [];
    const withinRadiusCandidates = radiusBranchCandidates.filter((item) => item.withinRadius);

    if (areaId) {
      matchedArea = areaRows.find((area: GenericRow) => String(area.id) === areaId) || null;
      areaMatchMode = matchedArea ? "area-id" : "";
    } else if (areaCandidates.length > 0) {
      matchedArea = areaCandidates[0];
      areaMatchMode = "fuzzy-area-name";
    }

    if (branchIdFromInput) {
      matchedBranch =
        branchRows.find((branch: GenericRow) => String(branch.id) === branchIdFromInput) || null;
    } else if (!matchedArea && branchCandidates.length > 0) {
      matchedBranch = branchCandidates[0];
    }

    const candidateBranchMap = new Map<
      string,
      {
        branch: GenericRow;
        sourcePriority: number;
        source: string;
        distanceKm: number | null;
        radiusKm: number | null;
      }
    >();

    const registerCandidateBranch = (
      branch: GenericRow | null,
      sourcePriority: number,
      source: string,
      distanceKm: number | null = null,
      radiusKm: number | null = null,
    ) => {
      if (!branch?.id) return;
      const branchId = String(branch.id);
      const existing = candidateBranchMap.get(branchId);
      if (existing) {
        if (sourcePriority > existing.sourcePriority) {
          candidateBranchMap.set(branchId, { branch, sourcePriority, source, distanceKm, radiusKm });
        }
        return;
      }
      candidateBranchMap.set(branchId, { branch, sourcePriority, source, distanceKm, radiusKm });
    };

    if (branchIdFromInput) {
      registerCandidateBranch(
        branchRows.find((branch: GenericRow) => String(branch.id) === branchIdFromInput) || null,
        140,
        "branch-id",
      );
    }

    const areaBranchId = getBranchIdFromArea(matchedArea);
    if (areaBranchId) {
      registerCandidateBranch(
        branchRows.find((branch: GenericRow) => String(branch.id) === areaBranchId) || null,
        130,
        "area-branch",
      );
    }

    if (matchedBranch) {
      registerCandidateBranch(matchedBranch, 120, "branch-name");
    }

    branchCandidates.forEach((branch, index) => {
      registerCandidateBranch(branch, 110 - index, "branch-candidate");
    });

    radiusBranchCandidates.forEach((item, index) => {
      if (!item.withinRadius) return;
      registerCandidateBranch(item.branch, 100 - index, "radius", item.distanceKm, item.radiusKm);
    });

    const candidateBranches = Array.from(candidateBranchMap.values());

    if (
      areaQuery &&
      geocodedLocation &&
      withinRadiusCandidates.length === 0 &&
      !areaId &&
      !branchIdFromInput &&
      !matchedArea
    ) {
      const nearestBranches = radiusBranchCandidates.slice(0, 3).map((item) => ({
        id: item.branch.id,
        name: branchNameOf(item.branch),
        distanceKm: Number(item.distanceKm.toFixed(1)),
        radiusKm: item.radiusKm,
        withinRadius: item.withinRadius,
      }));

      return c.json(
        {
          ok: true,
          source: "cekat-availability",
          status: "outside-radius",
          error: null,
          humanSummary:
            `Lokasi ${areaQuery} belum masuk radius cabang operasional kami saat ini. ` +
            "Kalau mau, kami bisa cek area terdekat yang masih terjangkau atau arahkan ke coverage terdekat.",
          customerFacingSummary:
            `Untuk ${areaQuery}, lokasi tersebut belum masuk radius cabang operasional kami saat ini ya kak 🙏`,
          recommendedNextQuestion:
            "Boleh info titik area terdekat atau kecamatan yang paling dekat ya kak? Biar kami cek cabang yang paling memungkinkan 😊",
          ...(outputDetail === "full"
            ? {
                areaCandidates: areaCandidates.map((area) => ({
                  id: area.id,
                  name: areaNameOf(area),
                  branchId: getBranchIdFromArea(area),
                })),
                branchCandidates: branchCandidates.map((branch) => ({
                  id: branch.id,
                  name: branchNameOf(branch),
                })),
                nearestBranches,
                geocodedLocation,
                serviceCoverage: {
                  note: SERVICE_COVERAGE_NOTE,
                  anchorCities: SERVICE_COVERAGE_ANCHORS,
                  matchedCluster: resolveCoverageCluster(areaQuery),
                },
                assumptions: [
                  "Coverage otomatis mengutamakan radius cabang operasional dari master data branches.",
                  "Jika tidak ada cabang yang masuk radius, area dianggap di luar jangkauan operasional untuk auto-booking.",
                ],
              }
            : {
                nearestBranches,
              }),
        },
        200,
      );
    }

    if (candidateBranches.length === 0) {
      return c.json(
        {
          ok: false,
          source: "cekat-availability",
          status: "unknown-area",
          error: "Cabang untuk area tersebut belum bisa dipetakan otomatis.",
          humanSummary: areaQuery
            ? `Lokasi ${areaQuery} belum bisa dipetakan otomatis ke cabang operasional. Minta kecamatan atau alamat yang lebih detail.`
            : "Lokasi belum bisa dipetakan otomatis ke cabang operasional.",
          customerFacingSummary: areaQuery
            ? `Untuk ${areaQuery}, lokasinya belum bisa kami petakan otomatis dulu ya kak 🙏`
            : "Lokasi belum bisa kami petakan otomatis dulu ya kak 🙏",
          recommendedNextQuestion:
            "Boleh info kecamatan atau patokan alamat yang lebih detail ya kak? Biar kami cek cabang yang paling akurat 😊",
          ...(outputDetail === "full"
            ? {
                areaCandidates: areaCandidates.map((area) => ({
                  id: area.id,
                  name: areaNameOf(area),
                  branchId: getBranchIdFromArea(area),
                })),
                branchCandidates: branchCandidates.map((branch) => ({
                  id: branch.id,
                  name: branchNameOf(branch),
                })),
                nearestBranches: radiusBranchCandidates.slice(0, 3).map((item) => ({
                  id: item.branch.id,
                  name: branchNameOf(item.branch),
                  distanceKm: Number(item.distanceKm.toFixed(1)),
                  radiusKm: item.radiusKm,
                  withinRadius: item.withinRadius,
                })),
                geocodedLocation,
                serviceCoverage: {
                  note: SERVICE_COVERAGE_NOTE,
                  anchorCities: SERVICE_COVERAGE_ANCHORS,
                },
              }
            : {
                nearestBranches: radiusBranchCandidates.slice(0, 3).map((item) => ({
                  id: item.branch.id,
                  name: branchNameOf(item.branch),
                  distanceKm: Number(item.distanceKm.toFixed(1)),
                })),
              }),
        },
        200,
      );
    }

    const candidateBranchIds = candidateBranches.map((item) => String(item.branch.id));

    const { data: techniciansData, error: techniciansError } = await supabase
      .from("profiles")
      .select("id, name, email, role, status, branch_id")
      .in("branch_id", candidateBranchIds)
      .in("role", ["Teknisi", "teknisi", "Technician", "technician"]);

    if (techniciansError) {
      logError(trace, "tool.call", techniciansError, { tool_name: "availability", target: "users" });
      return c.json({ ok: false, trace_id: trace.traceId, error: techniciansError.message }, 500);
    }

    const allTechnicians = (techniciansData || []).filter((technician: GenericRow) =>
      isActiveUserStatus(technician.status),
    );
    const technicianIds = allTechnicians.map((technician: GenericRow) => String(technician.id));

    const rangeEndDate = addDays(date, lookaheadDays - 1);

    let schedules: GenericRow[] = [];
    if (technicianIds.length > 0) {
      const { data: schedulesData, error: schedulesError } = await supabase
        .from("technician_schedules")
        .select("id, user_id, date, type, reason")
        .in("user_id", technicianIds)
        .gte("date", date)
        .lte("date", rangeEndDate);

      if (schedulesError) {
        logError(trace, "tool.call", schedulesError, { tool_name: "availability", target: "shifts" });
        return c.json({ ok: false, trace_id: trace.traceId, error: schedulesError.message }, 500);
      }
      schedules = schedulesData || [];
    }

    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select("id, technician_id, service_date, service_time, status, branch_id, area_id, address, maps_url")
      .in("branch_id", candidateBranchIds)
      .gte("service_date", date)
      .lte("service_date", rangeEndDate);

    if (ordersError) {
      logError(trace, "tool.call", ordersError, { tool_name: "availability", target: "orders" });
      return c.json({ ok: false, trace_id: trace.traceId, error: ordersError.message }, 500);
    }

    const { data: bookingsData, error: bookingsError } = await supabase
      .from("prospect_bookings")
      .select("id, order_id, technician_id, schedule_date, schedule_time, status, branch_id, area_id, address, maps_url")
      .in("branch_id", candidateBranchIds)
      .gte("schedule_date", date)
      .lte("schedule_date", rangeEndDate);

    if (bookingsError) {
      logError(trace, "tool.call", bookingsError, { tool_name: "availability", target: "bookings" });
      return c.json({ ok: false, trace_id: trace.traceId, error: bookingsError.message }, 500);
    }

    const allOrders = (ordersData || []).filter((order: GenericRow) =>
      isOpenOperationalStatus(order.status),
    );
    const allBookings = (bookingsData || []).filter(
      (booking: GenericRow) =>
        isOpenOperationalStatus(booking.status) && !booking.order_id,
    );
    const candidateSummaries = candidateBranches.map((candidate) => {
      const branchId = String(candidate.branch.id);
      const technicians = allTechnicians.filter((technician) => String(technician.branch_id || "") === branchId);
      const branchTechnicianIds = new Set(technicians.map((technician) => String(technician.id)));
      const branchSchedules = schedules.filter((schedule) => branchTechnicianIds.has(String(schedule.user_id || schedule.userId || "")));
      const branchOrders = allOrders.filter((order) => String(order.branch_id || "") === branchId);
      const branchBookings = allBookings.filter((booking) => String(booking.branch_id || "") === branchId);
      const branchMatchedArea =
        matchedArea && getBranchIdFromArea(matchedArea) === branchId ? matchedArea : null;

      return {
        ...candidate,
        summary: summarizeBranchAvailability({
          branch: candidate.branch,
          matchedArea: branchMatchedArea,
          technicians,
          schedules: branchSchedules,
          orders: branchOrders,
          bookings: branchBookings,
          date,
          time,
          perTechDailyLimit,
          hasDayPreference,
          preferredDayType,
          preferredDayIndexes,
          dateWasExplicit,
          lookaheadDays,
          currentClock,
          targetLocationText: pickText(areaQuery, geocodedLocation?.label, matchedArea ? areaNameOf(matchedArea) : ""),
        }),
      };
    });

    candidateSummaries.sort((left, right) => {
      const leftAvailable = left.summary.selectedAvailability.remainingSlots > 0 ? 1 : 0;
      const rightAvailable = right.summary.selectedAvailability.remainingSlots > 0 ? 1 : 0;
      if (rightAvailable !== leftAvailable) return rightAvailable - leftAvailable;

      const leftSameDate = left.summary.selectedAvailability.date === date ? 1 : 0;
      const rightSameDate = right.summary.selectedAvailability.date === date ? 1 : 0;
      if (rightSameDate !== leftSameDate) return rightSameDate - leftSameDate;

      const leftRouteScore = time ? left.summary.bestTechnicianRoute?.score || 0 : 0;
      const rightRouteScore = time ? right.summary.bestTechnicianRoute?.score || 0 : 0;
      if (rightRouteScore !== leftRouteScore) return rightRouteScore - leftRouteScore;

      if (left.distanceKm !== null && right.distanceKm !== null && leftAvailable === rightAvailable) {
        if (left.distanceKm !== right.distanceKm) return left.distanceKm - right.distanceKm;
      }

      if (right.sourcePriority !== left.sourcePriority) return right.sourcePriority - left.sourcePriority;

      return branchNameOf(left.branch).localeCompare(branchNameOf(right.branch));
    });

    const chosenBranch = candidateSummaries[0];
    const resolvedBranchId = String(chosenBranch.branch.id);
    const branchRow = chosenBranch.branch;
    const {
      technicians,
      dailyAvailabilityToday,
      orders,
      bookings,
      selectedAvailability,
      selectedDate,
      requestedDateMatchesPreference,
      requestedTimeAlreadyPassed,
      requestedTimeDowngradedToDaily,
      preferShiftedDate,
      timeScopedAvailability,
      availableTimeOptions,
      bestTechnicianRoute,
      nextAvailableDates,
      nextAvailableDateOptions,
      nextAvailableDatesIgnoringPreference,
      dateOrders,
      dateBookings,
      areaLoad,
    } = chosenBranch.summary;

    const perTechnicianAssignedCount = new Map<string, number>();
    for (const order of dateOrders) {
      const technicianId = String(order.technician_id || "");
      if (!technicianId) continue;
      perTechnicianAssignedCount.set(
        technicianId,
        (perTechnicianAssignedCount.get(technicianId) || 0) + 1,
      );
    }
    for (const booking of dateBookings) {
      const technicianId = String(booking.technician_id || "");
      if (!technicianId) continue;
      perTechnicianAssignedCount.set(
        technicianId,
        (perTechnicianAssignedCount.get(technicianId) || 0) + 1,
      );
    }

    const offToday = new Set(
      schedules
        .filter((schedule) => String(schedule.date || "") === selectedDate)
        .map((schedule) => String(schedule.user_id || "")),
    );

    const technicianBreakdown = includeTechnicians
      ? technicians.map((technician) => {
          const technicianId = String(technician.id);
          const assignedCount = perTechnicianAssignedCount.get(technicianId) || 0;
          const offDuty = offToday.has(technicianId);
          const remainingCapacity = selectedAvailability.mode === "time-specific"
            ? selectedAvailability.availableTechnicianIds.includes(technicianId)
              ? 1
              : 0
            : Math.max(0, perTechDailyLimit - assignedCount);

          return {
            id: technicianId,
            name: technicianNameOf(technician),
            branchId: technician.branch_id || null,
            offDuty,
            assignedCount,
            remainingCapacity,
            status: offDuty ? "off-duty" : remainingCapacity > 0 ? "available" : "busy",
          };
        })
      : [];

    const matchedAreaName = matchedArea ? areaNameOf(matchedArea) : "";
    const branchName = branchNameOf(branchRow || null);
    const internalScopeLabel = matchedAreaName
      ? `${matchedAreaName}${branchName ? ` (${branchName})` : ""}`
      : branchName || resolvedBranchId;
    const customerScopeLabel =
      matchedAreaName ||
      pickText(areaQuery, geocodedLocation?.label?.split(",")?.[0], branchName, resolvedBranchId);
    const coverageCluster = resolveCoverageCluster(branchName || matchedAreaName || areaQuery);
    const nextDatesLabel = formatDateListLabel(nextAvailableDates);
    const selectedDateLabel = formatHumanDateLabel(selectedDate);
    const normalizedRequestedTime = normalizeTimeValue(time);
    const hasSameDayTimeOptions = availableTimeOptions.length > 0;
    const shouldTreatTodayAsUnavailableForBuyer = Boolean(
      requestedTimeAlreadyPassed && !hasSameDayTimeOptions,
    );
    const shouldTreatDowngradedRequestAsDailyFull = Boolean(
      (requestedTimeDowngradedToDaily &&
        (dailyAvailabilityToday.remainingSlots <= 0 || !hasSameDayTimeOptions)) ||
      shouldTreatTodayAsUnavailableForBuyer,
    );
    const suppressSameDayTimeOptions = Boolean(
      shouldTreatDowngradedRequestAsDailyFull,
    );
    const effectiveSelectedAvailability = suppressSameDayTimeOptions
      ? {
          ...selectedAvailability,
          status: "full",
          remainingSlots: 0,
          capacity: dailyAvailabilityToday.capacity,
          usedCapacity: Math.max(dailyAvailabilityToday.usedCapacity, dailyAvailabilityToday.capacity),
          totalTechnicians: dailyAvailabilityToday.totalTechnicians,
          onDutyTechnicians: dailyAvailabilityToday.onDutyTechnicians,
          offTechnicians: dailyAvailabilityToday.offTechnicians,
          occupiedTechnicians: dailyAvailabilityToday.occupiedTechnicians,
          unassignedReservations: dailyAvailabilityToday.unassignedReservations,
          mode: dailyAvailabilityToday.mode,
        }
      : selectedAvailability;
    const surfacedAvailableTimeOptions = suppressSameDayTimeOptions ? [] : availableTimeOptions;
    const sameDayAlternativeTimeOptions = normalizedRequestedTime
      ? surfacedAvailableTimeOptions.filter((item) => normalizeTimeValue(item.time) !== normalizedRequestedTime)
      : surfacedAvailableTimeOptions;
    const salesAvailableTimeOptions = surfacedAvailableTimeOptions.slice(0, 2);
    const salesSameDayAlternativeTimeOptions = sameDayAlternativeTimeOptions.slice(0, 2);
    const availableTimesLabel = salesAvailableTimeOptions.map((item) => item.time).join(" atau ");
    const sameDayAlternativeTimesLabel = salesSameDayAlternativeTimeOptions.map((item) => item.time).join(" atau ");
    const primaryAvailableTime = salesAvailableTimeOptions[0]?.time || "";
    const secondaryAvailableTime = salesAvailableTimeOptions[1]?.time || "";
    const requestedTimeDowngradedButDailyStillAvailable = Boolean(
      time &&
      requestedTimeDowngradedToDaily &&
      !shouldTreatDowngradedRequestAsDailyFull &&
      effectiveSelectedAvailability.remainingSlots > 0 &&
      salesAvailableTimeOptions.length > 0,
    );
    const requestedTimeFullButSameDayAlternatives =
      Boolean(
        time &&
        selectedAvailability.mode === "time-specific" &&
        selectedAvailability.remainingSlots <= 0 &&
        sameDayAlternativeTimeOptions.length > 0,
      );
    const humanSummary = requestedTimeAlreadyPassed && surfacedAvailableTimeOptions.length > 0
      ? `Jam ${time} untuk ${selectedDate} sudah lewat. Opsi jam yang masih tersedia hari ini: ${availableTimesLabel}.`
      : hasDayPreference && nextAvailableDates.length === 0
      ? `Area ${internalScopeLabel} belum punya slot yang cocok untuk preferensi ${preferredDayLabel} dalam ${lookaheadDays} hari ke depan.`
      : preferShiftedDate
      ? `Untuk preferensi ${preferredDayLabel}, slot terdekat di area ${internalScopeLabel} ada pada ${selectedDateLabel} dengan sisa ${selectedAvailability.remainingSlots} slot.`
      : requestedTimeDowngradedButDailyStillAvailable
      ? `Area ${internalScopeLabel} untuk ${selectedDateLabel} jam ${time} sudah tidak tersedia. Opsi jam lain di tanggal yang sama: ${availableTimesLabel}.`
      : requestedTimeFullButSameDayAlternatives
      ? `Area ${internalScopeLabel} untuk ${selectedDateLabel} jam ${time} sudah penuh. Opsi jam lain di tanggal yang sama: ${sameDayAlternativeTimesLabel}.`
      : requestedTimeDowngradedToDaily
      ? nextAvailableDates.length > 0
        ? `Area ${internalScopeLabel} untuk ${selectedDateLabel} sudah penuh secara harian. Opsi tanggal kosong terdekat: ${nextDatesLabel}.`
        : `Area ${internalScopeLabel} untuk ${selectedDateLabel} sudah penuh secara harian, jadi permintaan jam ${time} belum bisa diakomodasi.`
      : selectedAvailability.remainingSlots > 0
      ? `Area ${internalScopeLabel} untuk ${selectedDateLabel}${selectedAvailability.mode === "time-specific" ? ` jam ${time}` : ""} masih tersedia ${selectedAvailability.remainingSlots} slot.`
      : nextAvailableDates.length > 0
      ? `Area ${internalScopeLabel} untuk ${selectedDateLabel}${selectedAvailability.mode === "time-specific" ? ` jam ${time}` : ""} sedang penuh. Opsi tanggal kosong terdekat: ${nextDatesLabel}.`
      : `Area ${internalScopeLabel} untuk ${selectedDateLabel}${selectedAvailability.mode === "time-specific" ? ` jam ${time}` : ""} sedang penuh berdasarkan kapasitas teknisi yang on duty.`;

    const customerFacingSummary = requestedTimeAlreadyPassed && surfacedAvailableTimeOptions.length > 0
      ? `Untuk hari ini, jam ${time} sudah lewat ya kak 🙏 Yang paling dekat masih tersedia jam ${availableTimesLabel}.`
      : requestedTimeDowngradedButDailyStillAvailable
      ? `Untuk area ${customerScopeLabel}, jam ${time} di ${selectedDateLabel} sudah tidak tersedia ya kak 🙏 Tapi di hari yang sama masih ada slot di jam ${availableTimesLabel}.`
      : requestedTimeDowngradedToDaily
      ? nextAvailableDates.length > 0
        ? `Untuk area ${customerScopeLabel}, hari ini slotnya sudah penuh ya kak 🙏 Tapi masih ada slot kosong di ${nextDatesLabel}.`
        : `Untuk area ${customerScopeLabel}, hari ini slotnya sudah penuh ya kak 🙏`
      : requestedTimeAlreadyPassed
      ? `Untuk hari ini, jam ${time} sudah lewat ya kak 🙏`
      : hasDayPreference && nextAvailableDates.length === 0
      ? `Untuk area ${customerScopeLabel}, belum ada slot yang cocok dengan preferensi ${preferredDayLabel} dalam ${lookaheadDays} hari ke depan ya kak 🙏`
      : selectedAvailability.remainingSlots > 0 && selectedAvailability.mode === "time-specific"
      ? `Untuk area ${customerScopeLabel}, slot ${selectedDateLabel} jam ${time} masih tersedia ya kak 😊`
      : requestedTimeFullButSameDayAlternatives
      ? `Untuk area ${customerScopeLabel}, tanggal ${selectedDateLabel} jam ${time} slotnya sudah penuh ya kak 🙏 Tapi di hari yang sama masih ada slot di jam ${sameDayAlternativeTimesLabel}.`
      : selectedAvailability.remainingSlots > 0 && surfacedAvailableTimeOptions.length > 0
      ? secondaryAvailableTime
        ? `Untuk area ${customerScopeLabel}, tanggal ${selectedDateLabel} masih ada slot ya kak 😊 Yang paling dekat tersedia jam ${primaryAvailableTime}, lalu ${secondaryAvailableTime}.`
        : `Untuk area ${customerScopeLabel}, tanggal ${selectedDateLabel} masih ada slot ya kak 😊 Yang paling dekat tersedia jam ${primaryAvailableTime}.`
      : selectedAvailability.remainingSlots > 0
      ? `Untuk area ${customerScopeLabel}, masih ada slot kosong di ${selectedDateLabel} ya kak 😊`
      : nextAvailableDates.length > 0
      ? `Untuk area ${customerScopeLabel}, tanggal ${selectedDateLabel}${time ? ` jam ${time}` : ""} sudah penuh ya kak 🙏 Tapi masih ada slot kosong di ${nextDatesLabel}.`
      : `Untuk area ${customerScopeLabel}, tanggal ${selectedDateLabel}${time ? ` jam ${time}` : ""} sedang penuh ya kak 🙏`;

    const recommendedNextQuestion = requestedTimeAlreadyPassed && surfacedAvailableTimeOptions.length > 0
      ? secondaryAvailableTime
        ? `Kalau berkenan, kakak lebih cocok jam ${primaryAvailableTime} atau ${secondaryAvailableTime} ya kak? Biar saya bantu hold slot sementara tanpa DP untuk yang paling cocok 😊`
        : `Kalau berkenan, saya bantu cek dan hold slot sementara tanpa DP di jam ${primaryAvailableTime} ya kak? 😊`
      : requestedTimeDowngradedButDailyStillAvailable
      ? secondaryAvailableTime
        ? `Kalau berkenan, kakak lebih cocok jam ${primaryAvailableTime} atau ${secondaryAvailableTime} ya kak? Biar saya bantu hold slot sementara tanpa DP di hari yang sama 😊`
        : `Kalau berkenan, saya bantu cek dan hold slot sementara tanpa DP di jam ${primaryAvailableTime} untuk hari yang sama ya kak? 😊`
      : requestedTimeDowngradedToDaily
      ? nextAvailableDates.length > 0
        ? `Kalau berkenan, kakak mau pilih ${nextDatesLabel} yang paling cocok ya? Nanti saya bantu lanjut cek jam yang masih kosong 😊`
        : "Kalau mau, kakak boleh info tanggal alternatif yang paling cocok ya kak? Biar kami carikan slot terdekat 😊"
      : requestedTimeAlreadyPassed
      ? "Kalau mau, kakak boleh pilih tanggal atau jam lain yang lebih cocok ya kak 😊"
      : requestedTimeFullButSameDayAlternatives
      ? salesSameDayAlternativeTimeOptions.length > 1
        ? `Kalau berkenan, untuk tanggal ${selectedDateLabel} kakak lebih cocok jam ${sameDayAlternativeTimesLabel} ya kak? Biar saya bantu hold slot sementara tanpa DP untuk salah satunya 😊`
        : `Kalau berkenan, untuk tanggal ${selectedDateLabel} saya bantu cek dan hold slot sementara tanpa DP di jam ${sameDayAlternativeTimesLabel} ya kak? 😊`
      : selectedAvailability.remainingSlots > 0 && selectedAvailability.mode !== "time-specific" && surfacedAvailableTimeOptions.length > 0
      ? secondaryAvailableTime
        ? `Kalau berkenan, kakak lebih cocok jam ${primaryAvailableTime} atau ${secondaryAvailableTime} ya kak? Biar saya bantu hold slot sementara tanpa DP untuk yang paling pas 😊`
        : `Kalau berkenan, saya bantu hold slot sementara tanpa DP di jam ${primaryAvailableTime} ya kak? 😊`
      : selectedAvailability.remainingSlots > 0 && selectedAvailability.mode !== "time-specific"
      ? "Kalau berkenan, kakak maunya jam berapa ya kak? Biar saya cekkan dan bantu hold slot sementara tanpa DP untuk yang paling pas 😊"
      : selectedAvailability.remainingSlots > 0
      ? "Kalau slot ini cocok, boleh sekalian kirim nama, alamat lengkap, dan nomor WhatsApp ya kak? Biar saya bantu hold slot sementaranya tanpa DP 😊"
      : nextAvailableDates.length > 0
      ? `Kalau berkenan, mau pilih ${nextDatesLabel} yang paling cocok ya kak? Nanti sekalian kasih jam yang diinginkan 😊`
      : "Kalau mau, boleh info tanggal atau area alternatif yang paling dekat ya kak? Biar kami carikan opsi yang masih memungkinkan 😊";

    const slimResponse = {
      ok: true,
      trace_id: trace.traceId,
      source: "cekat-availability",
      status: effectiveSelectedAvailability.status,
      matchedArea: matchedArea
        ? {
            id: matchedArea.id,
            name: matchedAreaName,
            branchId: resolvedBranchId,
            matchedBy: areaMatchMode,
          }
        : null,
      branch: {
        id: resolvedBranchId,
        name: branchName || resolvedBranchId,
        matchedBy: chosenBranch.source,
        distanceKm: chosenBranch.distanceKm !== null ? Number(chosenBranch.distanceKm.toFixed(1)) : null,
        radiusKm: chosenBranch.radiusKm,
      },
      availability: {
        status: effectiveSelectedAvailability.status,
        remainingSlots: effectiveSelectedAvailability.remainingSlots,
        mode: effectiveSelectedAvailability.mode,
        requestedTimeDowngradedToDaily,
        selectedDate,
      },
      requestedTime: time
        ? {
            value: time,
            isPastTime: requestedTimeAlreadyPassed,
            interpretedAs: selectedAvailability.mode === "time-specific" && !requestedTimeDowngradedToDaily
              ? "time-specific"
              : requestedTimeAlreadyPassed
              ? "past-time"
              : "daily-fallback",
          }
        : null,
      nextAvailableDates,
      nextAvailableDateOptions,
      selectedDateLabel,
      availableTimeOptions: salesAvailableTimeOptions,
      humanSummary,
      customerFacingSummary,
      recommendedNextQuestion,
    };

    if (outputDetail !== "full") {
      logSpan(trace, "tool.call", "ok", {
        tool_name: "availability",
        input_hash: inputHash,
        output_hash: hashForTelemetry(slimResponse),
        area_match_mode: areaMatchMode,
        status: effectiveSelectedAvailability.status,
        selected_date: selectedDate,
        requested_time: time || null,
        remaining_slots: effectiveSelectedAvailability.remainingSlots,
      });
      return c.json(slimResponse);
    }

    const fullResponse = {
      ...slimResponse,
      query: {
        areaId: areaId || null,
        area: areaQuery || null,
        branchId: branchIdFromInput || null,
        date,
        time: time || null,
        dateWasExplicit,
        preferredDayType: preferredDayType || null,
        preferredDays: preferredDayIndexes.length > 0
          ? preferredDayIndexes.map((dayIndex) => WEEKDAY_LABELS[dayIndex])
          : [],
        perTechDailyLimit,
        lookaheadDays,
      },
      availability: {
        ...slimResponse.availability,
        capacity: effectiveSelectedAvailability.capacity,
        usedCapacity: effectiveSelectedAvailability.usedCapacity,
        totalTechnicians: effectiveSelectedAvailability.totalTechnicians,
        onDutyTechnicians: effectiveSelectedAvailability.onDutyTechnicians,
        offTechnicians: effectiveSelectedAvailability.offTechnicians,
        occupiedTechnicians: effectiveSelectedAvailability.occupiedTechnicians,
        unassignedReservations: effectiveSelectedAvailability.unassignedReservations,
      },
      requestedTime: time
        ? {
            ...slimResponse.requestedTime,
            snapshot: timeScopedAvailability
              ? {
                  status: timeScopedAvailability.status,
                  remainingSlots: timeScopedAvailability.remainingSlots,
                  capacity: timeScopedAvailability.capacity,
                  usedCapacity: timeScopedAvailability.usedCapacity,
                }
              : null,
          }
        : null,
      load: {
        branch: {
          orders: dateOrders.length,
          prospectBookings: dateBookings.length,
        },
        area: areaLoad,
      },
      nextAvailableDateLabels: nextAvailableDates.map((item) => formatHumanDateLabel(item.date)).filter(Boolean),
      nextAvailableDatesIgnoringPreference,
      technicianBreakdown,
      areaCandidates: areaCandidates.map((area) => ({
        id: area.id,
        name: areaNameOf(area),
        branchId: getBranchIdFromArea(area),
      })),
      branchCandidates: candidateSummaries.map((candidate) => ({
        id: candidate.branch.id,
        name: branchNameOf(candidate.branch),
        matchedBy: candidate.source,
        distanceKm: candidate.distanceKm !== null ? Number(candidate.distanceKm.toFixed(1)) : null,
        radiusKm: candidate.radiusKm,
        remainingSlots: candidate.summary.selectedAvailability.remainingSlots,
        selectedDate: candidate.summary.selectedDate,
        status: candidate.summary.selectedAvailability.status,
        recommendedTechnicianId: candidate.summary.bestTechnicianRoute?.technicianId || null,
        recommendedTechnicianName: candidate.summary.bestTechnicianRoute?.name || null,
        routeScore: candidate.summary.bestTechnicianRoute?.score || 0,
      })),
      recommendedTechnician: bestTechnicianRoute
        ? {
            id: bestTechnicianRoute.technicianId,
            name: bestTechnicianRoute.name,
            score: bestTechnicianRoute.score,
            gapScore: bestTechnicianRoute.gapScore,
            similarityScore: bestTechnicianRoute.similarityScore,
          }
        : null,
      assumptions: [
        "Kapasitas dihitung dari jumlah teknisi on duty di cabang area tersebut.",
        `Kapasitas default per teknisi per hari = ${perTechDailyLimit} job.`,
        "Data booking prospek yang sudah punya order_id tidak dihitung dua kali.",
        "Teknisi yang memiliki entry di technician_schedules pada tanggal terkait dianggap tidak tersedia.",
        "Jika kapasitas harian cabang sudah penuh, hasil cek per jam akan diturunkan menjadi status penuh harian agar AI tidak menawarkan slot yang menyesatkan.",
        "Jika customer punya preferensi weekday/weekend/hari tertentu dan tanggal tidak disebut eksplisit, sistem akan mengutamakan slot yang sesuai preferensi tersebut.",
        "Jika satu lokasi masuk radius beberapa cabang operasional, sistem akan memprioritaskan cabang yang masih punya slot dan paling dekat ke titik lokasi.",
      ],
      dayPreference: hasDayPreference
        ? {
            type: preferredDayType || null,
            days: preferredDayIndexes.map((dayIndex) => WEEKDAY_LABELS[dayIndex]),
            label: preferredDayLabel,
            requestedDateMatchesPreference,
            shiftedToDate: preferShiftedDate ? selectedDate : null,
          }
        : null,
      serviceCoverage: {
        note: SERVICE_COVERAGE_NOTE,
        anchorCities: SERVICE_COVERAGE_ANCHORS,
        matchedCluster: coverageCluster,
        geocodedLocation,
        radiusBranches: radiusBranchCandidates.slice(0, 5).map((item) => ({
          id: item.branch.id,
          name: branchNameOf(item.branch),
          distanceKm: Number(item.distanceKm.toFixed(1)),
          radiusKm: item.radiusKm,
          withinRadius: item.withinRadius,
        })),
      },
      clock: {
        timezone: currentClock.timezone,
        currentDate: currentClock.date,
        currentTime: currentClock.time,
      },
    };
    logSpan(trace, "tool.call", "ok", {
      tool_name: "availability",
      input_hash: inputHash,
      output_hash: hashForTelemetry(fullResponse),
      area_match_mode: areaMatchMode,
      status: effectiveSelectedAvailability.status,
      selected_date: selectedDate,
      requested_time: time || null,
      remaining_slots: effectiveSelectedAvailability.remainingSlots,
    });
    return c.json(fullResponse);
  } catch (error: any) {
    logError(trace, "tool.call", error, { tool_name: "availability" });
    return c.json(
      {
        ok: false,
        trace_id: trace.traceId,
        error: error?.message || "Unknown error",
      },
      500,
    );
  }
});

route.get("/availability/health", async (c) => {
  const trace = createTraceContext({
    service: "cekat-availability",
    method: c.req.method,
    path: c.req.path,
    headers: headersFromRequest(c),
  });
  const authorization = await authorizeRequest(c);
  if (!authorization.ok) {
    logSpan(trace, "tool.call", "unauthorized", { tool_name: "availability.health" });
    return c.json(
      { ok: false, trace_id: trace.traceId, error: authorization.error },
      { status: authorization.status as 401 | 403 },
    );
  }

  const response = {
    ok: true,
    trace_id: trace.traceId,
    source: "cekat-availability",
    env: {
      hasApiKey: Boolean(API_KEY),
      defaultDailyCapacity: DEFAULT_DAILY_CAPACITY,
      defaultLookaheadDays: DEFAULT_LOOKAHEAD_DAYS,
    },
    checkedAt: new Date().toISOString(),
  };
  logSpan(trace, "tool.call", "ok", {
    tool_name: "availability.health",
    output_hash: hashForTelemetry(response),
  });
  return c.json(response);
});

export default route;
