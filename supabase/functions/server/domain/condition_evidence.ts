export type ConditionEvidence = "missing" | "broad_only" | "clear" | "photo_verified";

export interface ResolveConditionEvidenceInput {
  conditionConfidence?: unknown;
  conditionText?: string | null;
  rawText?: string | null;
  lastCustomerMessage?: string | null;
  photoReceived?: boolean;
}

export function resolveConditionEvidence(
  input: ResolveConditionEvidenceInput,
): ConditionEvidence {
  if (input.photoReceived) {
    return "photo_verified";
  }

  const evidence = classifyConditionEvidence(
    [input.conditionText, input.rawText, input.lastCustomerMessage].filter(Boolean).join(" "),
  );
  if (evidence === "clear") {
    return "clear";
  }
  if (evidence === "broad_only") {
    return "broad_only";
  }

  const normalized = normalizeToken(input.conditionConfidence);
  if (normalized === "photo_verified" || normalized === "photoverified" || normalized === "photo") {
    return "missing";
  }
  if (normalized === "clear") {
    return "missing";
  }
  if (
    normalized === "broad_only" ||
    normalized === "broad" ||
    normalized === "unclear" ||
    normalized === "unknown"
  ) {
    return "broad_only";
  }
  return "missing";
}

export function classifyConditionEvidence(text: string): "missing" | "broad_only" | "clear" {
  const normalized = normalizeFreeText(text);
  if (!normalized) return "missing";

  const hasSpecificRisk =
    /\b(embun|jamur|retak|retak rambut|baret|lecet|pecah|gores|thinner)\b/.test(normalized);
  if (hasSpecificRisk) return "clear";

  const hasBroadCondition =
    /\b(menguning|kuning|kusam|buram|suram|pudar|oksidasi)\b/.test(normalized);
  return hasBroadCondition ? "broad_only" : "missing";
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
