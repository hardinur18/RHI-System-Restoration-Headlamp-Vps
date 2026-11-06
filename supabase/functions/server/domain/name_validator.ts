// Deterministic customer-name validator for Polesheadlamp.id
// Source of truth: CEKAT_AGENT_BLUEPRINT.md §9 and AI_CS_SYSTEM_BLUEPRINT.md §30 task 8

export interface NameValidationOutput {
  valid: boolean;
  normalized_name: string | null;
  reason:
    | "ok"
    | "empty"
    | "too_short"
    | "numeric_only"
    | "username"
    | "known_bad_pattern"
    | "question_or_intent"
    | "vehicle_or_area"
    | "too_long";
  suggested_customer_text: string | null;
}

const KNOWN_BAD_PATTERNS = [
  /\bbrp\b/i,
  /\bberapa\b/i,
  /\bharga\b/i,
  /\bbiaya\b/i,
  /\bbooking\b/i,
  /\bjadwal\b/i,
  /\bnomer\b/i,
  /\bnomor\b/i,
  /\bwa\b/i,
  /\bbisa\b/i,
  /\bpanggil\b/i,
  /\baku\b/i,
  /\bsaya\b/i,
  /\bgue\b/i,
  /\bgw\b/i,
  /\bkak\b/i,
  /\bka\b/i,
  /\bmin\b/i,
  /\bbelum\s+isi\s+nama\b/i,
  /^lead\s+\d+$/i,
  /^lead\s+cekat$/i,
];

const VEHICLE_OR_AREA_HINTS = [
  /\b(avanza|xenia|rush|terios|brio|jazz|yaris|innova|fortuner|pajero|hrv|crv|bmw|mercy|mazda|nissan|toyota|honda|suzuki|daihatsu)\b/i,
  /\b(jakarta|depok|bekasi|bogor|tangerang|cikarang|cibubur|sawangan|pasar minggu|bandung|karawang|serang|cilegon)\b/i,
];

export function validateName(
  rawName: string | null | undefined,
): NameValidationOutput {
  const raw = (rawName ?? "").trim();
  if (!raw) return invalid("empty");
  if (raw.length > 80) return invalid("too_long");
  if (/^lead\s*\d+$/i.test(raw) || /^lead\s+cekat$/i.test(raw) || /^belum\s+isi\s+nama$/i.test(raw)) {
    return invalid("known_bad_pattern");
  }
  if (/^\d+$/.test(raw.replace(/\s+/g, ""))) return invalid("numeric_only");
  if (/^@/.test(raw) || /^[a-z0-9._]{3,}$/i.test(raw) && raw.includes("_")) {
    return invalid("username");
  }
  if (/^[a-z0-9._-]{4,}$/i.test(raw) && !/\s/.test(raw) && /\d{2,}/.test(raw)) {
    return invalid("username");
  }

  const cleaned = raw
    .replace(/[^\p{L}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return invalid("empty");
  if (cleaned.length < 2) return invalid("too_short");
  if (KNOWN_BAD_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return invalid("question_or_intent");
  }
  if (VEHICLE_OR_AREA_HINTS.some((pattern) => pattern.test(cleaned))) {
    return invalid("vehicle_or_area");
  }

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount > 5) return invalid("known_bad_pattern");

  return {
    valid: true,
    normalized_name: titleCase(cleaned),
    reason: "ok",
    suggested_customer_text: null,
  };
}

function invalid(reason: NameValidationOutput["reason"]): NameValidationOutput {
  return {
    valid: false,
    normalized_name: null,
    reason,
    suggested_customer_text: "Boleh nama lengkapnya kak?",
  };
}

function titleCase(text: string): string {
  return text
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
