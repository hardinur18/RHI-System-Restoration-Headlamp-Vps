// Deterministic address sufficiency validator for Polesheadlamp.id
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §30 task 9

export interface AddressSufficiencyInput {
  address_text?: string | null;
  maps_url?: string | null;
  area_text?: string | null;
}

export interface AddressSufficiencyOutput {
  sufficient: boolean;
  confidence: "high" | "medium" | "low";
  missing_fields: string[];
  normalized_address: string | null;
  suggested_customer_text: string;
}

const MAPS_URL_RE =
  /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|www\.google\.com\/maps|maps\.google\.com)\S*/i;
const STREET_HINT_RE =
  /\b(jl|jalan|gg|gang|komplek|kompleks|cluster|blok|perum|perumahan|apartemen|apt|ruko|kp|kampung)\b/i;
const NUMBER_HINT_RE = /\b(no|nomor|rt|rw|blok)\b\s*[a-z0-9/-]+|\b\d{1,4}\b/i;
const LANDMARK_HINT_RE =
  /\b(dekat|samping|sebelah|patokan|depan|belakang|seberang|mall|masjid|gereja|spbu|indomaret|alfamart|sekolah|pasar)\b/i;
const AREA_ONLY_RE =
  /^(jakarta|depok|bekasi|bogor|tangerang|cikarang|cibubur|sawangan|pasar minggu|bandung|karawang|serang|cilegon)(\s+[a-z]+){0,2}$/i;

export function validateAddressSufficiency(
  input: AddressSufficiencyInput,
): AddressSufficiencyOutput {
  const address = normalize(input.address_text ?? "");
  const mapsUrl = extractMapsUrl(input.maps_url ?? input.address_text ?? "");

  if (mapsUrl) {
    return {
      sufficient: true,
      confidence: address.length >= 10 ? "high" : "medium",
      missing_fields: [],
      normalized_address: address || mapsUrl,
      suggested_customer_text: "Alamat dan titik maps sudah cukup kak.",
    };
  }

  if (!address || address.length < 8 || AREA_ONLY_RE.test(address)) {
    return missing(
      ["street_or_cluster", "house_number_or_landmark"],
      address || null,
    );
  }

  const hasStreet = STREET_HINT_RE.test(address);
  const hasNumber = NUMBER_HINT_RE.test(address);
  const hasLandmark = LANDMARK_HINT_RE.test(address);

  const missingFields: string[] = [];
  if (!hasStreet) missingFields.push("street_or_cluster");
  if (!hasNumber && !hasLandmark) {
    missingFields.push("house_number_or_landmark");
  }

  if (missingFields.length > 0) {
    return missing(missingFields, address);
  }

  return {
    sufficient: true,
    confidence: hasStreet && hasNumber && hasLandmark ? "high" : "medium",
    missing_fields: [],
    normalized_address: address,
    suggested_customer_text: "Alamatnya sudah cukup kak.",
  };
}

function missing(
  fields: string[],
  normalizedAddress: string | null,
): AddressSufficiencyOutput {
  return {
    sufficient: false,
    confidence: "low",
    missing_fields: fields,
    normalized_address: normalizedAddress,
    suggested_customer_text:
      "Alamat lengkapnya boleh kak? Minimal nama jalan/cluster, nomor rumah atau patokan terdekat.",
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractMapsUrl(text: string): string | null {
  return MAPS_URL_RE.exec(text)?.[0] ?? null;
}
