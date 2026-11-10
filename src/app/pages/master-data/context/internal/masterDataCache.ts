export const APP_DATA_FETCH_TIMEOUT_MS = 8_000;
export const DIRECT_APP_DATA_FETCH_TIMEOUT_MS = 6_000;
export const MASTER_BOOTSTRAP_CONCURRENCY = 2;
export const OPERATIONAL_BOOTSTRAP_CONCURRENCY = 1;

const MASTER_DATA_CACHE_PREFIX = 'rhi-v2-master-data-cache';
const MASTER_DATA_CACHE_MAX_BYTES = 900_000;

export const CACHEABLE_MASTER_TABLES = new Set([
  'profiles',
  'branches',
  'areas',
  'services',
  'vehicle_types',
  'ad_platforms',
  'ad_sub_channels',
  'ad_accounts',
  'ad_account_assignments',
  'ad_account_owner_assignments',
  'ad_sources',
  'payment_methods',
  'roles',
  'wa_templates',
  'prospect_labels',
]);

export const CACHEABLE_RANGE_TABLES = new Set([
  'orders',
  'leads',
  'daily_ads',
  'lead_spam_daily_inputs',
  'prospect_bookings',
  'technician_schedules',
]);

const buildCacheKey = (table: string, suffix = 'full') =>
  `${MASTER_DATA_CACHE_PREFIX}:${table}:${suffix}`;

export const runSettledWithConcurrency = async (
  tasks: Array<() => Promise<unknown>>,
  concurrency: number,
  signal?: AbortSignal,
) => {
  const limit = Math.max(1, Math.min(concurrency, tasks.length || 1));
  let cursor = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (cursor < tasks.length && !signal?.aborted) {
      const index = cursor;
      cursor += 1;

      try {
        await tasks[index]();
      } catch {
        // Keep batch behavior equivalent to Promise.allSettled.
      }
    }
  });

  await Promise.all(workers);
};

export const safeReadCachedRows = (table: string, suffix = 'full') => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(buildCacheKey(table, suffix));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
};

export const safeWriteCachedRows = (table: string, rows: any[], suffix = 'full') => {
  if (typeof window === 'undefined' || rows.length === 0) return;

  try {
    const payload = JSON.stringify({
      cachedAt: new Date().toISOString(),
      rows,
    });
    if (payload.length > MASTER_DATA_CACHE_MAX_BYTES) return;
    window.localStorage.setItem(buildCacheKey(table, suffix), payload);
  } catch {
    // Cache is best-effort only.
  }
};

export const isLikelySupabaseOutage = (status?: number, error?: unknown) => {
  if (typeof status === 'number') {
    return status === 502 || status === 503 || status === 504 || status === 522 || status === 524;
  }

  if (!error) return false;

  const message = error instanceof Error ? error.message : String(error);
  return /timeout|terlalu lama|failed to fetch|network|load failed|gateway|connection|server data sedang lambat/i.test(message);
};

export const buildRangeCacheSuffix = (options: {
  orderBy?: string;
  ascending?: boolean;
  eq?: Record<string, string>;
  gte?: Record<string, string>;
  lte?: Record<string, string>;
}) =>
  `range:${JSON.stringify({
    orderBy: options.orderBy || '',
    ascending: options.ascending ?? true,
    eq: options.eq || {},
    gte: options.gte || {},
    lte: options.lte || {},
  })}`;

export const readCachedAppDataPageRows = (
  table: string,
  from: number,
  to: number,
  options: {
    orderBy?: string;
    ascending?: boolean;
    eq?: Record<string, string>;
    gte?: Record<string, string>;
    lte?: Record<string, string>;
  } = {},
) => {
  const fullRows = CACHEABLE_MASTER_TABLES.has(table)
    ? safeReadCachedRows(table)
    : null;
  const rangeRows = CACHEABLE_RANGE_TABLES.has(table)
    ? safeReadCachedRows(table, buildRangeCacheSuffix(options))
    : null;
  const cachedRows = fullRows || rangeRows;

  return cachedRows?.slice(from, to + 1) || null;
};
