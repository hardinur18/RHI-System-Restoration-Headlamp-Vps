import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';

import type { OrderDateRequest } from '../../master-data/context/internal/masterDataRangeUtils';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function useOrderDateLoading(
  range: DateRange | undefined,
  mode: 'service' | 'lead',
  load: (request: OrderDateRequest) => Promise<void>,
  ready = true,
  technicianId?: string,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const from = range?.from ? dateKey(range.from) : undefined;
  const to = range?.from ? dateKey(range.to || range.from) : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Initial load and explicit refresh must finish before requesting history.
    if (!ready) return () => { cancelled = true; };
    // No bounds means all history, including orders without a schedule date.
    void load({ from, to, mode, ...(technicianId ? { technicianId } : {}) })
      .catch(() => {
        if (!cancelled) setError('Pesanan belum berhasil dimuat seluruhnya. Coba muat ulang.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [from, to, mode, load, retryVersion, ready, technicianId]);

  return { loading, error, retry: () => setRetryVersion(value => value + 1) };
}
