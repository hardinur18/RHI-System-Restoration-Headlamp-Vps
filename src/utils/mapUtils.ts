import { publicAnonKey } from '/utils/supabase/info';
import { supabase } from '@/lib/supabaseClient';
import { buildMakeServerUrl, makeServerFunctionsBaseUrl } from '@/app/services/internal/functionsBaseUrl';

export const isValidMapCoordinate = (lat?: number | null, lng?: number | null) => {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  return Number.isFinite(numericLat) &&
    Number.isFinite(numericLng) &&
    Math.abs(numericLat) <= 90 &&
    Math.abs(numericLng) <= 180 &&
    !(numericLat === 0 && numericLng === 0);
};

const toCoordinateResult = (latValue?: string, lngValue?: string) => {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return isValidMapCoordinate(lat, lng) ? { lat, lng } : null;
};

export const getCoordinatesFromUrl = (url?: string | null) => {
  if (!url) return null;

  const source = (() => {
    const trimmed = url.trim().replace(/[.,;]+$/, '');
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  })();

  const coord = '(-?\\d+(?:\\.\\d+)?)';
  
  // 1. Format umum: @lat,lng
  // Contoh: google.com/maps/.../@-6.123,106.123,15z
  const atMatch = source.match(new RegExp(`@${coord},${coord}`));
  if (atMatch) {
    const parsed = toCoordinateResult(atMatch[1], atMatch[2]);
    if (parsed) return parsed;
  }
  
  // 2. Format Query: q=lat,lng
  // Contoh: maps.google.com/?q=-6.123,106.123
  const qMatch = source.match(new RegExp(`[?&]q=${coord},${coord}`));
  if (qMatch) {
    const parsed = toCoordinateResult(qMatch[1], qMatch[2]);
    if (parsed) return parsed;
  }

  // 3. Format Protobuf (Hidden Data): !3d...!4d
  // Sering muncul di link "Share Place" jika format @ tidak ada
  // Contoh: .../data=!3m1!4b1!4m6!3m5!1s0x...!8m2!3d-6.12345!4d106.12345
  const dataMatch = source.match(new RegExp(`!3d${coord}!4d${coord}`));
  if (dataMatch) {
    const parsed = toCoordinateResult(dataMatch[1], dataMatch[2]);
    if (parsed) return parsed;
  }

  // 4. Format Search Query: query=lat,lng
  const queryMatch = source.match(new RegExp(`[?&]query=${coord},${coord}`));
  if (queryMatch) {
    const parsed = toCoordinateResult(queryMatch[1], queryMatch[2]);
    if (parsed) return parsed;
  }

  // 5. Format LL (LatLong): ll=lat,lng
  const llMatch = source.match(new RegExp(`[?&]ll=${coord},${coord}`));
  if (llMatch) {
    const parsed = toCoordinateResult(llMatch[1], llMatch[2]);
    if (parsed) return parsed;
  }

  // 6. Format Directions/Embed: destination=lat,lng atau center=lat,lng
  const targetMatch = source.match(new RegExp(`[?&](?:destination|center)=${coord},${coord}`));
  if (targetMatch) {
    const parsed = toCoordinateResult(targetMatch[1], targetMatch[2]);
    if (parsed) return parsed;
  }

  // 7. Format Place Path (Nama Tempat): /place/Nama+Tempat/@lat,lng
  // Ini paling sering terjadi di redirect mobile
  if (source.includes('/place/')) {
       // Cek apakah ada koordinat setelah @ (prioritas utama)
       const atInPlace = source.match(new RegExp(`/place/[^/]+/@${coord},${coord}`));
       if (atInPlace) {
           const parsed = toCoordinateResult(atInPlace[1], atInPlace[2]);
           if (parsed) return parsed;
       }
       
       // Cek format /place/lat,lng (jarang, tapi ada)
       const plainPlace = source.match(new RegExp(`/place/${coord},${coord}`));
       if (plainPlace) {
           const parsed = toCoordinateResult(plainPlace[1], plainPlace[2]);
           if (parsed) return parsed;
       }
  }

  // 8. Format Directions: saddr=lat,lng or daddr=lat,lng
  const addrMatch = source.match(new RegExp(`[?&][sd]addr=${coord},${coord}`));
  if (addrMatch) {
      const parsed = toCoordinateResult(addrMatch[1], addrMatch[2]);
      if (parsed) return parsed;
  }

  // 9. Format Search: /search/lat,lng
  const searchMatch = source.match(new RegExp(`/search/${coord},${coord}`));
  if (searchMatch) {
      const parsed = toCoordinateResult(searchMatch[1], searchMatch[2]);
      if (parsed) return parsed;
  }

  // 10. Raw coordinate pair, useful for pasted values.
  const rawPairMatch = source.match(new RegExp(`^\\s*${coord}\\s*,\\s*${coord}\\s*$`));
  if (rawPairMatch) {
      const parsed = toCoordinateResult(rawPairMatch[1], rawPairMatch[2]);
      if (parsed) return parsed;
  }
  
  // 11. Last Resort: Coba cari pola angka float berurutan di mana saja di URL (sangat loose)
  // Hanya gunakan jika url mengandung google maps
  if (source.includes('google') && source.includes('maps')) {
      // Cari pola !3d-6.123!4d106.123
      const protoMatch = source.match(new RegExp(`!3d${coord}!4d${coord}`));
      if (protoMatch) {
        const parsed = toCoordinateResult(protoMatch[1], protoMatch[2]);
        if (parsed) return parsed;
      }
  }

  return null;
};

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
