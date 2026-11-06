// Deterministic objection classifier.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §6.3, §7.4, §14.3, §30 task 15.

export type ObjectionSeverity = "low" | "medium" | "high";
export type LossRisk = "low" | "medium" | "high";

export interface ObjectionRule {
  id: string;
  severity_default: ObjectionSeverity;
  triggers: string[];
  human_required: boolean;
  recommended_playbook_id: string | null;
  loss_risk: LossRisk;
}

export interface ObjectionClassificationInput {
  text?: string | null;
  signals?: string[] | null;
  customer_repeat_count?: number | null;
  catalog?: ObjectionRule[] | null;
}

export interface ObjectionClassificationOutput {
  objection_id: string | null;
  severity: ObjectionSeverity;
  recommended_playbook_id: string | null;
  human_required: boolean;
  loss_risk: LossRisk;
  matched_triggers: string[];
}

export const DEFAULT_OBJECTION_RULES: ObjectionRule[] = [
  {
    id: "price_expensive",
    severity_default: "medium",
    triggers: ["mahal", "kemahalan", "kok segitu", "harga tinggi", "berat juga"],
    human_required: false,
    recommended_playbook_id: "price_value_frame",
    loss_risk: "medium",
  },
  {
    id: "discount_request",
    severity_default: "medium",
    triggers: ["bisa kurang", "kurangin", "nego", "diskon", "harga net", "potongan"],
    human_required: false,
    recommended_playbook_id: "fixed_price_policy",
    loss_risk: "medium",
  },
  {
    id: "need_to_think",
    severity_default: "low",
    triggers: ["nanti dulu", "pikir dulu", "dipikir", "kabari lagi", "saya cek dulu"],
    human_required: false,
    recommended_playbook_id: "low_pressure_followup",
    loss_risk: "medium",
  },
  {
    id: "timing_busy",
    severity_default: "low",
    triggers: ["belum sempat", "lagi sibuk", "minggu depan aja", "hari lain", "jadwal padat"],
    human_required: false,
    recommended_playbook_id: "easy_reschedule",
    loss_risk: "low",
  },
  {
    id: "coverage_uncertain",
    severity_default: "medium",
    triggers: ["jauh", "kejauhan", "bisa ke rumah", "cover ga", "masuk area", "luar kota"],
    human_required: false,
    recommended_playbook_id: "resolve_area_truthfully",
    loss_risk: "medium",
  },
  {
    id: "compare_first",
    severity_default: "medium",
    triggers: ["bandingin", "tempat lain", "bengkel lain", "kompetitor", "yang lain", "lebih murah di"],
    human_required: false,
    recommended_playbook_id: "factual_comparison",
    loss_risk: "medium",
  },
  {
    id: "trust_quality",
    severity_default: "medium",
    triggers: [
      "yakin",
      "beneran",
      "takut",
      "before after",
      "hasilnya",
      "aman ga",
      "garansi",
      "hilang total",
      "bisa hilang",
      "awet",
      "jamin",
    ],
    human_required: false,
    recommended_playbook_id: "approved_proof_process",
    loss_risk: "medium",
  },
  {
    id: "complaint_after_sales",
    severity_default: "high",
    triggers: ["komplain", "hasil kurang", "belum bening", "rusak", "refund", "balikin uang", "kecewa"],
    human_required: true,
    recommended_playbook_id: "human_complaint_handoff",
    loss_risk: "high",
  },
];

const SIGNAL_OBJECTION_MAP: Record<string, string> = {
  customer_asked_price_again: "price_expensive",
  customer_mentioned_competitor: "compare_first",
  customer_mentioned_discount: "discount_request",
  customer_expressed_distrust: "trust_quality",
  customer_wants_human: "complaint_after_sales",
};

export function classifyObjection(
  input: ObjectionClassificationInput,
): ObjectionClassificationOutput {
  const text = normalize(input.text);
  const signals = input.signals || [];
  const rules = input.catalog?.length ? input.catalog : DEFAULT_OBJECTION_RULES;

  const signalMatch = signals
    .map((signal) => SIGNAL_OBJECTION_MAP[signal])
    .find(Boolean);
  const matchedBySignal = signalMatch
    ? rules.find((rule) => rule.id === signalMatch)
    : null;

  const matched = matchedBySignal || rules
    .map((rule) => ({
      rule,
      triggers: rule.triggers.filter((trigger) => includesPhrase(text, trigger)),
    }))
    .filter((item) => item.triggers.length > 0)
    .sort((a, b) => scoreRule(b.rule, b.triggers) - scoreRule(a.rule, a.triggers))[0];

  if (!matched) {
    return {
      objection_id: null,
      severity: "low",
      recommended_playbook_id: null,
      human_required: false,
      loss_risk: "low",
      matched_triggers: [],
    };
  }

  const rule = "rule" in matched ? matched.rule : matched;
  const matchedTriggers = matchedBySignal
    ? [`signal:${signalMatch}`]
    : "rule" in matched
    ? matched.triggers
    : [];
  const severity = escalateSeverity(
    rule.severity_default,
    input.customer_repeat_count || 0,
    text,
  );

  return {
    objection_id: rule.id,
    severity,
    recommended_playbook_id: rule.recommended_playbook_id,
    human_required: rule.human_required || severity === "high" && rule.id === "trust_quality",
    loss_risk: severity === "high" ? "high" : rule.loss_risk,
    matched_triggers: matchedTriggers,
  };
}

function scoreRule(rule: ObjectionRule, triggers: string[]): number {
  const severityScore = rule.severity_default === "high"
    ? 30
    : rule.severity_default === "medium"
    ? 20
    : 10;
  return severityScore + triggers.length * 5 + (rule.human_required ? 10 : 0);
}

function escalateSeverity(
  base: ObjectionSeverity,
  repeatCount: number,
  text: string,
): ObjectionSeverity {
  if (/\b(tidak jadi|ga jadi|nggak jadi|cancel|batal|mahal banget|terlalu mahal)\b/i.test(text)) {
    return "high";
  }
  if (repeatCount >= 2 && base === "low") return "medium";
  if (repeatCount >= 2 && base === "medium") return "high";
  return base;
}

function includesPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(text);
}

function normalize(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}
