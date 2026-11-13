import { publicAnonKey } from '/utils/supabase/info';
import { supabase } from '@/lib/supabaseClient';
import { buildMakeServerUrl, makeServerFunctionsBaseUrl } from '@/app/services/internal/functionsBaseUrl';
import { extractMapCoordinates, isValidMapCoordinate, type MapCoordinate } from './mapCoordinates';

export { isValidMapCoordinate };
export const getCoordinatesFromUrl = extractMapCoordinates;

export const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
};

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export const expandShortUrl = async (url: string) => {
    // Gunakan server-side proxy untuk menghindari CORS dan mendapatkan lokasi redirect
    if (!makeServerFunctionsBaseUrl || !publicAnonKey) return url;

    try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        if (!accessToken) return url;

        const response = await fetch(buildMakeServerUrl('/expand-url'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'x-client-token': accessToken
            },
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            // console.warn("Failed to expand URL via server, returning original.");
            return url;
        }

        const payload = await response.json();
        return payload.expandedUrl || url;
    } catch (e) {
        // Silent fail for network errors to avoid console noise
        // console.warn("Error expanding URL:", e);
        return url;
    }
}

const coordinateResolutionCache = new Map<string, Promise<MapCoordinate | null>>();

export const resolveCoordinatesFromMapsUrl = async (url?: string | null): Promise<MapCoordinate | null> => {
    const normalizedUrl = url?.trim();
    if (!normalizedUrl) return null;

    const directCoordinate = getCoordinatesFromUrl(normalizedUrl);
    if (directCoordinate) return directCoordinate;
    if (!/^https?:\/\//i.test(normalizedUrl)) return null;

    const cachedResolution = coordinateResolutionCache.get(normalizedUrl);
    if (cachedResolution) return cachedResolution;

    const pendingResolution = (async () => {
        const expandedUrl = await expandShortUrl(normalizedUrl);
        return getCoordinatesFromUrl(expandedUrl);
    })();
    coordinateResolutionCache.set(normalizedUrl, pendingResolution);

    if (coordinateResolutionCache.size > 500) {
        const oldestKey = coordinateResolutionCache.keys().next().value;
        if (oldestKey) coordinateResolutionCache.delete(oldestKey);
    }

    const coordinate = await pendingResolution;
    if (!coordinate) coordinateResolutionCache.delete(normalizedUrl);
    return coordinate;
};
