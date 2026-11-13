export interface MapCoordinate {
  lat: number;
  lng: number;
}

export const isValidMapCoordinate = (lat?: number | null, lng?: number | null) => {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  return Number.isFinite(numericLat) &&
    Number.isFinite(numericLng) &&
    Math.abs(numericLat) <= 90 &&
    Math.abs(numericLng) <= 180 &&
    !(numericLat === 0 && numericLng === 0);
};

const toCoordinateResult = (latValue?: string, lngValue?: string): MapCoordinate | null => {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return isValidMapCoordinate(lat, lng) ? { lat, lng } : null;
};

const decodeMapSource = (value: string) => {
  const normalized = value.trim().replace(/[.,;]+$/, '').replace(/&amp;/g, '&');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
};

/**
 * Extract the destination pin from a Google Maps URL or response body.
 * Exact place-pin formats intentionally take priority over viewport formats
 * such as `@lat,lng` and `center=lat,lng`.
 */
export const extractMapCoordinates = (value?: string | null): MapCoordinate | null => {
  if (!value) return null;

  const source = decodeMapSource(value);
  const coordinate = '(-?\\d+(?:\\.\\d+)?)';

  // Google place pin: latitude then longitude.
  const placePinMatch = source.match(new RegExp(`!3d${coordinate}!4d${coordinate}`));
  if (placePinMatch) {
    const parsed = toCoordinateResult(placePinMatch[1], placePinMatch[2]);
    if (parsed) return parsed;
  }

  // Older Google protobuf format: longitude then latitude.
  const legacyPlacePinMatch = source.match(new RegExp(`!2d${coordinate}!3d${coordinate}`));
  if (legacyPlacePinMatch) {
    const parsed = toCoordinateResult(legacyPlacePinMatch[2], legacyPlacePinMatch[1]);
    if (parsed) return parsed;
  }

  const targetQueryMatch = source.match(
    new RegExp(`[?&](?:q|query|destination|daddr)=${coordinate}(?:,|%2C)${coordinate}`),
  );
  if (targetQueryMatch) {
    const parsed = toCoordinateResult(targetQueryMatch[1], targetQueryMatch[2]);
    if (parsed) return parsed;
  }

  const placePathMatch = source.match(new RegExp(`/place/${coordinate}(?:,|%2C)${coordinate}`));
  if (placePathMatch) {
    const parsed = toCoordinateResult(placePathMatch[1], placePathMatch[2]);
    if (parsed) return parsed;
  }

  const searchPathMatch = source.match(new RegExp(`/search/${coordinate}(?:,|%2C)${coordinate}`));
  if (searchPathMatch) {
    const parsed = toCoordinateResult(searchPathMatch[1], searchPathMatch[2]);
    if (parsed) return parsed;
  }

  const rawPairMatch = source.match(new RegExp(`^\\s*${coordinate}\\s*,\\s*${coordinate}\\s*$`));
  if (rawPairMatch) {
    const parsed = toCoordinateResult(rawPairMatch[1], rawPairMatch[2]);
    if (parsed) return parsed;
  }

  // Viewport coordinates are a fallback only: they can differ from the pin.
  const viewportMatch = source.match(new RegExp(`@${coordinate}(?:,|%2C)${coordinate}`));
  if (viewportMatch) {
    const parsed = toCoordinateResult(viewportMatch[1], viewportMatch[2]);
    if (parsed) return parsed;
  }

  const fallbackQueryMatch = source.match(
    new RegExp(`[?&](?:ll|saddr|center)=${coordinate}(?:,|%2C)${coordinate}`),
  );
  if (fallbackQueryMatch) {
    const parsed = toCoordinateResult(fallbackQueryMatch[1], fallbackQueryMatch[2]);
    if (parsed) return parsed;
  }

  return null;
};

export const toGoogleMapsCoordinateUrl = (value?: string | null) => {
  const coordinate = extractMapCoordinates(value);
  if (!coordinate) return null;
  return `https://www.google.com/maps/search/?api=1&query=${coordinate.lat},${coordinate.lng}`;
};

export const selectVerifiedMapCoordinate = ({
  mapsUrl,
  storedLat,
  storedLng,
  resolvedUrl,
  resolvedCoordinate,
}: {
  mapsUrl?: string | null;
  storedLat?: number | null;
  storedLng?: number | null;
  resolvedUrl?: string | null;
  resolvedCoordinate?: MapCoordinate | null;
}): MapCoordinate | null => {
  const normalizedMapsUrl = mapsUrl?.trim();
  if (normalizedMapsUrl) {
    const directCoordinate = extractMapCoordinates(normalizedMapsUrl);
    if (directCoordinate) return directCoordinate;

    if (
      resolvedUrl?.trim() === normalizedMapsUrl &&
      resolvedCoordinate &&
      isValidMapCoordinate(resolvedCoordinate.lat, resolvedCoordinate.lng)
    ) {
      return resolvedCoordinate;
    }

    // A Maps link takes ownership of the location. Its stale stored coordinate
    // must not be rendered until the link itself has been resolved.
    return null;
  }

  return isValidMapCoordinate(storedLat, storedLng)
    ? { lat: Number(storedLat), lng: Number(storedLng) }
    : null;
};
