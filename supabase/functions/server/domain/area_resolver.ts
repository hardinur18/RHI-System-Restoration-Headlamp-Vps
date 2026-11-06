// Deterministic area resolver for Polesheadlamp.id
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §6.1

export type AreaTier = "core_full" | "workshop_plus_mobile" | "conditional";
export type CoverageStatus =
  | "in_coverage"
  | "conditional"
  | "out_of_coverage"
  | "needs_clarification";

export interface AreaDefinition {
  id: string;
  canonicalName: string;
  tier: AreaTier;
  branchId: string;
  aliases: string[];
  exclusions: string[];
}

export interface ResolveAreaOutput {
  status: CoverageStatus;
  area_id: string | null;
  canonical_name: string | null;
  tier: AreaTier | null;
  branch_id: string | null;
  matched_alias: string | null;
  excluded_by: string | null;
  confidence: "high" | "medium" | "low";
  customer_facing_summary: string;
  suggested_customer_text: string;
}

export const AREAS: AreaDefinition[] = [
  {
    id: "area_jakarta",
    canonicalName: "Jakarta",
    tier: "core_full",
    branchId: "branch_home_service_jabodetabek",
    aliases: [
      "jakarta",
      "jkt",
      "jaksel",
      "jaktim",
      "jakbar",
      "jakut",
      "jakpus",
      "jakarta selatan",
      "jakarta timur",
      "jakarta barat",
      "jakarta utara",
      "jakarta pusat",
    ],
    exclusions: [],
  },
  {
    id: "area_depok",
    canonicalName: "Depok",
    tier: "core_full",
    branchId: "branch_home_service_jabodetabek",
    aliases: [
      "depok",
      "dpk",
      "sawangan",
      "cinere",
      "beji",
      "cimanggis",
      "cibubur depok",
    ],
    exclusions: [],
  },
  {
    id: "area_bekasi",
    canonicalName: "Bekasi",
    tier: "core_full",
    branchId: "branch_home_service_jabodetabek",
    aliases: [
      "bekasi",
      "bks",
      "bekasi kota",
      "bekasi timur",
      "bekasi barat",
      "cikarang",
      "cibitung",
      "tambun",
    ],
    exclusions: [],
  },
  {
    id: "area_bogor",
    canonicalName: "Bogor",
    tier: "workshop_plus_mobile",
    branchId: "branch_bogor_workshop",
    aliases: [
      "bogor",
      "bgr",
      "cibinong",
      "cijeruk",
      "bogor selatan",
      "sentul",
      "dramaga",
      "ciomas",
    ],
    exclusions: ["rumpin", "cibadak", "jonggol", "cileungsi"],
  },
  {
    id: "area_tangerang",
    canonicalName: "Tangerang",
    tier: "conditional",
    branchId: "branch_home_service_jabodetabek",
    aliases: [
      "tangerang",
      "tng",
      "tangsel",
      "tangerang selatan",
      "bsd",
      "serpong",
      "bintaro",
      "ciputat",
      "karawaci",
    ],
    exclusions: ["pik 2", "pik2", "tenjo", "luar balaraja"],
  },
  {
    id: "area_karawang",
    canonicalName: "Karawang",
    tier: "conditional",
    branchId: "branch_home_service_jabodetabek",
    aliases: ["karawang"],
    exclusions: [],
  },
  {
    id: "area_bandung",
    canonicalName: "Bandung",
    tier: "conditional",
    branchId: "branch_home_service_jabodetabek",
    aliases: ["bandung", "bdg", "bojongsoang", "buahbatu", "cileunyi", "cimahi", "soreang", "dayeuhkolot"],
    exclusions: [],
  },
  {
    id: "area_serang",
    canonicalName: "Serang",
    tier: "conditional",
    branchId: "branch_home_service_jabodetabek",
    aliases: ["serang"],
    exclusions: [],
  },
  {
    id: "area_cilegon",
    canonicalName: "Cilegon",
    tier: "conditional",
    branchId: "branch_home_service_jabodetabek",
    aliases: ["cilegon"],
    exclusions: [],
  },
];

const UNKNOWN_AREA_TEXT =
  "Boleh info kecamatan atau area detailnya kak? Nanti saya bantu cek coveragenya.";
const OUT_OF_COVERAGE_AREAS = ["subang"] as const;

export function normalizeAreaText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveAreaAlias(rawArea: string): ResolveAreaOutput {
  const text = normalizeAreaText(rawArea);
  if (!text || text.length < 3) {
    return needsClarification();
  }

  const explicitOutOfCoverage = OUT_OF_COVERAGE_AREAS.find((area) =>
    containsPhrase(text, area)
  );
  if (explicitOutOfCoverage) {
    return {
      status: "out_of_coverage",
      area_id: null,
      canonical_name: titleCase(explicitOutOfCoverage),
      tier: null,
      branch_id: null,
      matched_alias: explicitOutOfCoverage,
      excluded_by: explicitOutOfCoverage,
      confidence: "high",
      customer_facing_summary: `${titleCase(explicitOutOfCoverage)} belum masuk area layanan.`,
      suggested_customer_text: `Untuk area ${titleCase(explicitOutOfCoverage)}, sementara belum bisa kami cover ya kak. Kalau kakak bisa pengerjaan di area Bandung yang masuk jangkauan, boleh info titik/kecamatannya di Bandung nanti saya cekkan.`,
    };
  }

  for (const area of AREAS) {
    const excludedBy = area.exclusions.find((exclusion) =>
      containsPhrase(text, exclusion)
    );
    if (excludedBy) {
      return {
        status: "out_of_coverage",
        area_id: area.id,
        canonical_name: area.canonicalName,
        tier: area.tier,
        branch_id: area.branchId,
        matched_alias: null,
        excluded_by: excludedBy,
        confidence: "high",
        customer_facing_summary: `${
          titleCase(excludedBy)
        } termasuk pengecualian area ${area.canonicalName}.`,
        suggested_customer_text: `Untuk area ${
          titleCase(excludedBy)
        }, sementara belum bisa kami cover ya kak. Kalau ada alamat alternatif yang lebih dekat, boleh info saya cekkan.`,
      };
    }
  }

  const matches = AREAS.flatMap((area) =>
    area.aliases
      .filter((alias) => containsPhrase(text, alias))
      .map((alias) => ({ area, alias }))
  ).sort((a, b) => b.alias.length - a.alias.length);

  if (matches.length === 0) {
    return needsClarification();
  }

  const { area, alias } = matches[0];
  const status: CoverageStatus = area.tier === "conditional"
    ? "conditional"
    : "in_coverage";
  return {
    status,
    area_id: area.id,
    canonical_name: area.canonicalName,
    tier: area.tier,
    branch_id: area.branchId,
    matched_alias: alias,
    excluded_by: null,
    confidence: alias === area.canonicalName.toLowerCase() ? "high" : "medium",
    customer_facing_summary: status === "conditional"
      ? `${area.canonicalName} bisa dicek dulu mengikuti rute dan ketersediaan teknisi.`
      : `${area.canonicalName} masuk area layanan.`,
    suggested_customer_text: status === "conditional"
      ? `Untuk ${area.canonicalName}, saya cekkan dulu rute teknisinya ya kak. Boleh info kecamatan/detail alamatnya?`
      : `Untuk ${area.canonicalName}, kami bisa bantu home service ya kak. Boleh info merk/model mobilnya? Kalau belum hafal tipe lengkap, nama mobilnya saja cukup.`,
  };
}

function needsClarification(): ResolveAreaOutput {
  return {
    status: "needs_clarification",
    area_id: null,
    canonical_name: null,
    tier: null,
    branch_id: null,
    matched_alias: null,
    excluded_by: null,
    confidence: "low",
    customer_facing_summary: "Area belum cukup jelas.",
    suggested_customer_text: UNKNOWN_AREA_TEXT,
  };
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(
    /\s+/g,
    "\\s+",
  );
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(text);
}

function titleCase(text: string): string {
  return text.split(" ").filter(Boolean).map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ");
}
