import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Order } from '@/app/pages/master-data/data';
import { getCoordinatesFromUrl, resolveCoordinatesFromMapsUrl } from '@/utils/mapUtils';
import { selectVerifiedMapCoordinate, type MapCoordinate } from '@/utils/mapCoordinates';

interface MapCoordinateResolution {
  url: string;
  status: 'resolving' | 'resolved' | 'failed';
  coordinate: MapCoordinate | null;
}

export const useVerifiedOrderMapCoordinates = (orders: Order[]) => {
  const [resolutions, setResolutions] = useState<Record<string, MapCoordinateResolution>>({});
  const attemptedResolution = useRef<Set<string>>(new Set());
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const resolveUnverifiedCoordinates = async () => {
      const ordersToResolve = orders.filter((order) => (
        order.mapsUrl &&
        !getCoordinatesFromUrl(order.mapsUrl) &&
        !attemptedResolution.current.has(`${order.id}:${order.mapsUrl.trim()}`)
      ));
      if (ordersToResolve.length === 0) return;

      ordersToResolve.forEach((order) => {
        attemptedResolution.current.add(`${order.id}:${order.mapsUrl!.trim()}`);
      });
      if (isMounted.current) {
        setResolutions((current) => {
          const next = { ...current };
          ordersToResolve.forEach((order) => {
            const url = order.mapsUrl!.trim();
            next[order.id] = { url, status: 'resolving', coordinate: null };
          });
          return next;
        });
      }

      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, ordersToResolve.length) }, async () => {
        while (cursor < ordersToResolve.length) {
          const order = ordersToResolve[cursor++];
          const originalUrl = order.mapsUrl!.trim();
          let coordinate: MapCoordinate | null = null;

          try {
            coordinate = await resolveCoordinatesFromMapsUrl(originalUrl);
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn('[Order Maps] Failed to verify order coordinates', order.id, error);
            }
          }

          if (!isMounted.current) continue;
          setResolutions((current) => ({
            ...current,
            [order.id]: {
              url: originalUrl,
              status: coordinate ? 'resolved' : 'failed',
              coordinate,
            },
          }));
        }
      });

      await Promise.all(workers);
    };

    void resolveUnverifiedCoordinates();
  }, [orders]);

  const resolveOrderCoordinate = useCallback((order: Order) => {
    const resolution = resolutions[order.id];
    return selectVerifiedMapCoordinate({
      mapsUrl: order.mapsUrl,
      storedLat: order.lat,
      storedLng: order.lng,
      resolvedUrl: resolution?.status === 'resolved' ? resolution.url : null,
      resolvedCoordinate: resolution?.status === 'resolved' ? resolution.coordinate : null,
    });
  }, [resolutions]);

  const unresolvedOrders = useMemo(
    () => orders.filter((order) => !resolveOrderCoordinate(order)),
    [orders, resolveOrderCoordinate],
  );
  const resolvingCount = useMemo(
    () => unresolvedOrders.filter((order) => {
      const mapsUrl = order.mapsUrl?.trim();
      const resolution = resolutions[order.id];
      return Boolean(mapsUrl && resolution?.url === mapsUrl && resolution.status === 'resolving');
    }).length,
    [resolutions, unresolvedOrders],
  );

  return {
    resolveOrderCoordinate,
    unresolvedOrders,
    resolvingCount,
  };
};
