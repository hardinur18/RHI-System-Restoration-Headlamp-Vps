import { extractMapCoordinates, isValidMapCoordinate } from '../src/utils/mapCoordinates.ts';

const input = await new Promise((resolve, reject) => {
  let value = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { value += chunk; });
  process.stdin.on('end', () => resolve(value));
  process.stdin.on('error', reject);
});

const rows = String(input)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [id, serviceDate, latValue, lngValue, ...urlParts] = line.split('|');
    return {
      id,
      serviceDate,
      stored: isValidMapCoordinate(Number(latValue), Number(lngValue))
        ? { lat: Number(latValue), lng: Number(lngValue) }
        : null,
      mapsUrl: urlParts.join('|').trim(),
    };
  });

const distanceKm = (left, right) => {
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(right.lat - left.lat);
  const deltaLng = toRadians(right.lng - left.lng);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(left.lat)) * Math.cos(toRadians(right.lat)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const resolveMapsCoordinate = async (mapsUrl) => {
  const direct = extractMapCoordinates(mapsUrl);
  if (direct) return direct;

  const response = await fetch(mapsUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 RHI location audit' },
  });
  const fromFinalUrl = extractMapCoordinates(response.url);
  if (fromFinalUrl) return fromFinalUrl;
  return extractMapCoordinates(await response.text());
};

const results = new Array(rows.length);
let cursor = 0;
const requestedConcurrency = Number(process.env.MAP_AUDIT_CONCURRENCY || 6);
const concurrency = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(16, Math.floor(requestedConcurrency)))
  : 6;
const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
  while (cursor < rows.length) {
    const index = cursor++;
    const row = rows[index];
    try {
      const resolved = await resolveMapsCoordinate(row.mapsUrl);
      results[index] = {
        id: row.id,
        serviceDate: row.serviceDate,
        stored: row.stored,
        resolved,
        differenceKm: row.stored && resolved ? distanceKm(row.stored, resolved) : null,
        error: resolved ? null : 'coordinate_not_found',
      };
    } catch (error) {
      results[index] = {
        id: row.id,
        serviceDate: row.serviceDate,
        stored: row.stored,
        resolved: null,
        differenceKm: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
});

await Promise.all(workers);

const mismatchThresholdKm = 0.3;
const mismatches = results.filter((result) => Number(result.differenceKm) > mismatchThresholdKm);
const unresolved = results.filter((result) => !result.resolved);
const missingStored = results.filter((result) => !result.stored);
const matched = results.filter((result) => (
  result.stored &&
  result.resolved &&
  result.differenceKm !== null &&
  result.differenceKm <= mismatchThresholdKm
));

console.log(JSON.stringify({
  audited: results.length,
  matchedWithin300m: matched.length,
  mismatchesOver300m: mismatches.map((result) => ({
    id: result.id,
    serviceDate: result.serviceDate,
    differenceKm: Number(result.differenceKm.toFixed(3)),
    stored: result.stored,
    resolved: result.resolved,
  })),
  missingStoredCoordinates: missingStored.map((result) => result.id),
  unresolvedLinks: unresolved.map((result) => ({ id: result.id, error: result.error })),
}, null, 2));
