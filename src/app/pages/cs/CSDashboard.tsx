import { CsDashboardFilters } from './components/CsDashboardFilters';
import React, { useState, useMemo } from 'react';
import { useMasterData } from '../master-data/context';
import { Card, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { FoundationDateRangePicker } from '@/app/components/ui/date-range-picker';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/app/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/app/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsRail, TabsTrigger, TabsViewport } from '@/app/components/ui/tabs';
import { HorizontalDragScrollArea } from '@/app/components/ui/horizontal-drag-scroll';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';
import { DateRange } from "react-day-picker";
import { addDays, differenceInCalendarDays, startOfMonth, endOfMonth, eachDayOfInterval, format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { 
  Users, 
  ShoppingCart, 
  CheckCircle, 
  TrendingUp, 
  AlertTriangle,
  Loader2,
  ChevronDown,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Badge } from '@/app/components/ui/badge';
import { usePermissions } from '@/app/hooks/usePermissions';
import { isCsRole } from '@/app/data/roleHelpers';
import {
  fetchAdsIntegrationConfigs,
  fetchMetaSnapshotDataset,
  syncMetaSnapshotDataset,
  type AdsIntegrationConfig,
} from '@/app/services/liveAdsService';
import {
  fetchGoogleAdsIntegrationConfigs,
  fetchGoogleAdsSnapshotDataset,
  syncGoogleAdsSnapshotDataset,
  type GoogleAdsIntegrationConfig,
} from '@/app/services/googleAdsLiveService';
import {
  fetchTikTokAdsIntegrationConfigs,
  fetchTikTokAdsSnapshotDataset,
  syncTikTokAdsSnapshotDataset,
  type TikTokAdsIntegrationConfig,
} from '@/app/services/tiktokAdsLiveService';
import { PlatformLogo } from '@/app/components/ui/PlatformLogo';
import { AdsSyncHistory } from '@/app/components/AdsSyncHistory';
import { readDashboardSnapshotCache, writeDashboardSnapshotCache } from '@/app/services/dashboardSnapshotCache';
import {
  ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT,
  syncAdsApiToDailyAds,
} from '@/app/services/adsDailySyncService';
import {
  fetchAdAccountApiMappings,
  type AdAccountApiMapping,
} from '@/app/services/adApiIntegrationService';
import {
  OperationalEmptyState,
  OperationalKpiCard,
  OperationalKpiGrid,
  RequiredLabel,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '@/app/components/ui/operational-page';
import { toast } from 'sonner';
import {
  ConversionRateBadge,
  CostIndicatorBadge,
  CostPerLeadBadge,
  CprClosingCellValue,
  DailyRateMetric,
  DailySummaryMetric,
  DailySummaryTableCell,
  KpiMetricSkeleton,
  OrderVolumeBadge,
  RoasBadgeValue,
  SpendingCellValue,
  SummaryCell,
  apiStatusClassName,
  formatCount,
  formatNumber,
  formatPercent,
  formatPercentAllowZero,
  formatShortCurrency,
  getApiStatusLabel,
  getConversionRateTextClass,
  getCostIndicatorTextClass,
  getCostPerLeadTextClass,
  getCostPerLeadTone,
  type ApiAdsStatus,
  type MetricTone,
} from './internal/csDashboardKpiHelpers';

type SpamInputFormState = {
  id?: string;
  inputDate: string;
  csId: string;
  platformId: string;
  advertiserId: string;
  spamCount: string;
  notes: string;
};

type CsAdsDailyMetric = {
  date: string;
  spend: number;
  leads: number;
  source: 'api';
};

type CsAdsAccountMetric = CsAdsDailyMetric & {
  adAccountId?: string;
  advertiserId?: string | null;
  csId?: string | null;
  subChannelId?: string | null;
  platformId?: string | null;
  platformKey: string;
  accountName: string;
  ppn: number;
  fee: number;
};

type AdsSnapshotRowLike = {
  id?: string;
  platformKey?: string | null;
  snapshotDate?: string;
  internalAdAccountId?: string | null;
  advertiserId?: string | null;
  platformId?: string | null;
  externalAccountId?: string | null;
  externalAccountName?: string | null;
  spend?: number | null;
  conversions?: number | null;
};

type CsViewApiCacheEntry = {
  metrics: Record<string, CsAdsDailyMetric>;
  byDateAccount: Record<string, CsAdsAccountMetric>;
  status: ApiAdsStatus;
  diagnostics: CsApiLoadDiagnostics;
  cachedAt: number;
};

type CsApiLoadDiagnostics = {
  rawRows: number;
  matchedRows: number;
  unmatchedRows: Array<{
    source: string;
    externalAccountId?: string | null;
    externalAccountName?: string | null;
    spend?: number;
    conversions?: number;
    snapshotDate?: string;
  }>;
  failedSources: string[];
};

type ApiSnapshotApplyResult = {
  applied: boolean;
  hasRows: boolean;
  hasUsefulData: boolean;
  hasFailures: boolean;
  rawRows: number;
  matchedRows: number;
  status: ApiAdsStatus;
};

type CsViewFilterState = {
  selectedCsId?: string;
  selectedPlatformId?: string;
  dateRange?: {
    from?: string;
    to?: string;
  };
};

type CsViewTab = 'performance' | 'spam-inputs';

const CS_VIEW_FILTER_STORAGE_KEY = 'polesheadlamp_cs_view_filters_v1';
const CS_VIEW_MAX_RANGE_DAYS = 62;
const CS_VIEW_DEFAULT_ITEMS_PER_PAGE = 31;
const DASHBOARD_API_PROVIDER_TIMEOUT_MS = 20_000;
const DASHBOARD_API_SYNC_TIMEOUT_MS = 75_000;
const CS_DASHBOARD_API_CACHE_NAMESPACE = 'cs-dashboard-api';
const csViewApiCache = new Map<string, CsViewApiCacheEntry>();

function withDashboardProviderTimeout<T>(
  promise: Promise<T>,
  source: string,
  timeoutMs = DASHBOARD_API_PROVIDER_TIMEOUT_MS,
) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`${source} terlalu lama merespons.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  });
}

const readCsViewFilterState = (): CsViewFilterState => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.sessionStorage.getItem(CS_VIEW_FILTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeCsViewFilterState = (state: CsViewFilterState) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CS_VIEW_FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked in some browser modes; the page should still render.
  }
};

const sanitizeCsViewDateRange = (range: DateRange | undefined): DateRange | undefined => {
  if (!range?.from) return range;

  const from = range.from;
  const rawTo = range.to || range.from;
  const to = differenceInCalendarDays(rawTo, from) > CS_VIEW_MAX_RANGE_DAYS
    ? addDays(from, CS_VIEW_MAX_RANGE_DAYS)
    : rawTo;

  return { from, to };
};

const readInitialDateRange = (): DateRange => {
  const storedRange = readCsViewFilterState().dateRange;
  const from = storedRange?.from ? parseISO(`${storedRange.from}T00:00:00`) : null;
  const to = storedRange?.to ? parseISO(`${storedRange.to}T00:00:00`) : null;

  if (from && !Number.isNaN(from.getTime())) {
    return sanitizeCsViewDateRange({
      from,
      to: to && !Number.isNaN(to.getTime()) ? to : from,
    }) || {
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    };
  }

  return {
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  };
};

const buildApiCacheKey = (range: { from: string; to: string } | null, mappingKey: string) =>
  range ? `${range.from}:${range.to}:${mappingKey || 'unmapped'}` : null;

const createEmptyApiLoadDiagnostics = (): CsApiLoadDiagnostics => ({
  rawRows: 0,
  matchedRows: 0,
  unmatchedRows: [],
  failedSources: [],
});

const normalizeLookupKey = (value?: string | null) =>
  (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();

const normalizeExternalAccountId = (value?: string | null) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/^act_/, '')
    .replace(/[^a-z0-9]/g, '');

const normalizeAdAccountTextKey = (value?: string | null) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/^act_/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const withNormalizedNumericSuffix = (value: string) =>
  value.replace(/(^|\s)0+(\d+)(?=$|\s)/g, (_match, prefix, digits) => `${prefix}${Number(digits)}`);

const getAdAccountNameLookupVariants = (value?: string | null) => {
  const variants = new Set<string>();
  const add = (next?: string | null) => {
    const normalized = normalizeAdAccountTextKey(next);
    const compact = normalizeLookupKey(next);
    if (normalized) variants.add(normalized);
    if (compact) variants.add(compact);

    const normalizedNumeric = withNormalizedNumericSuffix(normalized);
    const compactNumeric = compact.replace(/0+(\d+)$/g, (_match, digits) => String(Number(digits)));
    if (normalizedNumeric) variants.add(normalizedNumeric);
    if (compactNumeric) variants.add(compactNumeric);
  };

  add(value);

  for (const variant of Array.from(variants)) {
    if (variant.includes('rahmansha')) add(variant.replace(/rahmansha/g, 'rahmansa'));
    if (variant.includes('rahmansa')) add(variant.replace(/rahmansa/g, 'rahmansha'));
  }

  return Array.from(variants);
};

const isActiveDataStatus = (status?: string | null) => {
  const normalized = String(status || '').trim().toLowerCase();
  return !normalized || normalized === 'active' || normalized === 'aktif' || normalized === 'enabled' || normalized === 'on';
};

const buildExternalAccountLookupKeys = (platformKey: string, value?: string | null) => {
  const normalized = normalizeExternalAccountId(value);
  if (!normalized) return [];

  const keys = new Set<string>([`${platformKey}:${normalized}`]);
  if (platformKey === 'meta') {
    keys.add(`meta:act${normalized}`);
  }

  return Array.from(keys);
};

const buildExternalAccountNameKeys = (platformKey: string, value?: string | null) => {
  return getAdAccountNameLookupVariants(value).map((variant) => `${platformKey}:${variant}`);
};

const resolvePlatformKey = (value?: string | null) => {
  const normalized = normalizeLookupKey(value);
  if (normalized.includes('google')) return 'google';
  if (normalized.includes('tiktok')) return 'tiktok';
  if (normalized.includes('meta') || normalized.includes('facebook') || normalized.includes('instagram')) {
    return 'meta';
  }
  return 'meta';
};

const getOrderDateKey = (order: { leadDate?: string; serviceDate?: string; created_at?: string }) =>
  (order.leadDate || order.serviceDate || order.created_at || '').slice(0, 10);

export function CSDashboard({ userId }: { userId?: string }) {
  const {
    currentUser,
    orders,
    leads,
    dailyAds,
    leadSpamDailyInputs,
    users,
    adAccounts,
    adAccountAssignments,
    adAccountOwnerAssignments,
    platforms,
    subChannels,
    addLeadSpamDailyInput,
    updateLeadSpamDailyInput,
    deleteLeadSpamDailyInput,
    isOperationalDataLoading,
    refreshTrigger,
    ensureOrdersForDateRange,
    ensureLeadsForDateRange,
    ensureAdPerformanceInputsForDateRange,
    refreshAdPerformanceInputsForDateRange,
  } = useMasterData();
  const { hasPermission } = usePermissions();
  
  // Internal selection state for Owner viewing this dashboard
  const isOwner = hasPermission('dashboard.view_owner');
  const canSyncAds = hasPermission('ads.manage');
  const canManageSpamInputs = hasPermission('leads.edit') || isOwner || isCsRole(currentUser?.role);
  const [selectedCsId, setSelectedCsId] = useState<string>(() => (
    userId || readCsViewFilterState().selectedCsId || 'all'
  ));
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>(() => (
    readCsViewFilterState().selectedPlatformId || 'all'
  ));

  // Update selection if prop changes
  React.useEffect(() => {
     if (userId) setSelectedCsId(userId);
  }, [userId]);

  const targetId = useMemo(() => {
     if (isOwner) {
         return selectedCsId === 'all' ? undefined : selectedCsId;
     }
     return userId || currentUser?.id;
  }, [isOwner, selectedCsId, userId, currentUser]);
  const targetPlatformId = useMemo(() => (
    selectedPlatformId === 'all' ? undefined : selectedPlatformId
  ), [selectedPlatformId]);
  const isAppDatabaseEmpty = leads.length === 0 && orders.length === 0 && leadSpamDailyInputs.length === 0;
  const emptyDataHint = isOperationalDataLoading
    ? 'Data operasional sedang dimuat dari database.'
    : isAppDatabaseEmpty
      ? 'Data database belum masuk ke state lokal. Cek session login atau response 401/403 app-data di Network tab.'
    : 'Data akan muncul dari prospek/order CS dan snapshot API pada rentang tanggal yang dipilih.';
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => readInitialDateRange());
  const [apiAdsMetrics, setApiAdsMetrics] = useState<Record<string, CsAdsDailyMetric>>({});
  const [apiAdsByDateAccount, setApiAdsByDateAccount] = useState<Record<string, CsAdsAccountMetric>>({});
  const [apiAdsStatus, setApiAdsStatus] = useState<ApiAdsStatus>('idle');
  const [apiLoadDiagnostics, setApiLoadDiagnostics] = useState<CsApiLoadDiagnostics>(() => createEmptyApiLoadDiagnostics());
  const [metaIntegrationConfigs, setMetaIntegrationConfigs] = useState<AdsIntegrationConfig[]>([]);
  const [googleIntegrationConfigs, setGoogleIntegrationConfigs] = useState<GoogleAdsIntegrationConfig[]>([]);
  const [tiktokIntegrationConfigs, setTikTokIntegrationConfigs] = useState<TikTokAdsIntegrationConfig[]>([]);
  const [apiAccountMappings, setApiAccountMappings] = useState<AdAccountApiMapping[]>([]);
  const [apiRefreshNonce] = useState(0);
  const [apiSnapshotRefreshNonce, setApiSnapshotRefreshNonce] = useState(1);
  const [isApiDailySyncing, setIsApiDailySyncing] = useState(false);
  const [isPerformanceRangeLoading, setIsPerformanceRangeLoading] = useState(false);
  const [expandedCprBreakdowns, setExpandedCprBreakdowns] = useState<string[]>([]);
  const [isSpamDialogOpen, setIsSpamDialogOpen] = useState(false);
  const [isSavingSpamInput, setIsSavingSpamInput] = useState(false);
  const [activeTab, setActiveTab] = useState<CsViewTab>('performance');
  const [isMobileFilterExpanded, setIsMobileFilterExpanded] = useState(false);
  const [spamInputToDelete, setSpamInputToDelete] = useState<string | null>(null);
  const [isSpamFormMobile, setIsSpamFormMobile] = useState(false);
  const [spamForm, setSpamForm] = useState<SpamInputFormState>({
    inputDate: '',
    csId: '',
    platformId: '',
    advertiserId: '',
    spamCount: '',
    notes: '',
  });
  const [expandedDateGroups, setExpandedDateGroups] = useState<string[]>(() => [
    format(new Date(), 'yyyy-MM-dd'),
  ]);
  const lastApiRefreshNonceRef = React.useRef(0);
  const lastApiSnapshotRefreshNonceRef = React.useRef(0);
  const apiRequestInFlightRef = React.useRef(false);
  const performanceRangeRequestRef = React.useRef(0);
  const lastMasterRefreshTriggerRef = React.useRef(refreshTrigger);
  const lastSpamScopeKeyRef = React.useRef('');

  React.useEffect(() => {
    const checkMobile = () => setIsSpamFormMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  React.useEffect(() => {
    if (refreshTrigger === lastMasterRefreshTriggerRef.current) return;
    lastMasterRefreshTriggerRef.current = refreshTrigger;
    setApiSnapshotRefreshNonce((value) => value + 1);
  }, [refreshTrigger]);

  React.useEffect(() => {
    const refreshStoredSnapshots = () => setApiSnapshotRefreshNonce((value) => value + 1);
    window.addEventListener(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT, refreshStoredSnapshots);
    return () => window.removeEventListener(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT, refreshStoredSnapshots);
  }, []);
  const handleDateRangeChange = React.useCallback((range: DateRange | undefined) => {
    setDateRange(sanitizeCsViewDateRange(range));
  }, []);
  const toggleDateGroup = React.useCallback((dateKey: string) => {
    setExpandedDateGroups((current) =>
      current.includes(dateKey)
        ? current.filter((date) => date !== dateKey)
        : [...current, dateKey],
    );
  }, []);

  const rangeParams = useMemo(() => {
    if (!dateRange?.from) return null;

    return {
      from: format(dateRange.from, 'yyyy-MM-dd'),
      to: format(dateRange.to || dateRange.from, 'yyyy-MM-dd'),
    };
  }, [dateRange]);
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCsId !== 'all') count += 1;
    if (selectedPlatformId !== 'all') count += 1;
    if (rangeParams) count += 1;
    return count;
  }, [rangeParams, selectedCsId, selectedPlatformId]);

  const handleSyncAdsApiToDailyAds = React.useCallback(async () => {
    if (!rangeParams) return;

    setIsApiDailySyncing(true);
    setApiAdsStatus('loading');
    try {
      const syncResult = await syncAdsApiToDailyAds({
        range: rangeParams,
        actor: currentUser || undefined,
        context: {
          dailyAds,
          platforms,
          adAccounts,
          adAccountAssignments,
          adAccountOwnerAssignments,
          users,
        },
        filters: {
          platformId: targetPlatformId || 'all',
          csId: targetId || 'all',
          mode: 'update-existing',
          preserveEdited: true,
          mappedOnly: true,
        },
      });
      if (syncResult.busy) {
        toast.info(syncResult.message || 'Sinkron iklan lain sedang berjalan.');
        setApiAdsStatus('ready');
        return;
      }
      const unmappedRows = syncResult.rows.filter((row) =>
        row.status === 'unmapped' && ((Number(row.amountSpent) || 0) > 0 || (Number(row.leadsDashboard) || 0) > 0),
      );
      setApiLoadDiagnostics({
        rawRows: syncResult.rows.length,
        matchedRows: syncResult.rows.length - unmappedRows.length,
        unmatchedRows: unmappedRows.map((row) => ({
          source: row.sourceLabel.toLowerCase(),
          externalAccountId: row.adAccountId || undefined,
          externalAccountName: row.accountName,
          spend: row.amountSpent,
          conversions: row.leadsDashboard,
          snapshotDate: row.date,
        })),
        failedSources: syncResult.providerStatuses
          .filter((status) => status.state === 'error')
          .map((status) => status.key),
      });

      if (syncResult.providerStatuses.length === 0) {
        toast.info('Platform ini belum punya konektor API laporan iklan.');
        setApiAdsStatus('empty');
        return;
      }

      const hasExistingDailyAds = syncResult.rows.some((row) => row.status === 'skip' && row.existing);
      if (syncResult.actionableCount === 0) {
        if (hasExistingDailyAds) {
          await refreshAdPerformanceInputsForDateRange(rangeParams);
        }
        const errorHint = syncResult.errors.length > 0 ? ` ${syncResult.errors[0]}` : '';
        toast.info(`Tidak ada data API yang perlu disimpan ke Iklan Harian.${errorHint}`);
        setApiAdsStatus(syncResult.errors.length > 0 ? 'error' : syncResult.rows.length > 0 ? 'ready' : 'empty');
        return;
      }

      await refreshAdPerformanceInputsForDateRange(rangeParams);
      setApiAdsStatus('ready');
      toast.success(`Sinkron API selesai: ${syncResult.inserted} ditambahkan, ${syncResult.updated} diperbarui di Iklan Harian.`);
    } catch (error) {
      setApiAdsStatus('error');
      toast.error(error instanceof Error ? error.message : 'Gagal sinkron API ke Iklan Harian.');
    } finally {
      setIsApiDailySyncing(false);
    }
  }, [
    adAccountAssignments,
    adAccountOwnerAssignments,
    adAccounts,
    currentUser,
    dailyAds,
    platforms,
    rangeParams,
    refreshAdPerformanceInputsForDateRange,
    targetId,
    targetPlatformId,
    users,
  ]);

  React.useEffect(() => {
    if (!rangeParams) return;

    let isCancelled = false;
    const requestId = performanceRangeRequestRef.current + 1;
    performanceRangeRequestRef.current = requestId;
    setIsPerformanceRangeLoading(true);

    void Promise.allSettled([
      ensureOrdersForDateRange({ from: rangeParams.from, to: rangeParams.to, mode: 'lead' }),
      ensureOrdersForDateRange({ from: rangeParams.from, to: rangeParams.to, mode: 'service' }),
      ensureLeadsForDateRange({ from: rangeParams.from, to: rangeParams.to }),
      ensureAdPerformanceInputsForDateRange({ from: rangeParams.from, to: rangeParams.to }),
    ]).then((results) => {
      if (import.meta.env.DEV) {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.warn('[CS Dashboard] range data fetch failed', { index, error: result.reason });
          }
        });
      }
    }).finally(() => {
      if (!isCancelled && performanceRangeRequestRef.current === requestId) {
        setIsPerformanceRangeLoading(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [
    ensureLeadsForDateRange,
    ensureOrdersForDateRange,
    ensureAdPerformanceInputsForDateRange,
    rangeParams?.from,
    rangeParams?.to,
  ]);

  React.useEffect(() => {
    writeCsViewFilterState({
      selectedCsId,
      selectedPlatformId,
      dateRange: rangeParams || undefined,
    });
  }, [rangeParams, selectedCsId, selectedPlatformId]);

  const platformFilterOptions = useMemo(() => {
    const activePlatformIds = new Set(
      adAccounts
        .filter((account) => account.status === 'active' && account.platformId)
        .map((account) => account.platformId as string),
    );

    return platforms
      .filter((platform) => activePlatformIds.has(platform.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'));
  }, [adAccounts, platforms]);

  const spamCsOptions = useMemo(() => (
    users
      .filter((user) => isCsRole(user.role) && user.status === 'active')
      .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'))
  ), [users]);

  const spamAdvertiserOptions = useMemo(() => {
    const spamCsScopeId = spamForm.csId || targetId;
    const spamDateScope = spamForm.inputDate || rangeParams?.to || rangeParams?.from;
    const activeAdvertiserIds = new Set(
      adAccounts
        .filter((account) => {
          if (account.status !== 'active') return false;
          if (!spamCsScopeId) return false;

          const matchedAssignment = adAccountAssignments
            .filter((assignment) =>
              assignment.adAccountId === account.id &&
              assignment.status === 'active' &&
              assignment.csId === spamCsScopeId &&
              (!spamDateScope ||
                (assignment.startDate <= spamDateScope &&
                  (!assignment.endDate || assignment.endDate >= spamDateScope))),
            )
            .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

          return Boolean(matchedAssignment);
        })
        .map((account) => account.advertiserId)
        .filter(Boolean),
    );

    return users
      .filter((user) => user.role === 'Advertiser' && user.status === 'active' && activeAdvertiserIds.has(user.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'));
  }, [
    adAccountAssignments,
    adAccounts,
    rangeParams?.from,
    rangeParams?.to,
    spamForm.csId,
    spamForm.inputDate,
    targetId,
    users,
  ]);

  const spamPlatformOptions = useMemo(() => {
    const spamCsScopeId = spamForm.csId || targetId;
    const spamDateScope = spamForm.inputDate || rangeParams?.to || rangeParams?.from;
    const assignedPlatformIds = new Set(
      adAccounts
        .filter((account) => {
          if (account.status !== 'active') return false;
          if (!spamCsScopeId) return false;
          if (spamForm.advertiserId && account.advertiserId !== spamForm.advertiserId) return false;

          const matchedAssignment = adAccountAssignments
            .filter((assignment) =>
              assignment.adAccountId === account.id &&
              assignment.status === 'active' &&
              assignment.csId === spamCsScopeId &&
              (!spamDateScope ||
                (assignment.startDate <= spamDateScope &&
                  (!assignment.endDate || assignment.endDate >= spamDateScope))),
            )
            .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

          return Boolean(matchedAssignment);
        })
        .map((account) => account.platformId)
        .filter(Boolean),
    );

    return platforms
      .filter((platform) => assignedPlatformIds.has(platform.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'));
  }, [
    adAccountAssignments,
    adAccounts,
    platforms,
    rangeParams?.from,
    rangeParams?.to,
    spamForm.advertiserId,
    spamForm.csId,
    spamForm.inputDate,
    targetId,
  ]);

  React.useEffect(() => {
    if (selectedPlatformId === 'all') return;
    if (platformFilterOptions.some((platform) => platform.id === selectedPlatformId)) return;
    setSelectedPlatformId('all');
  }, [platformFilterOptions, selectedPlatformId]);

  React.useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      fetchAdsIntegrationConfigs(),
      fetchGoogleAdsIntegrationConfigs(),
      fetchTikTokAdsIntegrationConfigs(),
      fetchAdAccountApiMappings(),
    ])
      .then(([meta, google, tiktok, mappings]) => {
        if (cancelled) return;

        setMetaIntegrationConfigs(meta.status === 'fulfilled' ? meta.value : []);
        setGoogleIntegrationConfigs(google.status === 'fulfilled' ? google.value : []);
        setTikTokIntegrationConfigs(tiktok.status === 'fulfilled' ? tiktok.value : []);
        setApiAccountMappings(mappings.status === 'fulfilled' ? mappings.value : []);
      })
      .catch(() => {
        if (!cancelled) {
          setMetaIntegrationConfigs([]);
          setGoogleIntegrationConfigs([]);
          setTikTokIntegrationConfigs([]);
          setApiAccountMappings([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  const googleIntegrationConfigByAdAccountId = useMemo(() => {
    return new Map(googleIntegrationConfigs.map((config) => [config.adAccountId, config]));
  }, [googleIntegrationConfigs]);

  const shouldShowAdAccountInCsView = React.useCallback(
    (account: (typeof adAccounts)[number]) => {
      const platformKey = resolvePlatformKey(
        platforms.find((platform) => platform.id === account.platformId)?.name,
      );
      if (platformKey !== 'google') return true;
      if (googleIntegrationConfigs.length === 0) return true;

      return googleIntegrationConfigByAdAccountId.get(account.id)?.enabled === true;
    },
    [googleIntegrationConfigByAdAccountId, googleIntegrationConfigs.length, platforms],
  );

  const buildInitialSpamFormState = React.useCallback((dateKey?: string): SpamInputFormState => {
    const defaultCsId = targetId
      || (currentUser && isCsRole(currentUser.role) ? currentUser.id : '')
      || spamCsOptions[0]?.id
      || '';

    return {
      inputDate: dateKey || rangeParams?.to || rangeParams?.from || format(new Date(), 'yyyy-MM-dd'),
      csId: defaultCsId,
      platformId: targetPlatformId || platformFilterOptions[0]?.id || '',
      advertiserId: '',
      spamCount: '',
      notes: '',
    };
  }, [currentUser, platformFilterOptions, rangeParams, spamCsOptions, targetId, targetPlatformId]);

  const openSpamInputDialog = React.useCallback((dateKey?: string) => {
    lastSpamScopeKeyRef.current = '';
    setSpamForm(buildInitialSpamFormState(dateKey));
    setIsSpamDialogOpen(true);
  }, [buildInitialSpamFormState]);

  const openSpamInputEditDialog = React.useCallback((item: (typeof leadSpamDailyInputs)[number]) => {
    lastSpamScopeKeyRef.current = '';
    setSpamForm({
      id: item.id,
      inputDate: item.inputDate,
      csId: item.csId,
      platformId: item.platformId,
      advertiserId: item.advertiserId,
      spamCount: String(item.spamCount),
      notes: item.notes || '',
    });
    setIsSpamDialogOpen(true);
  }, []);

  const spamFormScopeKey = `${spamForm.inputDate}::${spamForm.csId}::${spamForm.platformId}::${spamForm.advertiserId}`;

  React.useEffect(() => {
    if (!isSpamDialogOpen) return;
    if (spamFormScopeKey === lastSpamScopeKeyRef.current) return;
    lastSpamScopeKeyRef.current = spamFormScopeKey;

    if (!spamForm.inputDate || !spamForm.csId || !spamForm.platformId || !spamForm.advertiserId) {
      setSpamForm((current) => ({ ...current, id: undefined, spamCount: '', notes: '' }));
      return;
    }

    const existing = leadSpamDailyInputs.find((item) =>
      item.inputDate === spamForm.inputDate &&
      item.csId === spamForm.csId &&
      item.platformId === spamForm.platformId &&
      item.advertiserId === spamForm.advertiserId,
    );

    setSpamForm((current) => ({
      ...current,
      id: existing?.id,
      spamCount: existing ? String(existing.spamCount) : '',
      notes: existing?.notes || '',
    }));
  }, [isSpamDialogOpen, leadSpamDailyInputs, spamForm.advertiserId, spamForm.csId, spamForm.inputDate, spamForm.platformId, spamFormScopeKey]);

  React.useEffect(() => {
    if (!isSpamDialogOpen) return;
    if (spamForm.advertiserId && !spamAdvertiserOptions.some((advertiser) => advertiser.id === spamForm.advertiserId)) {
      setSpamForm((current) => ({ ...current, advertiserId: '', platformId: '', id: undefined, spamCount: '', notes: '' }));
    }
  }, [isSpamDialogOpen, spamAdvertiserOptions, spamForm.advertiserId]);

  React.useEffect(() => {
    if (!isSpamDialogOpen) return;
    if (spamForm.platformId && !spamPlatformOptions.some((platform) => platform.id === spamForm.platformId)) {
      setSpamForm((current) => ({ ...current, platformId: '', id: undefined, spamCount: '', notes: '' }));
    }
  }, [isSpamDialogOpen, spamForm.platformId, spamPlatformOptions]);

  const adAccountMasterLookup = useMemo(() => {
    const byId = new Map<string, (typeof adAccounts)[number]>();

    for (const account of adAccounts) {
      byId.set(account.id, account);
    }

    return { byId };
  }, [adAccounts]);

  const adAccountLookup = useMemo(() => {
    const byId = new Map<string, (typeof adAccounts)[number]>();
    const byName = new Map<string, (typeof adAccounts)[number]>();
    const byExternalId = new Map<string, (typeof adAccounts)[number]>();
    const byExternalName = new Map<string, (typeof adAccounts)[number]>();
    const inactiveInternalIds = new Set<string>();
    const inactiveExternalIds = new Set<string>();
    const allAccountsById = new Map(adAccounts.map((account) => [account.id, account]));

    const registerExternalPairing = (
      account: (typeof adAccounts)[number] | undefined,
      platformKey: string,
      externalId?: string | null,
      externalName?: string | null,
    ) => {
      if (!account) return;
      for (const key of buildExternalAccountLookupKeys(platformKey, externalId)) {
        byExternalId.set(key, account);
      }
      for (const key of buildExternalAccountNameKeys(platformKey, externalName)) {
        byExternalName.set(key, account);
      }
    };

    for (const account of adAccounts) {
      if (!isActiveDataStatus(account.status)) continue;
      if (!shouldShowAdAccountInCsView(account)) continue;
      byId.set(account.id, account);
      for (const key of getAdAccountNameLookupVariants(account.accountName)) {
        byName.set(key, account);
      }
      const platformName = platforms.find((platform) => platform.id === account.platformId)?.name;
      registerExternalPairing(account, resolvePlatformKey(platformName), account.id, account.accountName);
    }

    for (const config of metaIntegrationConfigs) {
      if (!config.enabled) continue;
      registerExternalPairing(byId.get(config.adAccountId), 'meta', config.liveMetaAccountId, config.liveMetaAccountName);
    }

    for (const config of googleIntegrationConfigs) {
      if (!config.enabled) continue;
      registerExternalPairing(byId.get(config.adAccountId), 'google', config.liveGoogleCustomerId, config.liveGoogleCustomerName);
    }

    for (const config of tiktokIntegrationConfigs) {
      if (!config.enabled) continue;
      registerExternalPairing(byId.get(config.adAccountId), 'tiktok', config.liveTikTokAdvertiserId, config.liveTikTokAdvertiserName);
    }

    for (const mapping of apiAccountMappings) {
      if (mapping.status !== 'active') continue;
      const mappedAccount = allAccountsById.get(mapping.internalAdAccountId);
      if (mappedAccount && !isActiveDataStatus(mappedAccount.status)) {
        inactiveInternalIds.add(mappedAccount.id);
        for (const key of buildExternalAccountLookupKeys(mapping.platformKey, mapping.externalAccountId)) {
          inactiveExternalIds.add(key);
        }
        continue;
      }
      registerExternalPairing(byId.get(mapping.internalAdAccountId), mapping.platformKey, mapping.externalAccountId);
    }

    return { byId, byName, byExternalId, byExternalName, inactiveInternalIds, inactiveExternalIds };
  }, [adAccounts, apiAccountMappings, googleIntegrationConfigs, metaIntegrationConfigs, platforms, shouldShowAdAccountInCsView, tiktokIntegrationConfigs]);

  const scopedApiPlatformKeys = useMemo(() => {
    const platformNameById = new Map(platforms.map((platform) => [platform.id, platform.name]));
    const keys = new Set<string>();

    for (const account of adAccounts) {
      if (!isActiveDataStatus(account.status)) continue;
      if (!shouldShowAdAccountInCsView(account)) continue;
      if (targetPlatformId && account.platformId !== targetPlatformId) continue;
      keys.add(resolvePlatformKey(platformNameById.get(account.platformId || '')));
    }

    return keys;
  }, [adAccounts, platforms, shouldShowAdAccountInCsView, targetPlatformId]);

  const adAccountMappingCacheKey = useMemo(() => {
    const accountPart = adAccounts
      .filter((account) => isActiveDataStatus(account.status) && shouldShowAdAccountInCsView(account))
      .map((account) => [
        account.id,
        normalizeLookupKey(account.accountName),
        account.platformId || '',
        account.advertiserId || '',
        account.subChannelId || '',
        account.ppn || 0,
        account.fee || 0,
      ].join(':'))
      .sort()
      .join('|');
    const accountStatusPart = adAccounts
      .map((account) => `${account.id}:${account.status || ''}`)
      .sort()
      .join('|');

    const assignmentPart = adAccountAssignments
      .filter((assignment) => assignment.status === 'active')
      .map((assignment) => [
        assignment.adAccountId,
        assignment.csId,
        assignment.subChannelId || '',
        assignment.startDate,
        assignment.endDate || '',
      ].join(':'))
      .sort()
      .join('|');

    const integrationPart = [
      ...metaIntegrationConfigs.map((config) =>
        `meta:${config.adAccountId}:${config.enabled}:${config.liveMetaAccountId || ''}:${config.liveMetaAccountName || ''}`,
      ),
      ...googleIntegrationConfigs.map((config) =>
        `google:${config.adAccountId}:${config.enabled}:${config.liveGoogleCustomerId || ''}:${config.liveGoogleCustomerName || ''}`,
      ),
      ...tiktokIntegrationConfigs.map((config) =>
        `tiktok:${config.adAccountId}:${config.enabled}:${config.liveTikTokAdvertiserId || ''}:${config.liveTikTokAdvertiserName || ''}`,
      ),
      ...apiAccountMappings.map((mapping) =>
        `api-map:${mapping.internalAdAccountId}:${mapping.platformKey}:${mapping.externalAccountId}:${mapping.status}`,
      ),
    ].sort().join('|');

    return `${accountPart}::${accountStatusPart}::${assignmentPart}::${integrationPart}`;
  }, [adAccountAssignments, adAccounts, apiAccountMappings, googleIntegrationConfigs, metaIntegrationConfigs, shouldShowAdAccountInCsView, tiktokIntegrationConfigs]);

  const adAccountCsLookup = useMemo(() => {
    const resolveAssignment = (adAccountId?: string, date?: string) => {
      if (!adAccountId) return null;

      if (date) {
        const datedAssignment = adAccountAssignments
          .filter((assignment) =>
            assignment.adAccountId === adAccountId &&
            assignment.status === 'active' &&
            assignment.startDate <= date &&
            (!assignment.endDate || assignment.endDate >= date)
          )
          .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

        if (datedAssignment?.csId) return datedAssignment;
      }

      const openAssignment = adAccountAssignments
        .filter((assignment) =>
          assignment.adAccountId === adAccountId &&
          assignment.status === 'active' &&
          !assignment.endDate
        )
        .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

      return openAssignment || null;
    };

    return { resolveAssignment };
  }, [adAccountAssignments]);

  const adAccountOwnerLookup = useMemo(() => {
    const resolveOwner = (adAccountId?: string, date?: string) => {
      if (!adAccountId) return null;

      if (date) {
        const datedOwner = adAccountOwnerAssignments
          .filter((assignment) =>
            assignment.adAccountId === adAccountId &&
            isActiveDataStatus(assignment.status) &&
            assignment.startDate <= date &&
            (!assignment.endDate || assignment.endDate >= date)
          )
          .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

        if (datedOwner?.advertiserId) return datedOwner;
      }

      const openOwner = adAccountOwnerAssignments
        .filter((assignment) =>
          assignment.adAccountId === adAccountId &&
          isActiveDataStatus(assignment.status) &&
          !assignment.endDate
        )
        .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

      return openOwner || null;
    };

    return { resolveOwner };
  }, [adAccountOwnerAssignments]);

  const csPerformanceAds = useMemo(() => {
    return dailyAds.map((dailyAd) => {
      const adAccount = adAccountMasterLookup.byId.get(dailyAd.adAccountId);
      const assignment = adAccountCsLookup.resolveAssignment(dailyAd.adAccountId, dailyAd.date);
      const owner = adAccountOwnerLookup.resolveOwner(dailyAd.adAccountId, dailyAd.date);

      return {
        ...dailyAd,
        advertiserId: owner?.advertiserId || adAccount?.advertiserId || dailyAd.advertiserId,
        platformId: adAccount?.platformId || dailyAd.platformId,
        subChannelId: assignment?.subChannelId || adAccount?.subChannelId || dailyAd.subChannelId || undefined,
        csId: assignment?.csId || dailyAd.csId || undefined,
      };
    });
  }, [adAccountCsLookup, adAccountMasterLookup, adAccountOwnerLookup, dailyAds]);

  React.useEffect(() => {
    if (!rangeParams) {
      setApiAdsMetrics({});
      setApiAdsByDateAccount({});
      setApiAdsStatus('idle');
      setApiLoadDiagnostics(createEmptyApiLoadDiagnostics());
      return;
    }

    if (adAccountLookup.byId.size === 0 && adAccountLookup.byName.size === 0) {
      setApiAdsMetrics({});
      setApiAdsByDateAccount({});
      setApiAdsStatus(isOperationalDataLoading ? 'idle' : 'empty');
      setApiLoadDiagnostics(createEmptyApiLoadDiagnostics());
      return;
    }

    let cancelled = false;
    const forceRefresh = apiRefreshNonce !== lastApiRefreshNonceRef.current;
    if (forceRefresh) {
      lastApiRefreshNonceRef.current = apiRefreshNonce;
    }
    const backgroundRefresh = apiSnapshotRefreshNonce !== lastApiSnapshotRefreshNonceRef.current;
    if (backgroundRefresh) {
      lastApiSnapshotRefreshNonceRef.current = apiSnapshotRefreshNonce;
    }
    if (!forceRefresh && !backgroundRefresh) {
      setApiAdsMetrics({});
      setApiAdsByDateAccount({});
      setApiAdsStatus('idle');
      setApiLoadDiagnostics(createEmptyApiLoadDiagnostics());
      return;
    }
    const cacheKey = buildApiCacheKey(rangeParams, adAccountMappingCacheKey);
    const persistentCachedSnapshot =
      cacheKey && !forceRefresh && !backgroundRefresh
        ? readDashboardSnapshotCache<CsViewApiCacheEntry>(CS_DASHBOARD_API_CACHE_NAMESPACE, cacheKey)
        : null;
    if (cacheKey && persistentCachedSnapshot && !csViewApiCache.has(cacheKey)) {
      csViewApiCache.set(cacheKey, persistentCachedSnapshot);
    }
    const cachedSnapshotForFallback = cacheKey ? (csViewApiCache.get(cacheKey) || persistentCachedSnapshot) : null;
    const cachedSnapshot = !forceRefresh && !backgroundRefresh ? cachedSnapshotForFallback : null;
    if (cachedSnapshot && !forceRefresh) {
      setApiAdsMetrics(cachedSnapshot.metrics);
      setApiAdsByDateAccount(cachedSnapshot.byDateAccount);
      setApiAdsStatus(cachedSnapshot.status);
      setApiLoadDiagnostics(cachedSnapshot.diagnostics);
    }

    const resolveAdAccount = (row: AdsSnapshotRowLike) => {
      const platformName = platforms.find((platform) => platform.id === row.platformId)?.name;
      const platformKey = row.platformKey || resolvePlatformKey(platformName || row.externalAccountName);
      const internalId = row.internalAdAccountId || '';
      if (internalId && adAccountLookup.byId.has(internalId)) return adAccountLookup.byId.get(internalId) || null;

      const externalId = row.externalAccountId || '';
      for (const key of buildExternalAccountLookupKeys(platformKey, externalId)) {
        const account = adAccountLookup.byExternalId.get(key);
        if (account) return account;
      }

      for (const key of buildExternalAccountNameKeys(platformKey, row.externalAccountName)) {
        const account = adAccountLookup.byExternalName.get(key);
        if (account) return account;
      }

      for (const key of getAdAccountNameLookupVariants(row.externalAccountName)) {
        const account = adAccountLookup.byName.get(key);
        if (account) return account;
      }

      return null;
    };

    const isMappedToInactiveAccount = (row: AdsSnapshotRowLike) => {
      const platformName = platforms.find((platform) => platform.id === row.platformId)?.name;
      const platformKey = row.platformKey || resolvePlatformKey(platformName || row.externalAccountName);
      const externalKeys = buildExternalAccountLookupKeys(platformKey, row.externalAccountId);

      if (externalKeys.some((key) => adAccountLookup.inactiveExternalIds.has(key))) return true;
      if (externalKeys.some((key) => adAccountLookup.byExternalId.has(key))) return false;

      return Boolean(
        row.internalAdAccountId &&
        adAccountLookup.inactiveInternalIds.has(row.internalAdAccountId),
      );
    };

    const addSnapshotRows = (
      resultByDate: Record<string, CsAdsDailyMetric>,
      resultByDateAccount: Record<string, CsAdsAccountMetric>,
      rows: AdsSnapshotRowLike[],
      diagnostics: CsApiLoadDiagnostics,
      source: string,
    ) => {
      for (const row of rows) {
        const date = row.snapshotDate;
        if (!date) continue;
        if (date < rangeParams.from || date > rangeParams.to) continue;

        diagnostics.rawRows += 1;

        // Provider snapshots remain available for audit, but intentionally inactive
        // internal accounts must not be treated as missing mappings.
        if (isMappedToInactiveAccount(row)) continue;

        const adAccount = resolveAdAccount(row);
        if (!adAccount) {
          if (Number(row.spend) > 0 || Number(row.conversions) > 0) {
            diagnostics.unmatchedRows.push({
              source,
              externalAccountId: row.externalAccountId,
              externalAccountName: row.externalAccountName,
              spend: Number(row.spend) || 0,
              conversions: Number(row.conversions) || 0,
              snapshotDate: row.snapshotDate,
            });
          }
          continue;
        }

        diagnostics.matchedRows += 1;

	        const assignment = adAccountCsLookup.resolveAssignment(adAccount.id, date);
	        const owner = adAccountOwnerLookup.resolveOwner(adAccount.id, date);
	        const canonicalAdvertiserId = owner?.advertiserId || adAccount?.advertiserId || row.advertiserId || null;
        const canonicalPlatformId = adAccount?.platformId || row.platformId || null;

        const spend = Number(row.spend) || 0;
        const conversions = Number(row.conversions) || 0;
        const current = resultByDate[date] || {
          date,
          spend: 0,
          leads: 0,
          source: 'api' as const,
        };
        current.spend += spend;
        current.leads += conversions;
        resultByDate[date] = current;

        const accountKey = `${date}::${adAccount?.id || row.externalAccountId || row.externalAccountName || row.id || 'unmapped-api-account'}`;
        const platformName = platforms.find((platform) => platform.id === canonicalPlatformId)?.name;
        const currentAccount = resultByDateAccount[accountKey] || {
          date,
          adAccountId: adAccount.id,
          advertiserId: canonicalAdvertiserId,
          csId: assignment?.csId || null,
          subChannelId: assignment?.subChannelId || null,
          platformId: canonicalPlatformId,
          platformKey: row.platformKey || resolvePlatformKey(platformName),
          accountName: adAccount?.accountName || row.externalAccountName || 'Akun API belum dipetakan',
          ppn: adAccount?.ppn || 0,
          fee: adAccount?.fee || 0,
          spend: 0,
          leads: 0,
          source: 'api' as const,
        };
        currentAccount.spend += spend;
        currentAccount.leads += conversions;
        resultByDateAccount[accountKey] = currentAccount;
      }
    };

    const applySettledSnapshotResults = (
      results: Array<PromiseSettledResult<{ rows?: AdsSnapshotRowLike[] }>>,
      options: { cacheResult?: boolean; keepExistingWhenEmpty?: boolean; mode: 'stored' | 'sync' },
    ): ApiSnapshotApplyResult => {
      const [meta, google, tiktok] = results;
      const next: Record<string, CsAdsDailyMetric> = {};
      const nextByAccount: Record<string, CsAdsAccountMetric> = {};
      const diagnostics = createEmptyApiLoadDiagnostics();
      const failedSources = [
        { source: 'meta', result: meta },
        { source: 'google', result: google },
        { source: 'tiktok', result: tiktok },
      ].filter((item): item is { source: string; result: PromiseRejectedResult } => item.result.status === 'rejected');
      const failedSourceKeys = new Set(failedSources.map((item) => item.source));

      diagnostics.failedSources = failedSources.map((item) => item.source);

      if (meta.status === 'fulfilled') addSnapshotRows(next, nextByAccount, meta.value.rows || [], diagnostics, 'meta');
      if (google.status === 'fulfilled') addSnapshotRows(next, nextByAccount, google.value.rows || [], diagnostics, 'google');
      if (tiktok.status === 'fulfilled') addSnapshotRows(next, nextByAccount, tiktok.value.rows || [], diagnostics, 'tiktok');

      if (failedSourceKeys.size > 0 && cachedSnapshotForFallback) {
        for (const [accountKey, cachedMetric] of Object.entries(cachedSnapshotForFallback.byDateAccount)) {
          if (!failedSourceKeys.has(cachedMetric.platformKey)) continue;
          if (cachedMetric.date < rangeParams.from || cachedMetric.date > rangeParams.to) continue;
          if (nextByAccount[accountKey]) continue;

          nextByAccount[accountKey] = cachedMetric;
          const current = next[cachedMetric.date] || {
            date: cachedMetric.date,
            spend: 0,
            leads: 0,
            source: 'api' as const,
          };
          current.spend += cachedMetric.spend;
          current.leads += cachedMetric.leads;
          next[cachedMetric.date] = current;
        }
      }

      if (failedSources.length > 0) {
        console.warn(`[CS Dashboard] sebagian snapshot API iklan gagal dimuat (${options.mode})`, failedSources.map((item) => ({
          source: item.source,
          error: item.result.reason,
        })));
      }

      const hasUsefulApiMetrics = Object.values(next).some((row) => row.spend > 0 || row.leads > 0);
      const hasUsefulApiAccountMetrics = Object.values(nextByAccount).some(
        (row) => row.spend > 0 || row.leads > 0,
      );
      const hasUsefulData = hasUsefulApiMetrics || hasUsefulApiAccountMetrics;
      const hasAnyRows = diagnostics.rawRows > 0 || Object.keys(nextByAccount).length > 0;
      const hasAnyProviderResponse = results.some((result) => result.status === 'fulfilled');
      const status: ApiAdsStatus = hasUsefulData
        ? 'ready'
        : failedSources.length > 0
          ? 'error'
          : 'empty';

      if (options.keepExistingWhenEmpty && (!hasAnyProviderResponse || !hasUsefulData)) {
        return {
          applied: false,
          hasRows: hasAnyRows,
          hasUsefulData,
          hasFailures: failedSources.length > 0,
          rawRows: diagnostics.rawRows,
          matchedRows: diagnostics.matchedRows,
          status,
        };
      }

      setApiAdsMetrics(next);
      setApiAdsByDateAccount(nextByAccount);
      setApiLoadDiagnostics(diagnostics);
      setApiAdsStatus(status);
      if (options.cacheResult && cacheKey) {
        const cachedEntry = {
          metrics: next,
          byDateAccount: nextByAccount,
          status,
          diagnostics,
          cachedAt: Date.now(),
        };
        csViewApiCache.set(cacheKey, cachedEntry);
        writeDashboardSnapshotCache(CS_DASHBOARD_API_CACHE_NAMESPACE, cacheKey, cachedEntry);
      }

      return {
        applied: true,
        hasRows: hasAnyRows,
        hasUsefulData,
        hasFailures: failedSources.length > 0,
        rawRows: diagnostics.rawRows,
        matchedRows: diagnostics.matchedRows,
        status,
      };
    };

    const loadStoredSnapshots = async () => {
      const shouldLoadMeta = scopedApiPlatformKeys.has('meta');
      const shouldLoadGoogle = scopedApiPlatformKeys.has('google');
      const shouldLoadTikTok = scopedApiPlatformKeys.has('tiktok');
      const emptySnapshotDataset = { rows: [] as AdsSnapshotRowLike[] };

      return Promise.allSettled([
        shouldLoadMeta
          ? withDashboardProviderTimeout(
              fetchMetaSnapshotDataset({ ...rangeParams, includeLastKnown: true }).then((payload) => ({ rows: payload.rows || [] })),
              'Meta Ads',
            )
          : Promise.resolve(emptySnapshotDataset),
        shouldLoadGoogle
          ? withDashboardProviderTimeout(
              fetchGoogleAdsSnapshotDataset({ ...rangeParams, includeLastKnown: true }).then((payload) => ({ rows: payload.rows || [] })),
              'Google Ads',
            )
          : Promise.resolve(emptySnapshotDataset),
        shouldLoadTikTok
          ? withDashboardProviderTimeout(
              fetchTikTokAdsSnapshotDataset({ ...rangeParams, includeLastKnown: true }).then((payload) => ({ rows: payload.rows || [] })),
              'TikTok Ads',
            )
          : Promise.resolve(emptySnapshotDataset),
      ]);
    };

    const syncSnapshots = async () => {
      const shouldLoadMeta = scopedApiPlatformKeys.has('meta');
      const shouldLoadGoogle = scopedApiPlatformKeys.has('google');
      const shouldLoadTikTok = scopedApiPlatformKeys.has('tiktok');
      const emptySnapshotDataset = { rows: [] as AdsSnapshotRowLike[] };

      return Promise.allSettled([
        shouldLoadMeta
          ? withDashboardProviderTimeout(
              syncMetaSnapshotDataset({ ...rangeParams, force: true, minFreshMinutes: 0 }).then((payload) => ({ rows: payload.rows || [] })),
              'Meta Ads',
              DASHBOARD_API_SYNC_TIMEOUT_MS,
            )
          : Promise.resolve(emptySnapshotDataset),
        shouldLoadGoogle
          ? withDashboardProviderTimeout(
              syncGoogleAdsSnapshotDataset({ ...rangeParams, force: true, minFreshMinutes: 0 }).then((payload) => ({ rows: payload.rows || [] })),
              'Google Ads',
              DASHBOARD_API_SYNC_TIMEOUT_MS,
            )
          : Promise.resolve(emptySnapshotDataset),
        shouldLoadTikTok
          ? withDashboardProviderTimeout(
              syncTikTokAdsSnapshotDataset({ ...rangeParams, force: true, minFreshMinutes: 0 }).then((payload) => ({ rows: payload.rows || [] })),
              'TikTok Ads',
              DASHBOARD_API_SYNC_TIMEOUT_MS,
            )
          : Promise.resolve(emptySnapshotDataset),
      ]);
    };

    const loadApiAdsMetrics = async () => {
      if (forceRefresh) {
        setApiAdsStatus('loading');
      }
      apiRequestInFlightRef.current = true;

      try {
        const storedResults = await loadStoredSnapshots();
        if (cancelled) return;
        const storedApplyResult = applySettledSnapshotResults(storedResults, { cacheResult: true, mode: 'stored' });

        if (forceRefresh) {
          const syncedResults = await syncSnapshots();
          if (cancelled) return;
          applySettledSnapshotResults(syncedResults, {
            cacheResult: true,
            keepExistingWhenEmpty: storedApplyResult.hasUsefulData,
            mode: 'sync',
          });
        }
      } catch {
        if (cancelled) return;
        if (!cachedSnapshot) {
          setApiAdsMetrics({});
          setApiAdsByDateAccount({});
          setApiLoadDiagnostics(createEmptyApiLoadDiagnostics());
          setApiAdsStatus('error');
        }
      } finally {
        if (!cancelled) apiRequestInFlightRef.current = false;
      }
    };

    loadApiAdsMetrics();

    return () => {
      cancelled = true;
    };
	  }, [adAccountCsLookup, adAccountLookup, adAccountMappingCacheKey, adAccountOwnerLookup, apiRefreshNonce, apiSnapshotRefreshNonce, isOperationalDataLoading, platforms, rangeParams, scopedApiPlatformKeys]);

  const spamScopeInputs = useMemo(() => {
    if (!rangeParams) return [];

    return leadSpamDailyInputs.filter((item) => {
      if (!item.inputDate || item.inputDate < rangeParams.from || item.inputDate > rangeParams.to) return false;
      if (targetId && item.csId !== targetId) return false;
      if (targetPlatformId && item.platformId !== targetPlatformId) return false;
      return true;
    });
  }, [leadSpamDailyInputs, rangeParams, targetId, targetPlatformId]);

  const spamInputRows = useMemo(() => {
    const userNameById = new Map(users.map((user) => [user.id, user.name]));
    const platformNameById = new Map(platforms.map((platform) => [platform.id, platform.name]));

    return spamScopeInputs
      .map((item) => ({
        ...item,
        csName: userNameById.get(item.csId) || 'CS tidak ditemukan',
        platformName: platformNameById.get(item.platformId) || 'Platform tidak ditemukan',
        advertiserName: userNameById.get(item.advertiserId) || 'Advertiser tidak ditemukan',
      }))
      .sort((left, right) => {
        const dateCompare = right.inputDate.localeCompare(left.inputDate);
        if (dateCompare !== 0) return dateCompare;
        const csCompare = left.csName.localeCompare(right.csName, 'id-ID');
        if (csCompare !== 0) return csCompare;
        return left.advertiserName.localeCompare(right.advertiserName, 'id-ID');
      });
  }, [platforms, spamScopeInputs, users]);

  const spamByDate = useMemo(() => {
    const grouped: Record<string, number> = {};

    for (const item of spamScopeInputs) {
      grouped[item.inputDate] = (grouped[item.inputDate] || 0) + (Number(item.spamCount) || 0);
    }

    return grouped;
  }, [spamScopeInputs]);

  const detailRows = useMemo(() => {
    if (!rangeParams) return [];

    const userName = new Map(users.map((user) => [user.id, user.name]));
    const platformName = new Map(platforms.map((platform) => [platform.id, platform.name]));
    const subChannelName = new Map(subChannels.map((subChannel) => [subChannel.id, subChannel.name]));
    const activeAdAccounts = adAccounts.filter(
      (account) =>
        isActiveDataStatus(account.status) &&
        (!targetPlatformId || account.platformId === targetPlatformId),
    );
    const activeAdAccountById = new Map(activeAdAccounts.map((account) => [account.id, account]));

    type DetailRow = {
      accountId: string;
      date: string;
      advertiserName: string;
      csName: string;
      platformKey: string;
      platformName: string;
      subChannelName: string;
      accountName: string;
      spendDashboard: number;
      spendTotal: number;
      leadsDash: number;
      leadsReal: number;
      spam: number;
      spamRate: number;
      orders: number;
      scheduled: number;
      done: number;
      cancelled: number;
      revenue: number;
      orderRate: number;
      cprClosing: number;
      cprClosingTotal: number;
      costPerDone: number;
      costPerDoneTotal: number;
      roas: number;
      roasTotal: number;
      cpl: number;
      cplTotal: number;
      source: 'api' | 'connected' | 'operational';
    };

    type AssignedAccountGroup = {
      date: string;
      account: (typeof activeAdAccounts)[number];
      advertiserId: string;
      assignment: ReturnType<typeof adAccountCsLookup.resolveAssignment>;
      apiMetrics: CsAdsAccountMetric[];
      operationalAds: typeof csPerformanceAds;
      leads: typeof leads;
      orders: typeof orders;
    };

    const groups = new Map<string, AssignedAccountGroup>();
    const getDateRange = () => eachDayOfInterval({
      start: parseISO(`${rangeParams.from}T00:00:00`),
      end: parseISO(`${rangeParams.to}T00:00:00`),
    }).map((date) => format(date, 'yyyy-MM-dd'));
    const dates = getDateRange();
    const getGroup = (date: string, account: (typeof activeAdAccounts)[number]) => {
      const advertiserId = adAccountOwnerLookup.resolveOwner(account.id, date)?.advertiserId || account.advertiserId || '';
      const assignment = adAccountCsLookup.resolveAssignment(account.id, date);
      if (targetId && assignment?.csId !== targetId) return null;

      const key = `${date}::${account.id}`;
      const current = groups.get(key) || {
        date,
        account,
        advertiserId,
        assignment,
        apiMetrics: [],
        operationalAds: [],
        leads: [],
        orders: [],
      };
      groups.set(key, current);
      return current;
    };

    for (const metric of Object.values(apiAdsByDateAccount)) {
      if (metric.date < rangeParams.from || metric.date > rangeParams.to) continue;
      if (!metric.adAccountId) continue;
      const account = activeAdAccountById.get(metric.adAccountId);
      if (!account) continue;
      const group = getGroup(metric.date, account);
      if (!group) continue;
      group.apiMetrics.push(metric);
    }

    for (const ad of csPerformanceAds) {
      if (!ad.date || ad.date < rangeParams.from || ad.date > rangeParams.to) continue;
      if (targetPlatformId && ad.platformId !== targetPlatformId) continue;
      const account = activeAdAccountById.get(ad.adAccountId);
      if (!account) continue;
      const group = getGroup(ad.date, account);
      if (!group) continue;
      group.operationalAds.push(ad);
    }

    const candidatesByScope = new Map<string, AssignedAccountGroup[]>();
    const getScopeKey = (date: string, advertiserId?: string | null, platformId?: string | null, csId?: string | null) =>
      `${date}::${advertiserId || 'none'}::${platformId || 'none'}::${csId || 'none'}`;
    const candidatesByOperationalScope = new Map<string, AssignedAccountGroup[]>();
    const getOperationalScopeKey = (date: string, platformId?: string | null, csId?: string | null) =>
      `${date}::${platformId || 'none'}::${csId || 'none'}`;
    const candidatesByCsScope = new Map<string, AssignedAccountGroup[]>();
    const getCsScopeKey = (date: string, csId?: string | null) =>
      `${date}::${csId || 'none'}`;
    const registerCandidate = (
      collection: Map<string, AssignedAccountGroup[]>,
      key: string,
      group: AssignedAccountGroup,
    ) => {
      const current = collection.get(key) || [];
      if (!current.some((item) => item.account.id === group.account.id && item.date === group.date)) {
        current.push(group);
        collection.set(key, current);
      }
    };
    const registerGroupScopes = (
      group: AssignedAccountGroup,
      advertiserId?: string | null,
      platformId?: string | null,
      csId?: string | null,
    ) => {
      registerCandidate(candidatesByScope, getScopeKey(group.date, advertiserId, platformId, csId), group);
      registerCandidate(candidatesByOperationalScope, getOperationalScopeKey(group.date, platformId, csId), group);
      registerCandidate(candidatesByCsScope, getCsScopeKey(group.date, csId), group);
    };
    const spamByScope = new Map<string, number>();
    for (const item of spamScopeInputs) {
      const key = getScopeKey(item.inputDate, item.advertiserId, item.platformId, item.csId);
      spamByScope.set(key, (spamByScope.get(key) || 0) + (Number(item.spamCount) || 0));
    }

    for (const date of dates) {
      for (const account of activeAdAccounts) {
        const group = getGroup(date, account);
        if (!group) continue;
        registerGroupScopes(group, group.advertiserId, account.platformId, group.assignment?.csId);
      }
    }

    for (const group of groups.values()) {
      for (const ad of group.operationalAds) {
        registerGroupScopes(group, ad.advertiserId, ad.platformId, ad.csId);
      }
    }

    const selectBestGroup = (
      candidates: AssignedAccountGroup[] | undefined,
      subChannelId?: string | null,
    ) => {
      if (!candidates?.length) return null;

      const getAttributionSignal = (group: AssignedAccountGroup) =>
        group.apiMetrics.reduce(
          (sum, metric) => sum + (Number(metric.spend) || 0) + ((Number(metric.leads) || 0) * 100000),
          0,
        ) +
        group.operationalAds.reduce(
          (sum, ad) => sum + (Number(ad.amountSpent) || 0) + ((Number(ad.leadsDashboard) || 0) * 100000),
          0,
        );
      const byBestSignal = (left: AssignedAccountGroup, right: AssignedAccountGroup) => {
        const signalDelta = getAttributionSignal(right) - getAttributionSignal(left);
        if (signalDelta !== 0) return signalDelta;
        return left.account.accountName.localeCompare(right.account.accountName, 'id-ID', { numeric: true });
      };
      const chooseBest = (items: AssignedAccountGroup[]) => [...items].sort(byBestSignal)[0];

      const exactSubChannelCandidates = subChannelId
        ? candidates.filter((group) => group.assignment?.subChannelId === subChannelId)
        : [];
      if (exactSubChannelCandidates.length > 0) return chooseBest(exactSubChannelCandidates);

      const candidatesWithActivity = candidates.filter((group) => getAttributionSignal(group) > 0);
      if (candidatesWithActivity.length > 0) return chooseBest(candidatesWithActivity);

      const defaultSubChannelCandidates = candidates.filter((group) => !group.assignment?.subChannelId);
      if (defaultSubChannelCandidates.length > 0) return chooseBest(defaultSubChannelCandidates);

      return chooseBest(candidates);
    };

    const getLeadDate = (lead: (typeof leads)[number]) => lead.timestamp?.slice(0, 10) || '';

    for (const order of orders) {
      const date = getOrderDateKey(order);
      if (!date || date < rangeParams.from || date > rangeParams.to) continue;
      if (targetId && order.csId !== targetId) continue;
      if (targetPlatformId && order.platformId !== targetPlatformId) continue;

      const directGroup = order.adAccountId
        ? groups.get(`${date}::${order.adAccountId}`)
        : null;
      const candidates = candidatesByScope.get(getScopeKey(date, order.advertiserId, order.platformId, order.csId));
      const fallbackCandidates = candidatesByOperationalScope.get(getOperationalScopeKey(date, order.platformId, order.csId));
      const csFallbackCandidates = order.csId ? candidatesByCsScope.get(getCsScopeKey(date, order.csId)) : undefined;
      const group =
        directGroup ||
        selectBestGroup(candidates, order.subChannelId) ||
        selectBestGroup(fallbackCandidates, order.subChannelId) ||
        selectBestGroup(csFallbackCandidates, order.subChannelId);
      if (!group) continue;
      group.orders.push(order);
    }

    for (const lead of leads) {
      const date = getLeadDate(lead);
      if (!date || date < rangeParams.from || date > rangeParams.to) continue;
      if (targetId && lead.csId !== targetId) continue;
      if (targetPlatformId && lead.platformId !== targetPlatformId) continue;

      const directGroup = (lead as { adAccountId?: string }).adAccountId
        ? groups.get(`${date}::${(lead as { adAccountId?: string }).adAccountId}`)
        : null;
      const candidates = candidatesByScope.get(getScopeKey(date, lead.advertiserId, lead.platformId, lead.csId));
      const fallbackCandidates = candidatesByOperationalScope.get(getOperationalScopeKey(date, lead.platformId, lead.csId));
      const csFallbackCandidates = lead.csId ? candidatesByCsScope.get(getCsScopeKey(date, lead.csId)) : undefined;
      const group =
        directGroup ||
        selectBestGroup(candidates, lead.subChannelId) ||
        selectBestGroup(fallbackCandidates, lead.subChannelId) ||
        selectBestGroup(csFallbackCandidates, lead.subChannelId);
      if (!group) continue;
      group.leads.push(lead);
    }

    const getGroupActivityScore = (group: AssignedAccountGroup) =>
      group.apiMetrics.reduce((sum, metric) => sum + metric.spend + metric.leads, 0) +
      group.operationalAds.reduce(
        (sum, ad) => sum + (Number(ad.amountSpent) || 0) + (Number(ad.leadsDashboard) || 0),
        0,
      ) +
      group.leads.length +
      group.orders.length;
    const shouldAttachScopeSpam = (group: AssignedAccountGroup) => {
      const scopeKey = getScopeKey(
        group.date,
        group.advertiserId,
        group.account.platformId,
        group.assignment?.csId,
      );
      const candidates = candidatesByScope.get(scopeKey);
      if (!candidates?.length) return false;

      const selected = [...candidates].sort((left, right) => {
        const scoreDelta = getGroupActivityScore(right) - getGroupActivityScore(left);
        if (scoreDelta !== 0) return scoreDelta;
        return left.account.accountName.localeCompare(right.account.accountName, 'id-ID');
      })[0];

      return selected.account.id === group.account.id;
    };

    const rows: DetailRow[] = [];
    for (const group of groups.values()) {
      const operationalSpendDashboard = group.operationalAds.reduce((sum, ad) => sum + (Number(ad.amountSpent) || 0), 0);
      const operationalSpendTotal = group.operationalAds.reduce(
        (sum, ad) => sum + (Number(ad.amountSpent) || 0) + (Number(ad.ppnAmount) || 0) + (Number(ad.feeAmount) || 0),
        0,
      );
      const operationalLeadsDashboard = group.operationalAds.reduce((sum, ad) => sum + (Number(ad.leadsDashboard) || 0), 0);
      const spendDashboard = operationalSpendDashboard;
      const spendTotal = operationalSpendTotal;
      const leadsDashboard = operationalLeadsDashboard;
      const completedOrders = group.orders.filter((order) => order.status === 'done');
      const revenue = completedOrders.reduce((sum, order) => sum + (order.income || order.price || 0), 0);
      const orderCount = group.orders.length;
      const doneCount = completedOrders.length;
      const spamCount = spamByScope.get(getScopeKey(
        group.date,
        group.advertiserId,
        group.account.platformId,
        group.assignment?.csId,
      )) || 0;
      const rowSpamCount = shouldAttachScopeSpam(group) ? spamCount : 0;

      const detailRow: DetailRow = {
        accountId: group.account.id,
        date: group.date,
        advertiserName: userName.get(group.advertiserId || '') || 'Advertiser belum terdaftar',
        csName: group.assignment?.csId
          ? userName.get(group.assignment.csId) || 'CS belum terdaftar'
          : 'CS belum diatur',
        platformKey: group.apiMetrics[0]?.platformKey || resolvePlatformKey(platformName.get(group.account.platformId || '')),
        platformName: platformName.get(group.account.platformId || '') || 'Platform belum terdaftar',
        subChannelName: group.assignment?.subChannelId
          ? subChannelName.get(group.assignment.subChannelId) || 'Subchannel belum terdaftar'
          : '',
        accountName: group.account.accountName,
        spendDashboard,
        spendTotal,
        leadsDash: leadsDashboard,
        leadsReal: group.leads.length,
        spam: rowSpamCount,
        spamRate: leadsDashboard > 0 ? (rowSpamCount / leadsDashboard) * 100 : 0,
        orders: orderCount,
        scheduled: group.orders.filter((order) => order.status === 'pending').length,
        done: doneCount,
        cancelled: group.orders.filter((order) => order.status === 'cancelled').length,
        revenue,
        orderRate: leadsDashboard > 0 ? (orderCount / leadsDashboard) * 100 : 0,
        cprClosing: orderCount > 0 ? spendDashboard / orderCount : 0,
        cprClosingTotal: orderCount > 0 ? spendTotal / orderCount : 0,
        costPerDone: doneCount > 0 ? spendDashboard / doneCount : 0,
        costPerDoneTotal: doneCount > 0 ? spendTotal / doneCount : 0,
        roas: spendDashboard > 0 ? revenue / spendDashboard : 0,
        roasTotal: spendTotal > 0 ? revenue / spendTotal : 0,
        cpl: leadsDashboard > 0 ? spendDashboard / leadsDashboard : 0,
        cplTotal: leadsDashboard > 0 ? spendTotal / leadsDashboard : 0,
        source: group.operationalAds.length > 0 ? 'operational' : 'api',
      };

      if (
        detailRow.spendDashboard > 0 ||
        detailRow.leadsDash > 0 ||
        detailRow.leadsReal > 0 ||
        detailRow.orders > 0 ||
        detailRow.spam > 0
      ) {
        rows.push(detailRow);
      }
    }

    return rows.sort((left, right) => {
      if (right.date !== left.date) return right.date.localeCompare(left.date);
      const leftUnassigned = left.csName === 'CS belum diatur';
      const rightUnassigned = right.csName === 'CS belum diatur';
      if (leftUnassigned !== rightUnassigned) return leftUnassigned ? 1 : -1;
      if (left.csName !== right.csName) return left.csName.localeCompare(right.csName);
      return right.spendTotal - left.spendTotal;
    });
  }, [
    apiAdsByDateAccount,
    adAccountCsLookup,
    adAccountOwnerLookup,
    adAccounts,
    csPerformanceAds,
    leads,
    orders,
    platforms,
    rangeParams,
    spamScopeInputs,
    subChannels,
    targetId,
    targetPlatformId,
    users,
  ]);

  const csKpis = useMemo(() => {
    const activeAccountIds = new Set<string>();
    const mappedAccountIds = new Set<string>();
    let prospects = 0;
    let orders = 0;
    let activeOrders = 0;
    let done = 0;
    let cancelled = 0;
    let spendDashboard = 0;
    let spendTotal = 0;
    let leadsDashboard = 0;
    let revenue = 0;
    const spamCount = spamScopeInputs.reduce((sum, item) => sum + (Number(item.spamCount) || 0), 0);

    for (const row of detailRows) {
      activeAccountIds.add(row.accountId);
      if (row.csName !== 'CS belum diatur') {
        mappedAccountIds.add(row.accountId);
      }

      prospects += row.leadsReal;
      orders += row.orders;
      activeOrders += Math.max(0, row.orders - row.done - row.cancelled);
      done += row.done;
      cancelled += row.cancelled;
      spendDashboard += row.spendDashboard;
      spendTotal += row.spendTotal;
      leadsDashboard += row.leadsDash;
      revenue += row.revenue;
    }

    return {
      accountCount: activeAccountIds.size,
      mappedAccountCount: mappedAccountIds.size,
      prospects,
      orders,
      activeOrders,
      done,
      cancelled,
      spendDashboard,
      spendTotal,
      leadsDashboard,
      revenue,
      spamCount,
      spamRate: leadsDashboard > 0 ? (spamCount / leadsDashboard) * 100 : 0,
      conversionRate: leadsDashboard > 0 ? (orders / leadsDashboard) * 100 : 0,
      cprDashboard: leadsDashboard > 0 ? spendDashboard / leadsDashboard : 0,
      cprDashboardTotal: leadsDashboard > 0 ? spendTotal / leadsDashboard : 0,
      costPerClosing: orders > 0 ? spendDashboard / orders : 0,
      costPerClosingTotal: orders > 0 ? spendTotal / orders : 0,
      costPerDone: done > 0 ? spendDashboard / done : 0,
      costPerDoneTotal: done > 0 ? spendTotal / done : 0,
      roas: spendDashboard > 0 ? revenue / spendDashboard : 0,
      roasTotal: spendTotal > 0 ? revenue / spendTotal : 0,
    };
  }, [detailRows, spamScopeInputs]);
  const csPerformanceBreakdowns = useMemo(() => {
    type BreakdownRow = {
      key: string;
      label: string;
      secondary?: string;
      platformKey?: string;
      spendDashboard: number;
      spendTotal: number;
      leadsDash: number;
      leadsReal: number;
      spam: number;
      orders: number;
      done: number;
      revenue: number;
      cprClosing: number;
      cprDone: number;
      roas: number;
    };

    type BreakdownGroup = {
      title: string;
      totals: {
        spendDashboard: number;
        leadsDash: number;
        leadsReal: number;
        orders: number;
        done: number;
        cprClosing: number;
        cprDone: number;
      };
      rows: BreakdownRow[];
    };

    const buildBreakdown = (
      title: string,
      getKey: (row: (typeof detailRows)[number]) => string,
      getLabel: (row: (typeof detailRows)[number]) => string,
      getSecondary?: (row: (typeof detailRows)[number]) => string | undefined,
      getPlatformKey?: (row: (typeof detailRows)[number]) => string | undefined,
    ): BreakdownGroup => {
      const groups = new Map<string, BreakdownRow>();

      for (const row of detailRows) {
        const key = getKey(row);
        const current = groups.get(key) || {
          key,
          label: getLabel(row),
          secondary: getSecondary?.(row),
          platformKey: getPlatformKey?.(row),
          spendDashboard: 0,
          spendTotal: 0,
          leadsDash: 0,
          leadsReal: 0,
          spam: 0,
          orders: 0,
          done: 0,
          revenue: 0,
          cprClosing: 0,
          cprDone: 0,
          roas: 0,
        };

        current.spendDashboard += row.spendDashboard;
        current.spendTotal += row.spendTotal;
        current.leadsDash += row.leadsDash;
        current.leadsReal += row.leadsReal;
        current.spam += row.spam;
        current.orders += row.orders;
        current.done += row.done;
        current.revenue += row.revenue;
        current.secondary = current.secondary || getSecondary?.(row);
        current.platformKey = current.platformKey || getPlatformKey?.(row);
        groups.set(key, current);
      }

      const rows = Array.from(groups.values()).map((row) => ({
        ...row,
        cprClosing: row.orders > 0 ? row.spendDashboard / row.orders : 0,
        cprDone: row.done > 0 ? row.spendDashboard / row.done : 0,
        roas: row.spendDashboard > 0 ? row.revenue / row.spendDashboard : 0,
      }));
      const visibleRows = rows.filter(
        (row) =>
          row.spendDashboard > 0 ||
          row.leadsDash > 0 ||
          row.leadsReal > 0 ||
          row.orders > 0 ||
          row.spam > 0,
      );
      const totals = visibleRows.reduce((acc, row) => ({
        spendDashboard: acc.spendDashboard + row.spendDashboard,
        leadsDash: acc.leadsDash + row.leadsDash,
        leadsReal: acc.leadsReal + row.leadsReal,
        orders: acc.orders + row.orders,
        done: acc.done + row.done,
        cprClosing: 0,
        cprDone: 0,
      }), {
        spendDashboard: 0,
        leadsDash: 0,
        leadsReal: 0,
        orders: 0,
        done: 0,
        cprClosing: 0,
        cprDone: 0,
      });

      return {
        title,
        totals: {
          ...totals,
          cprClosing: totals.orders > 0 ? totals.spendDashboard / totals.orders : 0,
          cprDone: totals.done > 0 ? totals.spendDashboard / totals.done : 0,
        },
        rows: visibleRows.sort((left, right) => {
          const leftCpr = left.cprDone > 0 ? left.cprDone : left.cprClosing > 0 ? left.cprClosing : Number.MAX_SAFE_INTEGER;
          const rightCpr = right.cprDone > 0 ? right.cprDone : right.cprClosing > 0 ? right.cprClosing : Number.MAX_SAFE_INTEGER;
          if (leftCpr !== rightCpr) return leftCpr - rightCpr;
          if (right.done !== left.done) return right.done - left.done;
          if (right.orders !== left.orders) return right.orders - left.orders;
          return right.spendDashboard - left.spendDashboard;
        }),
      };
    };

    return [
      buildBreakdown('Advertiser', (row) => row.advertiserName, (row) => row.advertiserName),
      buildBreakdown('CS', (row) => row.csName, (row) => row.csName),
      buildBreakdown(
        'Platform',
        (row) => row.platformName,
        (row) => row.platformName,
        undefined,
        (row) => row.platformKey,
      ),
      buildBreakdown(
        'Akun Iklan',
        (row) => row.accountId,
        (row) => row.accountName,
        (row) => `${row.platformName} / ${row.csName}`,
        (row) => row.platformKey,
      ),
    ];
  }, [detailRows]);

  const toggleCprBreakdown = React.useCallback((title: string) => {
    setExpandedCprBreakdowns((current) =>
      current.includes(title)
        ? current.filter((item) => item !== title)
        : [...current, title],
    );
  }, []);

  const hasVisibleApiData = useMemo(
    () => detailRows.some((row) => row.spendDashboard > 0 || row.leadsDash > 0),
    [detailRows],
  );
  const isPerformanceDbHydrating = isPerformanceRangeLoading && !hasVisibleApiData;
  const isApiSyncBusy = apiAdsStatus === 'loading' || isApiDailySyncing;
  const isApiLoading = isApiSyncBusy || isPerformanceDbHydrating;
  const hasOperationalVisibleRows = detailRows.length > 0;
  const isApiScopeMismatch = apiAdsStatus === 'ready' && detailRows.length > 0 && !hasVisibleApiData;
  const shouldHighlightUnmappedApi = apiAdsStatus !== 'loading' && apiAdsStatus !== 'error' && apiLoadDiagnostics.unmatchedRows.length > 0;
  const resolvedApiStatusClassName = shouldHighlightUnmappedApi || isApiScopeMismatch
    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
    : isApiLoading || isApiDailySyncing
      ? apiStatusClassName('loading')
      : apiAdsStatus === 'error'
        ? apiStatusClassName('error')
        : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300';
  const resolvedApiStatusLabel = shouldHighlightUnmappedApi || isApiScopeMismatch
    ? 'Perlu mapping'
    : isPerformanceDbHydrating
      ? 'Memuat DB'
      : apiAdsStatus === 'loading' || isApiDailySyncing
      ? 'Sinkronisasi'
      : apiAdsStatus === 'error'
        ? getApiStatusLabel('error')
        : hasOperationalVisibleRows || apiAdsStatus === 'idle' || apiAdsStatus === 'ready'
          ? 'Data DB'
          : 'Belum ada data';
  const csDashboardMappingNotices = useMemo(() => {
    const canOpenMasterData = hasPermission('master_data.view');
    const notices: Array<{
      key: string;
      title: string;
      detail: string;
      href: string;
      actionLabel: string;
      tone: 'danger' | 'warning';
    }> = [];
    const buildHref = (
      view: 'api' | 'unmatched' | 'assignment',
      options?: {
        action?: string;
        platform?: string | null;
        externalAccountId?: string | null;
        q?: string | null;
      },
    ) => {
      const params = new URLSearchParams({ tab: 'ad-accounts', view });
      if (options?.action) params.set('action', options.action);
      if (options?.platform) params.set('platform', options.platform);
      if (options?.externalAccountId) params.set('externalAccountId', options.externalAccountId);
      if (options?.q) params.set('q', options.q);
      return `/master-data?${params.toString()}`;
    };
    const unmatchedAccountSummaries = Array.from(
      apiLoadDiagnostics.unmatchedRows.reduce((map, row) => {
        const key = `${row.source}:${row.externalAccountId || normalizeLookupKey(row.externalAccountName) || 'unknown'}`;
        const current = map.get(key) || {
          source: row.source,
          externalAccountId: row.externalAccountId,
          externalAccountName: row.externalAccountName,
          spend: 0,
          conversions: 0,
        };
        current.spend += Number(row.spend) || 0;
        current.conversions += Number(row.conversions) || 0;
        map.set(key, current);
        return map;
      }, new Map<string, {
        source: string;
        externalAccountId?: string | null;
        externalAccountName?: string | null;
        spend: number;
        conversions: number;
      }>()).values(),
    ).sort((left, right) => right.spend - left.spend || right.conversions - left.conversions);
    const primaryUnmatchedAccount = unmatchedAccountSummaries[0];
    const unassignedRows = detailRows.filter((row) => row.csName === 'CS belum diatur');
    const failedSources = apiLoadDiagnostics.failedSources.map((source) => source.toUpperCase()).join(', ');

    if (apiAdsStatus === 'error') {
      const canStillUseOperationalData = hasOperationalVisibleRows || csKpis.prospects > 0 || csKpis.orders > 0;
      notices.push({
        key: 'api-error',
        title: canStillUseOperationalData ? 'API iklan belum sinkron' : 'Snapshot API iklan gagal dimuat',
        detail: canStillUseOperationalData
          ? 'Data operasional tetap tampil. Spending dan Lead Dashboard menunggu snapshot API iklan berhasil dimuat.'
          : 'Spending dan Lead Dashboard belum bisa dihitung. Cek integrasi API dan refresh snapshot iklan.',
        href: buildHref('api'),
        actionLabel: 'Buka Integrasi API',
        tone: canStillUseOperationalData ? 'warning' : 'danger',
      });
    } else if (apiLoadDiagnostics.failedSources.length > 0) {
      notices.push({
        key: 'api-partial',
        title: 'Sebagian API iklan gagal dimuat',
        detail: `${failedSources} gagal dimuat. Angka yang tampil hanya dari source API yang berhasil.`,
        href: buildHref('api'),
        actionLabel: 'Buka Integrasi API',
        tone: 'warning',
      });
    }

    if (unmatchedAccountSummaries.length > 0) {
      const primaryLabel = primaryUnmatchedAccount.externalAccountName
        || primaryUnmatchedAccount.externalAccountId
        || 'Akun API tanpa nama';
      const primaryMetrics = [
        `Spend ${formatShortCurrency(primaryUnmatchedAccount.spend)}`,
        `Lead ${formatCount(primaryUnmatchedAccount.conversions)}`,
      ].join(', ');

      notices.push({
        key: 'api-unmatched',
        title: 'Ada snapshot API belum match ke akun internal',
        detail: unmatchedAccountSummaries.length === 1
          ? `${primaryLabel} (${primaryUnmatchedAccount.source.toUpperCase()} / ${primaryUnmatchedAccount.externalAccountId || 'ID belum ada'}) belum cocok ke akun internal aktif. ${primaryMetrics}.`
          : `${formatCount(unmatchedAccountSummaries.length)} akun API punya spend/lead, termasuk ${primaryLabel}. Cek pairing ke master Akun Iklan aktif.`,
        href: buildHref('unmatched', {
          action: 'pair-api',
          platform: primaryUnmatchedAccount.source,
          externalAccountId: primaryUnmatchedAccount.externalAccountId,
          q: primaryLabel,
        }),
        actionLabel: 'Cek Belum Match API',
        tone: 'warning',
      });
    }

    if (unassignedRows.length > 0) {
      notices.push({
        key: 'cs-assignment',
        title: 'Ada akun iklan belum punya assignment CS',
        detail: `${formatCount(unassignedRows.length)} baris performa jatuh ke "CS belum diatur". Lengkapi assignment agar filter CS akurat.`,
        href: buildHref('assignment'),
        actionLabel: 'Cek Assignment CS',
        tone: 'warning',
      });
    }

    if (apiAdsStatus === 'empty' && csKpis.prospects > 0) {
      notices.push({
        key: 'api-empty-with-crm',
        title: 'Prospek CRM ada, tapi snapshot iklan kosong',
        detail: `Prospek CRM terbaca ${formatCount(csKpis.prospects)}, namun Lead Dashboard dari API iklan masih 0.`,
        href: buildHref('api'),
        actionLabel: 'Cek Snapshot API',
        tone: 'warning',
      });
    }

    return notices.map((notice) => ({
      ...notice,
      href: canOpenMasterData ? notice.href : '',
      actionLabel: canOpenMasterData ? notice.actionLabel : 'Hubungi admin',
    }));
  }, [
    apiAdsStatus,
    apiLoadDiagnostics.failedSources,
    apiLoadDiagnostics.unmatchedRows,
    csKpis.orders,
    csKpis.prospects,
    detailRows,
    hasOperationalVisibleRows,
    hasPermission,
  ]);
  const dateGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: string;
        rows: typeof detailRows;
        spendDashboard: number;
        spendTotal: number;
        leadsDash: number;
        leadsReal: number;
        orders: number;
        scheduled: number;
        done: number;
        cancelled: number;
        revenue: number;
        spam: number;
        spamRate: number;
        closingRate: number;
        cpl: number;
        cplTotal: number;
        cprClosing: number;
        cprClosingTotal: number;
        costPerDone: number;
        costPerDoneTotal: number;
        roas: number;
        roasTotal: number;
      }
    >();

    const ensureGroup = (date: string) => {
      const current = groups.get(date) || {
        date,
        rows: [],
        spendDashboard: 0,
        spendTotal: 0,
        leadsDash: 0,
        leadsReal: 0,
        orders: 0,
        scheduled: 0,
        done: 0,
        cancelled: 0,
        revenue: 0,
        spam: spamByDate[date] || 0,
        spamRate: 0,
        closingRate: 0,
        cpl: 0,
        cplTotal: 0,
        cprClosing: 0,
        cprClosingTotal: 0,
        costPerDone: 0,
        costPerDoneTotal: 0,
        roas: 0,
        roasTotal: 0,
      };
      groups.set(date, current);
      return current;
    };

    Object.keys(spamByDate).forEach((date) => {
      ensureGroup(date);
    });

    for (const row of detailRows) {
      const current = ensureGroup(row.date);

      current.rows.push(row);
      current.spendDashboard += row.spendDashboard;
      current.spendTotal += row.spendTotal;
      current.leadsDash += row.leadsDash;
      current.leadsReal += row.leadsReal;
      current.orders += row.orders;
      current.scheduled += row.scheduled;
      current.done += row.done;
      current.cancelled += row.cancelled;
      current.revenue += row.revenue;
      current.spam = spamByDate[row.date] || current.spam || 0;
      current.spamRate = current.leadsDash > 0 ? (current.spam / current.leadsDash) * 100 : 0;
      current.closingRate = current.leadsDash > 0 ? (current.orders / current.leadsDash) * 100 : 0;
      current.cpl = current.leadsDash > 0 ? current.spendDashboard / current.leadsDash : 0;
      current.cplTotal = current.leadsDash > 0 ? current.spendTotal / current.leadsDash : 0;
      current.cprClosing = current.orders > 0 ? current.spendDashboard / current.orders : 0;
      current.cprClosingTotal = current.orders > 0 ? current.spendTotal / current.orders : 0;
      current.costPerDone = current.done > 0 ? current.spendDashboard / current.done : 0;
      current.costPerDoneTotal = current.done > 0 ? current.spendTotal / current.done : 0;
      current.roas = current.spendDashboard > 0 ? current.revenue / current.spendDashboard : 0;
      current.roasTotal = current.spendTotal > 0 ? current.revenue / current.spendTotal : 0;
      groups.set(row.date, current);
    }

    for (const current of groups.values()) {
      current.spam = spamByDate[current.date] || current.spam || 0;
      current.spamRate = current.leadsDash > 0 ? (current.spam / current.leadsDash) * 100 : 0;
    }

    return Array.from(groups.values()).sort((left, right) => {
      const leftHasAdMetrics = left.spendDashboard > 0 || left.leadsDash > 0;
      const rightHasAdMetrics = right.spendDashboard > 0 || right.leadsDash > 0;
      if (leftHasAdMetrics !== rightHasAdMetrics) return leftHasAdMetrics ? -1 : 1;
      return right.date.localeCompare(left.date);
    });
  }, [detailRows, spamByDate]);
  React.useEffect(() => {
    setExpandedDateGroups(dateGroups.slice(0, 1).map((group) => group.date));
  }, [dateGroups]);
  const selectedCsLabel = targetId
    ? users.find((user) => user.id === targetId)?.name || 'CS terpilih'
    : 'Semua CS';
  const selectedPlatformLabel = targetPlatformId
    ? platformFilterOptions.find((platform) => platform.id === targetPlatformId)?.name || 'Platform terpilih'
    : 'Semua Platform';

  const handleSaveSpamInput = React.useCallback(async () => {
    if (!spamForm.inputDate || !spamForm.csId || !spamForm.platformId || !spamForm.advertiserId) {
      toast.error('Tanggal, CS, platform, dan advertiser wajib dipilih.');
      return;
    }

    const spamCount = Number.parseInt(spamForm.spamCount, 10);
    if (!Number.isFinite(spamCount) || spamCount < 0) {
      toast.error('Jumlah spam harus berupa angka 0 atau lebih.');
      return;
    }

    setIsSavingSpamInput(true);
    try {
      if (spamCount === 0) {
        if (spamForm.id) {
          await deleteLeadSpamDailyInput(spamForm.id);
          setIsSpamDialogOpen(false);
          setSpamForm(buildInitialSpamFormState());
          return;
        }

        toast.error('Jumlah spam harus diisi lebih dari 0 untuk membuat data baru.');
        return;
      }

      const payload = {
        id: spamForm.id || crypto.randomUUID(),
        inputDate: spamForm.inputDate,
        csId: spamForm.csId,
        platformId: spamForm.platformId,
        advertiserId: spamForm.advertiserId,
        spamCount,
        notes: spamForm.notes.trim() || undefined,
        createdBy: spamForm.id ? undefined : currentUser?.id,
        updatedBy: currentUser?.id || undefined,
      };

      if (spamForm.id) {
        await updateLeadSpamDailyInput(payload);
      } else {
        await addLeadSpamDailyInput(payload);
      }

      setIsSpamDialogOpen(false);
      setSpamForm(buildInitialSpamFormState());
    } catch (error) {
      console.error('Failed to save lead spam daily input:', error);
    } finally {
      setIsSavingSpamInput(false);
    }
  }, [
    addLeadSpamDailyInput,
    buildInitialSpamFormState,
    currentUser?.id,
    deleteLeadSpamDailyInput,
    spamForm.advertiserId,
    spamForm.csId,
    spamForm.id,
    spamForm.inputDate,
    spamForm.notes,
    spamForm.platformId,
    spamForm.spamCount,
    updateLeadSpamDailyInput,
  ]);

  const handleDeleteSpamInput = React.useCallback(async () => {
    if (!spamInputToDelete) return;

    try {
      await deleteLeadSpamDailyInput(spamInputToDelete);
      setSpamInputToDelete(null);
    } catch {
      // Error toast is handled by context mutation helpers.
    }
  }, [deleteLeadSpamDailyInput, spamInputToDelete]);

  return (
    <OperationalPageShell className="csDashboardPage">
      <OperationalPageHeader
        title="CS View"
        subtitle={`Ringkasan performa ${selectedCsLabel} pada ${selectedPlatformLabel} berdasarkan tanggal lead dashboard dan spend iklan.`}
        eyebrow="Dashboard"
        icon={Users}
      />

      <CsDashboardFilters
        expanded={isMobileFilterExpanded}
        onExpandedChange={setIsMobileFilterExpanded}
        activeFilterCount={activeFilterCount}
        period={<FoundationDateRangePicker date={dateRange} setDate={handleDateRangeChange} numberOfMonths={1} />}
        cs={isOwner ? (
          <Select value={selectedCsId} onValueChange={setSelectedCsId}>
            <SelectTrigger aria-label="Customer service">
              <SelectValue placeholder="Pilih CS" />
            </SelectTrigger>
            <SelectContent className="border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <SelectItem value="all">Semua CS</SelectItem>
              {users
                .filter(u => isCsRole(u.role) && u.status === 'active')
                .map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))
              }
            </SelectContent>
          </Select>
        ) : undefined}
        platform={(
          <Select value={selectedPlatformId} onValueChange={setSelectedPlatformId}>
            <SelectTrigger aria-label="Platform">
              <SelectValue placeholder="Pilih platform" />
            </SelectTrigger>
            <SelectContent className="border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <SelectItem value="all">Semua Platform</SelectItem>
              {platformFilterOptions.map((platform) => (
                <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        actions={canManageSpamInputs || canSyncAds ? (
          <>
            {canManageSpamInputs && (
              <Button
                type="button"
                variant="outline"
                className="gap-2 border-slate-200 bg-white shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                onClick={() => openSpamInputDialog()}
              >
                <Plus className="h-4 w-4" />
                Input Spam
              </Button>
            )}
            {canSyncAds && (
              <Button
                type="button"
                className="gap-2 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                disabled={!rangeParams || isApiSyncBusy}
                onClick={handleSyncAdsApiToDailyAds}
              >
                <RefreshCw className={`h-4 w-4 ${isApiSyncBusy ? 'animate-spin' : ''}`} />
                Sinkron sekarang
              </Button>
            )}
          </>
        ) : undefined}
      />

      <AdsSyncHistory isSyncing={isApiDailySyncing} />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CsViewTab)} className="csDashboardTabs space-y-4">
        <TabsViewport className="csDashboardTabsViewport">
          <TabsRail className="csDashboardTabsRail min-w-max">
            <TabsTrigger value="performance" className="px-4">Performa</TabsTrigger>
            <TabsTrigger value="spam-inputs" className="px-4">Input Spam</TabsTrigger>
          </TabsRail>
        </TabsViewport>

        <TabsContent value="performance" className="advertiserDashboardTabContent space-y-4">
      <OperationalKpiGrid className="advertiserDashboardKpiGrid advertiserDashboardCsKpiGrid">
        <OperationalKpiCard
          label="Spending"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-semibold foundationMetricValue foundationMetricValue--info">{formatShortCurrency(csKpis.spendDashboard)}</span>
              <span className={`foundationMetricSubValue ${csKpis.spendTotal > csKpis.spendDashboard ? 'foundationMetricSubValue--danger' : 'foundationMetricSubValue--warning'}`}>
                {formatShortCurrency(csKpis.spendTotal)}
              </span>
            </div>
            )
          }
          icon={TrendingUp}
          tone="blue"
        />
        <OperationalKpiCard
          label="Lead Dashboard"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-semibold foundationMetricValue foundationMetricValue--info">{formatCount(csKpis.leadsDashboard)}</span>
              <span className="foundationMetricSubValue foundationMetricSubValue--info">Prospek {formatCount(csKpis.prospects)}</span>
            </div>
            )
          }
          icon={Users}
          tone="blue"
        />
        <OperationalKpiCard
          label="Spam"
          value={
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-semibold foundationMetricValue foundationMetricValue--danger">{formatCount(csKpis.spamCount)}</span>
              <span className="invisible">-</span>
            </div>
          }
          icon={AlertTriangle}
          tone="rose"
        />
        <OperationalKpiCard
          label="Spam Rate"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton withSubValue={false} />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-semibold foundationMetricValue foundationMetricValue--warning">{formatPercentAllowZero(csKpis.spamRate)}</span>
              <span className="invisible">-</span>
            </div>
            )
          }
          icon={TrendingUp}
          tone="amber"
        />
        <OperationalKpiCard
          label="Cost/Lead"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className={`text-2xl font-semibold ${getCostPerLeadTextClass(csKpis.cprDashboard)}`}>{formatShortCurrency(csKpis.cprDashboard)}</span>
              <span>{formatShortCurrency(csKpis.cprDashboardTotal)}</span>
            </div>
            )
          }
          icon={CheckCircle}
          tone="emerald"
        />
        <OperationalKpiCard
          label="Closing"
          value={
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-semibold foundationMetricValue foundationMetricValue--success">{formatCount(csKpis.orders)}</span>
              <span className="foundationMetricSubValue foundationMetricSubValue--success">
                Selesai: {formatCount(csKpis.done)}
              </span>
              <span className="foundationMetricSubValue foundationMetricSubValue--success">
                Rate: {formatPercentAllowZero(csKpis.conversionRate)}
              </span>
            </div>
          }
          icon={ShoppingCart}
          tone="violet"
        />
        <OperationalKpiCard
          label="Cost/Closing"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className={`text-2xl font-semibold ${getCostIndicatorTextClass(csKpis.costPerClosing)}`}>{formatShortCurrency(csKpis.costPerClosing)}</span>
              <span>{formatShortCurrency(csKpis.costPerClosingTotal)}</span>
            </div>
            )
          }
          icon={ShoppingCart}
          tone="amber"
        />
        <OperationalKpiCard
          label="Cost/Selesai"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className={`text-2xl font-semibold ${getCostIndicatorTextClass(csKpis.costPerDone)}`}>{formatShortCurrency(csKpis.costPerDone)}</span>
              <span>{formatShortCurrency(csKpis.costPerDoneTotal)}</span>
            </div>
            )
          }
          icon={CheckCircle}
          tone="emerald"
        />
        <OperationalKpiCard
          label="ROAS"
          value={
            isPerformanceDbHydrating ? (
              <KpiMetricSkeleton withSubValue={false} />
            ) : (
            <div className="flex flex-col gap-1 text-sm font-normal text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-semibold text-slate-950 dark:text-slate-100">
                <RoasBadgeValue value={csKpis.roas} />
              </span>
              <span className="invisible">-</span>
            </div>
            )
          }
          icon={TrendingUp}
          tone="amber"
        />
      </OperationalKpiGrid>

      <div className="grid gap-4">
        <OperationalTableCard className="advertiserDashboardLegacyCprCard">
          <CardHeader className="advertiserDashboardLegacyCprHeader border-b border-slate-100 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <CardTitle className="text-base text-slate-800 dark:text-slate-100">Performa CPR Terbaik</CardTitle>
              <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
                Seluruh advertiser, CS, platform, dan akun iklan aktif berdasarkan CPR closing dan selesai dari filter aktif.
              </p>
            </div>
          </CardHeader>
          <div className="advertiserDashboardLegacyCprGrid grid grid-cols-1 gap-4 p-3 sm:p-5">
            {csPerformanceBreakdowns.map((breakdown) => {
              const isBreakdownExpanded = expandedCprBreakdowns.includes(breakdown.title);

              return (
                <div key={breakdown.title} className="advertiserDashboardLegacyCprPanel overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div
                    className="advertiserDashboardLegacyCprPanelHeader flex cursor-pointer flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleCprBreakdown(breakdown.title)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleCprBreakdown(breakdown.title);
                      }
                    }}
                    aria-expanded={isBreakdownExpanded}
                    aria-label={`${isBreakdownExpanded ? 'Tutup' : 'Buka'} Performa ${breakdown.title}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Performa {breakdown.title}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          Menampilkan {breakdown.rows.length} data aktif by CPR selesai
                        </div>
                      </div>
                    </div>
                    <div className="advertiserDashboardLegacyCprBadges grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:justify-end">
                      <div className="advertiserDashboardLegacyCprBadge rounded-md bg-cyan-50 px-2.5 py-1.5 dark:bg-cyan-950/30">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">Lead Dashboard</div>
                        <div className="mt-0.5 font-mono text-sm font-bold text-cyan-700 dark:text-cyan-300">{formatNumber(breakdown.totals.leadsDash)}</div>
                      </div>
                      <div className="advertiserDashboardLegacyCprBadge rounded-md bg-blue-50 px-2.5 py-1.5 dark:bg-blue-950/30">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Lead Real</div>
                        <div className="mt-0.5 font-mono text-sm font-bold text-blue-700 dark:text-blue-300">{formatNumber(breakdown.totals.leadsReal)}</div>
                      </div>
                      <div className="advertiserDashboardLegacyCprBadge rounded-md bg-violet-50 px-2.5 py-1.5 dark:bg-violet-950/30">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Closing</div>
                        <div className="mt-0.5 font-mono text-sm font-bold text-violet-700 dark:text-violet-300">{formatNumber(breakdown.totals.orders)}</div>
                      </div>
                      <div className="advertiserDashboardLegacyCprBadge rounded-md bg-emerald-50 px-2.5 py-1.5 dark:bg-emerald-950/30">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Done</div>
                        <div className="mt-0.5 font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">{formatNumber(breakdown.totals.done)}</div>
                      </div>
                    </div>
                  </div>
                  {isBreakdownExpanded && (breakdown.rows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] table-fixed text-xs">
                        <colgroup>
                          <col className="w-[230px]" />
                          <col className="w-[110px]" />
                          <col className="w-[75px]" />
                          <col className="w-[75px]" />
                          <col className="w-[110px]" />
                          <col className="w-[110px]" />
                          <col className="w-[75px]" />
                        </colgroup>
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-medium">{breakdown.title}</th>
                            <th className="px-3 py-2.5 text-right font-medium">Spend</th>
                            <th className="px-3 py-2.5 text-center font-medium">Closing</th>
                            <th className="px-3 py-2.5 text-center font-medium">Done</th>
                            <th className="px-3 py-2.5 text-right font-medium">CPR Closing</th>
                            <th className="px-3 py-2.5 text-right font-medium">CPR Selesai</th>
                            <th className="px-3 py-2.5 text-center font-medium">ROAS</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {breakdown.rows.map((row) => (
                            <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                              <td className="px-4 py-3 align-top">
                                <div className="flex min-w-0 items-start gap-2">
                                  {row.platformKey && (
                                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                                      <PlatformLogo platform={row.platformKey} size="sm" />
                                    </span>
                                  )}
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-slate-900 dark:text-slate-100" title={row.label}>
                                      {row.label}
                                    </div>
                                    {row.secondary && (
                                      <div className="mt-1 truncate text-[11px] text-slate-500" title={row.secondary}>
                                        {row.secondary}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right align-top font-mono font-semibold text-slate-900 dark:text-slate-100">
                                <SpendingCellValue
                                  spendDashboard={row.spendDashboard}
                                  spendTotal={row.spendTotal}
                                  subtleTotal
                                />
                              </td>
                              <td className="px-3 py-3 text-center align-top font-mono font-semibold text-violet-600">
                                {formatNumber(row.orders)}
                              </td>
                              <td className="px-3 py-3 text-center align-top">
                                <div className="font-mono font-semibold text-emerald-600">{formatNumber(row.done)}</div>
                                <div className="mt-1 font-mono text-[10px] text-slate-500">Lead {formatNumber(row.leadsDash)}</div>
                              </td>
                              <td className="px-3 py-3 text-right align-top font-mono font-semibold text-slate-900 dark:text-slate-100">
                                <CostIndicatorBadge value={row.cprClosing} />
                              </td>
                              <td className="px-3 py-3 text-right align-top font-mono font-semibold text-slate-900 dark:text-slate-100">
                                <CostIndicatorBadge value={row.cprDone} />
                              </td>
                              <td className="px-3 py-3 text-center align-top">
                                <RoasBadgeValue value={row.roas} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      Belum ada data real untuk kategori ini.
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </OperationalTableCard>

        <OperationalTableCard className="advertiserDashboardTableCard advertiserDashboardCsPerformanceCard">
          <CardHeader className="advertiserDashboardSectionHeader border-b border-slate-100 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base text-slate-800 dark:text-slate-100">Performa CS dan Iklan</CardTitle>
                <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
                  Monitoring read-only performa CS berdasarkan akun iklan advertiser, platform, dan periode aktif.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium ${resolvedApiStatusClassName}`}>
                  {(isApiLoading || isApiDailySyncing) && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {resolvedApiStatusLabel}
                </span>
                {canSyncAds && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 bg-white dark:bg-slate-900"
                    disabled={!rangeParams || isApiSyncBusy}
                    onClick={handleSyncAdsApiToDailyAds}
                  >
                    <RefreshCw className={`h-4 w-4 ${isApiSyncBusy ? 'animate-spin' : ''}`} />
                    Sinkron sekarang
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <div className="space-y-3 p-3 sm:p-5">
            <div className="advertiserDashboardScopeGrid grid gap-3 md:grid-cols-3">
              <div className="advertiserDashboardScopeCard rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">CS Termonitor</div>
                <div className="mt-2 font-semibold text-slate-900 dark:text-slate-100">
                  {targetId ? selectedCsLabel : `${spamCsOptions.length} CS`}
                </div>
              </div>
              <div className="advertiserDashboardScopeCard rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Platform</div>
                <div className="mt-2 font-semibold text-slate-900 dark:text-slate-100">
                  {selectedPlatformLabel}
                </div>
              </div>
              <div className="advertiserDashboardScopeCard rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Akun Iklan</div>
                <div className="mt-2 font-semibold text-slate-900 dark:text-slate-100">
                  {formatCount(csKpis.accountCount)} akun aktif
                </div>
              </div>
            </div>

            <div className={`advertiserDashboardMappingHealth ${csDashboardMappingNotices.length === 0 ? 'isClean' : 'hasIssues'}`}>
              <div className="advertiserDashboardMappingHealthHeader">
                {csDashboardMappingNotices.length === 0 ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <div>
                  <strong>
                    {csDashboardMappingNotices.length === 0 ? 'Mapping master data normal' : 'Perlu cek mapping master data'}
                  </strong>
                  <span>
                    {csDashboardMappingNotices.length === 0
                      ? 'Akun aktif, assignment, dan data iklan harian sudah terbaca untuk filter aktif.'
                      : 'Data master/API belum lengkap sehingga angka bisa kosong atau tidak teratribusi.'}
                  </span>
                </div>
              </div>

              {csDashboardMappingNotices.length > 0 && (
                <div className="advertiserDashboardMappingHealthItems">
                  {csDashboardMappingNotices.map((notice) => (
                    <div key={notice.key} className="advertiserDashboardMappingHealthItem">
                      <div className="advertiserDashboardMappingHealthItemLabel">{notice.title}</div>
                      <div className="advertiserDashboardMappingHealthItemValue">{notice.actionLabel}</div>
                      <div className="advertiserDashboardMappingHealthItemList">{notice.detail}</div>
                      {notice.href ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3 h-8 w-fit bg-white dark:bg-slate-900"
                          onClick={() => {
                            window.location.href = notice.href;
                          }}
                        >
                          {notice.actionLabel}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

                {isApiLoading && dateGroups.length === 0 ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="h-4 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="mt-4 grid grid-cols-2 gap-4">
                          <div className="h-3 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                          <div className="h-3 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : dateGroups.length > 0 ? (
                  dateGroups.map((group) => {
                    const isExpanded = expandedDateGroups.includes(group.date);

                    return (
                    <div key={group.date} className="csDashboardDateGroupFrame overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleDateGroup(group.date)}
                            className="csDashboardDateGroupButton w-full px-4 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70"
                          >
                            <div className="flex flex-col gap-4 lg:hidden">
                              <div className="flex items-start gap-3">
                                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-sm ${
                                  isExpanded
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                    : 'border-slate-200 bg-white text-slate-500'
                                }`}>
                                  <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                                </span>
                                <div className="min-w-0">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Tanggal</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-sm font-bold text-slate-950 dark:text-slate-100">
                                      {format(new Date(`${group.date}T00:00:00`), 'dd MMM yyyy', { locale: id })}
                                    </span>
                                    {group.date === format(new Date(), 'yyyy-MM-dd') && (
                                      <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                                        Today
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {format(new Date(`${group.date}T00:00:00`), 'EEEE', { locale: id })}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 grid grid-cols-2 gap-2">
                                <DailySummaryMetric
                                  label="Spend"
                                  primary={formatShortCurrency(group.spendDashboard)}
                                  secondary={formatShortCurrency(group.spendTotal)}
                                />
                                <DailySummaryMetric
                                  label="Lead Dashboard"
                                  primary={formatNumber(group.leadsDash)}
                                  secondary={`Prospek CRM: ${formatNumber(group.leadsReal)}`}
                                  tone="cyan"
                                />
                                <DailySummaryMetric
                                  label="Spam"
                                  primary={formatNumber(group.spam)}
                                  tone="red"
                                />
                                <DailySummaryMetric
                                  label="Spam Rate"
                                  primary={formatPercentAllowZero(group.spamRate)}
                                  tone="amber"
                                />
                                <DailySummaryMetric
                                  label="Order"
                                  primary={formatNumber(group.orders)}
                                  tone="blue"
                                />
                                <DailySummaryMetric
                                  label="Selesai"
                                  primary={formatNumber(group.done)}
                                  secondary={`Batal: ${formatNumber(group.cancelled)}`}
                                  tone="emerald"
                                />
                                <DailySummaryMetric
                                  label="Cost per Lead"
                                  primary={formatShortCurrency(group.cpl)}
                                  secondary={group.leadsDash > 0 ? formatShortCurrency(group.cplTotal) : undefined}
                                  tone={getCostPerLeadTone(group.cpl)}
                                />
                                <DailySummaryMetric
                                  label="Cost per Closing"
                                  primary={formatShortCurrency(group.cprClosing)}
                                  secondary={group.orders > 0 ? formatShortCurrency(group.cprClosingTotal) : undefined}
                                />
                                <DailySummaryMetric
                                  label="Revenue"
                                  primary={formatShortCurrency(group.revenue)}
                                />
                                <div className="rounded-md bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">ROAS</div>
                                  <div className="mt-1">
                                    <RoasBadgeValue value={group.roas} />
                                  </div>
                                  <div className="mt-1 font-mono text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                                    {group.roasTotal > 0 ? `${group.roasTotal.toFixed(2)}x` : '-'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2">
                                <DailyRateMetric value={group.closingRate} />
                              </div>
                            </div>

                            <div className="csDashboardDateSummary hidden items-stretch divide-x divide-slate-100 dark:divide-slate-800 lg:grid">
                              <div className="flex h-full min-w-0 items-center pr-3">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Tanggal</div>
                                  <div className="mt-1 truncate font-mono text-[14px] font-bold text-slate-950 dark:text-slate-100">
                                    {format(new Date(`${group.date}T00:00:00`), 'dd MMM yyyy', { locale: id })}
                                  </div>
                                  <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                    {format(new Date(`${group.date}T00:00:00`), 'EEEE', { locale: id })}
                                  </div>
                                </div>
                              </div>
                              <DailySummaryTableCell
                                label="Spend"
                                primary={formatShortCurrency(group.spendDashboard)}
                                secondary={formatShortCurrency(group.spendTotal)}
                              />
                              <DailySummaryTableCell
                                label="Lead Dash."
                                primary={formatNumber(group.leadsDash)}
                                secondary={`Prospek CRM: ${formatNumber(group.leadsReal)}`}
                                tone="cyan"
                              />
                              <DailySummaryTableCell
                                label="Spam"
                                primary={formatNumber(group.spam)}
                                secondary={formatPercentAllowZero(group.spamRate)}
                                tone="red"
                              />
                              <DailySummaryTableCell
                                label="Order"
                                primary={formatNumber(group.orders)}
                                secondary={`Selesai: ${formatNumber(group.done)}`}
                                tone="blue"
                              />
                              <DailySummaryTableCell
                                label="CPL"
                                primary={formatShortCurrency(group.cpl)}
                                secondary={group.leadsDash > 0 ? formatShortCurrency(group.cplTotal) : undefined}
                                tone={getCostPerLeadTone(group.cpl)}
                              />
                              <DailySummaryTableCell
                                label="CP Closing"
                                primary={formatShortCurrency(group.cprClosing)}
                                secondary={group.orders > 0 ? formatShortCurrency(group.cprClosingTotal) : undefined}
                              />
                              <DailySummaryTableCell
                                label="Revenue"
                                primary={formatShortCurrency(group.revenue)}
                              />
                              <div className="flex h-full min-w-0 flex-col justify-start px-2 pt-1.5 text-right">
                                <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">ROAS</div>
                                <div className="mt-1 inline-flex self-end">
                                  <RoasBadgeValue value={group.roas} />
                                </div>
                                <div className="mt-1 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                  {group.roasTotal > 0 ? `${group.roasTotal.toFixed(2)}x burn` : '-'}
                                </div>
                              </div>
                            </div>
                          </button>
                          <div className="hidden grid-cols-2 gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-800/60 md:grid-cols-4 xl:grid-cols-12">
                            <div>
                              <div className="text-slate-500">Tanggal</div>
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {format(new Date(`${group.date}T00:00:00`), 'dd MMM yyyy', { locale: id })}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {format(new Date(`${group.date}T00:00:00`), 'EEEE', { locale: id })}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500">Spend</div>
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatShortCurrency(group.spendDashboard)}</div>
                              <div className="mt-1 font-mono text-[11px] text-slate-500">{formatShortCurrency(group.spendTotal)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Lead Dashboard</div>
                              <div className="font-mono font-semibold text-cyan-600">{formatNumber(group.leadsDash)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Prospek CRM</div>
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatNumber(group.leadsReal)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Spam</div>
                              <div className="font-mono font-semibold text-red-600 dark:text-red-300">{formatNumber(group.spam)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Spam Rate</div>
                              <div className="font-mono font-semibold text-amber-500 dark:text-amber-300">{formatPercentAllowZero(group.spamRate)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Order</div>
                              <div className="font-mono font-semibold text-blue-600">{formatNumber(group.orders)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Konversi</div>
                              <div className={`font-mono font-semibold ${getConversionRateTextClass(group.closingRate)}`}>{formatPercent(group.closingRate)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Cost per Lead</div>
                              <div className={`font-mono font-semibold ${getCostPerLeadTextClass(group.cpl)}`}>{formatShortCurrency(group.cpl)}</div>
                              {group.leadsDash > 0 && (
                                <div className="mt-1 font-mono text-[11px] text-slate-500">
                                  {formatShortCurrency(group.cplTotal)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-slate-500">Cost per Closing</div>
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatShortCurrency(group.cprClosing)}</div>
                              {group.orders > 0 && (
                                <div className="mt-1 font-mono text-[11px] text-slate-500">
                                  {formatShortCurrency(group.cprClosingTotal)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-slate-500">Biaya/Selesai</div>
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatShortCurrency(group.costPerDone)}</div>
                              {group.done > 0 && (
                                <div className="mt-1 font-mono text-[11px] text-slate-500">
                                  {formatShortCurrency(group.costPerDoneTotal)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-slate-500">Revenue</div>
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatShortCurrency(group.revenue)}</div>
                            </div>
                          </div>

                          {isExpanded && (
                          <>
                            <HorizontalDragScrollArea className="advertiserDashboardCsDetailDesktop w-full max-w-full border-t border-slate-100 pb-2 dark:border-slate-800">
                            <table className="w-full min-w-[1640px] table-fixed text-xs">
                              <colgroup>
                                <col className="w-[170px]" />
                                <col className="w-[320px]" />
                                <col className="w-[130px]" />
                                <col className="w-[120px]" />
                                <col className="w-[85px]" />
                                <col className="w-[95px]" />
                                <col className="w-[90px]" />
                                <col className="w-[110px]" />
                                <col className="w-[130px]" />
                                <col className="w-[130px]" />
                                <col className="w-[130px]" />
                                <col className="w-[95px]" />
                                <col className="w-[95px]" />
                                <col className="w-[120px]" />
                              </colgroup>
                              <thead className="bg-white text-slate-500 dark:bg-slate-900">
                                <tr
                                  className="hidden cursor-pointer border-b border-slate-100 bg-slate-50/80 text-xs normal-case shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition-colors hover:bg-slate-100/80 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                                  onClick={() => toggleDateGroup(group.date)}
                                >
                                  <SummaryCell
                                    align="left"
                                    label="Tanggal"
                                    primary={(
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          aria-label={isExpanded ? 'Tutup rincian tanggal' : 'Buka rincian tanggal'}
                                          aria-expanded={isExpanded}
                                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                            isExpanded
                                              ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300'
                                              : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                                          }`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            toggleDateGroup(group.date);
                                          }}
                                        >
                                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                                        </button>
                                        <span>{format(new Date(`${group.date}T00:00:00`), 'dd MMM yyyy', { locale: id })}</span>
                                      </div>
                                    )}
                                    secondary={format(new Date(`${group.date}T00:00:00`), 'EEEE', { locale: id })}
                                    showLabel
                                  />
                                  <SummaryCell
                                    align="left"
                                    label="Rincian"
                                    primary={`${formatNumber(group.rows.length)} rincian`}
                                    showLabel
                                  />
                                  <SummaryCell
                                    label="Spend"
                                    primary={formatShortCurrency(group.spendDashboard)}
                                    secondary={formatShortCurrency(group.spendTotal)}
                                  />
                                  <SummaryCell
                                    align="center"
                                    label="Lead Dashboard"
                                    primary={formatNumber(group.leadsDash)}
                                    secondary={`Prospek CRM: ${formatNumber(group.leadsReal)}`}
                                    primaryClassName="text-cyan-600"
                                  />
                                  <SummaryCell
                                    align="center"
                                    label="Spam"
                                    primary={formatNumber(group.spam)}
                                    primaryClassName="text-red-600"
                                  />
                                  <SummaryCell
                                    align="center"
                                    label="Spam Rate"
                                    primary={formatPercentAllowZero(group.spamRate)}
                                    primaryClassName="text-amber-500"
                                  />
                                  <SummaryCell
                                    align="center"
                                    label="Order"
                                    primary={formatNumber(group.orders)}
                                    primaryClassName="text-blue-600"
                                  />
                                  <SummaryCell
                                    label="Konversi"
                                    primary={formatPercent(group.closingRate)}
                                    primaryClassName={getConversionRateTextClass(group.closingRate)}
                                  />
                                  <SummaryCell
                                    label="Cost per Lead"
                                    primary={formatShortCurrency(group.cpl)}
                                    secondary={group.leadsDash > 0 ? formatShortCurrency(group.cplTotal) : undefined}
                                    primaryClassName={getCostPerLeadTextClass(group.cpl)}
                                  />
                                  <SummaryCell
                                    label="Cost per Closing"
                                    primary={formatShortCurrency(group.cprClosing)}
                                    secondary={group.orders > 0 ? formatShortCurrency(group.cprClosingTotal) : undefined}
                                  />
                                  <SummaryCell align="center" label="Terjadwal" primary={formatNumber(group.scheduled)} />
                                  <SummaryCell
                                    align="center"
                                    label="Selesai"
                                    primary={formatNumber(group.done)}
                                    primaryClassName="text-emerald-600"
                                  />
                                  <SummaryCell
                                    align="center"
                                    label="Batal"
                                    primary={formatNumber(group.cancelled)}
                                    primaryClassName="text-red-500"
                                  />
                                  <SummaryCell
                                    label="Biaya/Selesai"
                                    primary={formatShortCurrency(group.costPerDone)}
                                    secondary={group.done > 0 ? formatShortCurrency(group.costPerDoneTotal) : undefined}
                                  />
                                  <SummaryCell label="Revenue" primary={formatShortCurrency(group.revenue)} />
                                  <th className="px-4 py-4 text-right align-top font-normal">
                                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">ROAS</div>
                                    <div className="mt-1 inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold leading-tight text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                      {group.roas > 0 ? `${group.roas.toFixed(2)}x` : '-'}
                                    </div>
                                    {group.roasTotal > 0 && (
                                      <div className="mt-1 font-mono text-[10px] leading-tight text-slate-500 dark:text-slate-400">{group.roasTotal.toFixed(2)}x</div>
                                    )}
                                  </th>
                                </tr>
                                {isExpanded && (
                                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide dark:border-slate-800">
                                  <th className="px-4 py-3 text-left font-medium">CS</th>
                                  <th className="px-4 py-3 text-left font-medium">Platform / Akun</th>
                                  <th className="px-4 py-3 text-right font-medium">Spending</th>
                                  <th className="px-4 py-3 text-center font-medium">Lead Dashboard</th>
                                  <th className="px-4 py-3 text-center font-medium">Spam</th>
                                  <th className="px-4 py-3 text-center font-medium">Spam Rate</th>
                                  <th className="px-4 py-3 text-center font-medium">Order</th>
                                  <th className="px-4 py-3 text-right font-medium">Konversi</th>
                                  <th className="px-4 py-3 text-right font-medium">Cost per Lead</th>
                                  <th className="px-4 py-3 text-right font-medium">Cost per Closing</th>
                                  <th className="px-4 py-3 text-right font-medium">Cost per Selesai</th>
                                  <th className="px-4 py-3 text-center font-medium">Selesai</th>
                                  <th className="px-4 py-3 text-center font-medium">Batal</th>
                                  <th className="px-4 py-3 text-right font-medium">ROAS</th>
                                </tr>
                                )}
                              </thead>
                              {isExpanded && (
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {group.rows.map((row, index) => (
                                  <tr key={`${row.date}-${row.accountName}-${row.csName}-${index}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                                    <td className="px-4 py-3 align-top">
                                      <div className="font-semibold text-slate-800 dark:text-slate-100">{row.csName}</div>
                                      <div className="mt-1 max-w-[170px] truncate text-[11px] text-slate-400" title={row.advertiserName}>
                                        {row.advertiserName}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                      <div className="flex items-start gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                          <PlatformLogo platform={row.platformKey} size="sm" />
                                        </span>
                                        <div className="min-w-0">
                                          <div className="max-w-[280px] truncate font-semibold text-slate-900 dark:text-slate-100" title={row.accountName}>{row.accountName}</div>
                                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                            {row.subChannelName ? `${row.platformName} / ${row.subChannelName}` : row.platformName}
                                          </div>
                                          <Badge
                                            variant="outline"
                                            className={row.source === 'api'
                                              ? 'mt-2 border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                                              : 'mt-2 border-slate-200 bg-slate-50 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}
                                          >
                                            {row.source === 'api' ? 'Connected' : 'Operasional'}
                                          </Badge>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-right align-top">
                                      <SpendingCellValue
                                        spendDashboard={row.spendDashboard}
                                        spendTotal={row.spendTotal}
                                      />
                                    </td>
                                    <td className="px-4 py-3 text-center align-top">
                                      <div className="font-mono font-semibold text-cyan-600">{formatNumber(row.leadsDash)}</div>
                                      <div className="mt-1 text-[11px] text-slate-500">Prospek CRM: {formatNumber(row.leadsReal)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center align-top font-mono font-semibold text-red-600 dark:text-red-300">{formatNumber(row.spam)}</td>
                                    <td className="px-4 py-3 text-center align-top font-mono font-semibold text-amber-500 dark:text-amber-300">{formatPercentAllowZero(row.spamRate)}</td>
                                    <td className="px-4 py-3 text-center align-top">
                                      <OrderVolumeBadge value={row.orders} />
                                    </td>
                                    <td className="px-4 py-3 text-right align-top">
                                      <ConversionRateBadge value={row.orderRate} />
                                    </td>
                                    <td className="px-4 py-3 text-right align-top">
                                      <CostPerLeadBadge value={row.cpl} />
                                    </td>
                                    <td className="px-4 py-3 text-right align-top">
                                      <CostIndicatorBadge value={row.cprClosing} />
                                    </td>
                                    <td className="px-4 py-3 text-right align-top">
                                      <CostIndicatorBadge value={row.costPerDone} />
                                    </td>
                                    <td className="px-4 py-3 text-center align-top font-mono font-semibold text-emerald-600">{formatNumber(row.done)}</td>
                                    <td className="px-4 py-3 text-center align-top font-mono font-semibold text-red-500">{formatNumber(row.cancelled)}</td>
                                    <td className="px-4 py-3 text-right align-top">
                                      <RoasBadgeValue value={row.roas} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              )}
                            </table>
                            </HorizontalDragScrollArea>
                          </>
                          )}
                        </div>
                    );
                  })
                ) : (
                  <OperationalEmptyState
                    icon={TrendingUp}
                    title="Belum ada data performa"
                    description={emptyDataHint}
                  />
                )}
          </div>
        </OperationalTableCard>
      </div>
        </TabsContent>

        <TabsContent value="spam-inputs" className="space-y-4">
          <OperationalTableCard className="csDashboardTableCard">
            <CardHeader className="csDashboardSectionHeader border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base text-slate-800 dark:text-slate-100">Riwayat Input Spam</CardTitle>
                  <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
                    Data mengikuti filter CS, platform, dan periode yang aktif di CS View.
                  </p>
                </div>
                {canManageSpamInputs && (
                  <Button
                    type="button"
                    className="h-9 gap-2 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                    onClick={() => openSpamInputDialog()}
                  >
                    <Plus className="h-4 w-4" />
                    Input Spam
                  </Button>
                )}
              </div>
            </CardHeader>

            {spamInputRows.length > 0 ? (
              <div className="overflow-x-auto">
                <Table className="min-w-[980px]">
                  <TableHeader className="bg-slate-50 dark:bg-slate-900">
                    <TableRow className="border-b border-slate-200 hover:bg-transparent dark:border-slate-800">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tanggal</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">CS</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Platform</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Advertiser</TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Spam</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Catatan</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Update</TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spamInputRows.map((item) => (
                      <TableRow key={item.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <TableCell className="whitespace-nowrap align-top">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {format(new Date(`${item.inputDate}T00:00:00`), 'dd MMM yyyy', { locale: id })}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {format(new Date(`${item.inputDate}T00:00:00`), 'EEEE', { locale: id })}
                          </div>
                        </TableCell>
                        <TableCell className="align-top font-medium text-slate-800 dark:text-slate-100">{item.csName}</TableCell>
                        <TableCell className="align-top text-slate-600 dark:text-slate-300">{item.platformName}</TableCell>
                        <TableCell className="align-top text-slate-600 dark:text-slate-300">{item.advertiserName}</TableCell>
                        <TableCell className="text-right align-top font-mono font-semibold text-rose-600 dark:text-rose-300">
                          {formatNumber(item.spamCount)}
                        </TableCell>
                        <TableCell className="max-w-[280px] align-top text-slate-600 dark:text-slate-300">
                          <div className="line-clamp-2">{item.notes || '-'}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap align-top text-xs text-slate-500 dark:text-slate-400">
                          {item.updatedAt
                            ? format(new Date(item.updatedAt), 'dd MMM yyyy HH:mm', { locale: id })
                            : '-'}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 bg-white dark:bg-slate-900"
                              onClick={() => openSpamInputEditDialog(item)}
                              disabled={!canManageSpamInputs}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/20"
                              onClick={() => setSpamInputToDelete(item.id)}
                              disabled={!canManageSpamInputs}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <OperationalEmptyState
                icon={AlertTriangle}
                title="Belum ada input spam"
                description="Input spam yang sesuai filter aktif akan muncul di sini dan bisa diedit jika ada kesalahan."
              />
            )}
          </OperationalTableCard>
        </TabsContent>
      </Tabs>

      <Sheet
        open={isSpamDialogOpen}
        onOpenChange={(open) => {
          setIsSpamDialogOpen(open);
          if (!open) {
            lastSpamScopeKeyRef.current = '';
            setSpamForm(buildInitialSpamFormState());
          }
        }}
      >
        <SheetContent
          side={isSpamFormMobile ? 'bottom' : 'right'}
          className={`flex flex-col gap-0 border-slate-200 bg-slate-50 p-0 dark:border-slate-800 dark:bg-slate-950 ${
            isSpamFormMobile ? 'h-[90vh] rounded-t-xl' : 'h-full w-full sm:max-w-xl'
          }`}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetHeader className="sticky top-0 z-10 shrink-0 rounded-t-xl border-b border-slate-200 bg-white p-4 text-left dark:border-slate-800 dark:bg-slate-900 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle className="text-left text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {spamForm.id ? 'Edit Input Spam Harian' : 'Input Spam Harian'}
                </SheetTitle>
                <SheetDescription className="text-left text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Data disimpan per kombinasi tanggal, CS, advertiser, dan platform.
                </SheetDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsSpamDialogOpen(false)}
                className="-mr-2 -mt-1 h-8 w-8 rounded-full text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Tutup</span>
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Data Spam</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Pilihan advertiser dan platform mengikuti assignment akun iklan pada tanggal yang dipilih.
                </p>
              </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="spam-input-date">
                <RequiredLabel>Tanggal</RequiredLabel>
              </Label>
              <Input
                id="spam-input-date"
                type="date"
                className="h-10 bg-white dark:border-slate-700 dark:bg-slate-900"
                value={spamForm.inputDate}
                onChange={(event) => setSpamForm((current) => ({ ...current, inputDate: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>
                <RequiredLabel>CS</RequiredLabel>
              </Label>
              <Select
                value={spamForm.csId || undefined}
                onValueChange={(value) => setSpamForm((current) => ({ ...current, csId: value, advertiserId: '', platformId: '' }))}
                disabled={!isOwner}
              >
                <SelectTrigger className="h-10 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <SelectValue placeholder="Pilih CS" />
                </SelectTrigger>
                <SelectContent>
                  {spamCsOptions.map((cs) => (
                    <SelectItem key={cs.id} value={cs.id}>{cs.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                <RequiredLabel>Advertiser</RequiredLabel>
              </Label>
              <Select
                value={spamForm.advertiserId || undefined}
                onValueChange={(value) => setSpamForm((current) => ({ ...current, advertiserId: value, platformId: '' }))}
                disabled={!spamForm.csId || spamAdvertiserOptions.length === 0}
              >
                <SelectTrigger className="h-10 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <SelectValue placeholder={!spamForm.csId ? 'Pilih CS dulu' : 'Pilih advertiser'} />
                </SelectTrigger>
                <SelectContent>
                  {spamAdvertiserOptions.map((advertiser) => (
                    <SelectItem key={advertiser.id} value={advertiser.id}>{advertiser.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {spamForm.csId && spamAdvertiserOptions.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Belum ada advertiser aktif yang assignment akunnya cocok dengan CS dan tanggal ini.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>
                <RequiredLabel>Platform</RequiredLabel>
              </Label>
              <Select
                value={spamForm.platformId || undefined}
                onValueChange={(value) => setSpamForm((current) => ({ ...current, platformId: value }))}
                disabled={!spamForm.advertiserId || spamPlatformOptions.length === 0}
              >
                <SelectTrigger className="h-10 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <SelectValue placeholder={spamForm.advertiserId ? 'Pilih platform' : 'Pilih advertiser dulu'} />
                </SelectTrigger>
                <SelectContent>
                  {spamPlatformOptions.map((platform) => (
                    <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {spamForm.advertiserId && spamPlatformOptions.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Belum ada platform aktif yang cocok dengan advertiser, CS, dan tanggal ini.
                </p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="spam-count">
                <RequiredLabel>Jumlah Spam</RequiredLabel>
              </Label>
              <Input
                id="spam-count"
                type="number"
                min="0"
                inputMode="numeric"
                className="h-10 bg-white dark:border-slate-700 dark:bg-slate-900"
                value={spamForm.spamCount}
                onChange={(event) => setSpamForm((current) => ({ ...current, spamCount: event.target.value }))}
                placeholder="Contoh: 5"
              />
              {spamForm.id && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Isi `0` lalu simpan jika ingin menghapus input yang sudah ada.
                </p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="spam-notes" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Catatan
              </Label>
              <Textarea
                id="spam-notes"
                className="min-h-[88px] bg-white text-sm dark:border-slate-700 dark:bg-slate-900"
                value={spamForm.notes}
                onChange={(event) => setSpamForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Opsional: keterangan sumber spam atau catatan follow up."
                rows={3}
              />
            </div>
          </div>
            </section>
          </div>
          </div>

          <SheetFooter className="sticky bottom-0 z-10 shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row md:p-6">
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-10 w-full bg-white sm:mt-0 sm:w-auto dark:bg-slate-900"
              onClick={() => setIsSpamDialogOpen(false)}
              disabled={isSavingSpamInput}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="h-10 w-full min-w-[140px] bg-blue-600 text-white hover:bg-blue-700 sm:w-auto"
              onClick={handleSaveSpamInput}
              disabled={isSavingSpamInput}
            >
              {isSavingSpamInput ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Simpan...</> : 'Simpan'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(spamInputToDelete)} onOpenChange={(open) => !open && setSpamInputToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus input spam?</AlertDialogTitle>
            <AlertDialogDescription>
              Data spam ini akan dihapus dari CS View dan perhitungan spam pada periode terkait ikut berubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={handleDeleteSpamInput}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OperationalPageShell>
  );
}
