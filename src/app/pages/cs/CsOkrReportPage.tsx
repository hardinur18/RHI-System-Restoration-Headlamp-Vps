import React from 'react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Target,
  TrendingUp,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Progress } from '@/app/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import { cn } from '@/app/components/ui/utils';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '@/app/components/ui/operational-page';
import { isCsRole } from '@/app/data/roleHelpers';
import { usePermissions } from '@/app/hooks/usePermissions';
import { useMasterData } from '@/app/pages/master-data/context';
import type { DailyAd, Lead, LeadSpamDailyInput, Order } from '@/app/pages/master-data/data';
import {
  fetchWhatsAppOverview,
  type WhatsAppCsPerformance,
  type WhatsAppPerformanceSummary,
} from '@/app/services/whatsappModuleService';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import { FilterRow } from '@/app/components/ui/control-layout';

const ALL_VALUE = 'all';
const RESPONSE_TARGET_SECONDS = 10 * 60;
const SLA_TARGET_PERCENT = 85;
const CONVERSION_TARGET_PERCENT = 20;
const SPAM_TARGET_PERCENT = 10;
const CS_OKR_TARGET_STORAGE_PREFIX = 'cs-okr-targets:';
const OKR_TABLE_HEADER_ROW_CLASS = 'border-b border-slate-200 bg-slate-50/80 hover:bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-900/40';
const OKR_TABLE_ROW_CLASS = 'border-b border-slate-100 transition-colors hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-900/40';
const OKR_TABLE_HEAD_CLASS = 'h-11 px-4 text-xs font-semibold tracking-normal text-slate-500 dark:text-slate-400';
const OKR_TABLE_CELL_CLASS = 'px-4 py-3.5 align-middle text-sm text-slate-700 dark:text-slate-300';

type CsOkrTarget = {
  id: string;
  month: string;
  csId?: string;
  platformId?: string | null;
  leadsTarget: number;
  orderTarget: number;
  revenueTarget: number;
  conversionTargetPercent: number;
  responseTargetSeconds: number;
  slaTargetPercent: number;
  spamTargetPercent: number;
  notes?: string;
  updatedAt?: string;
};

type TargetLoadSource = 'server' | 'local' | 'empty';

type TargetLoadResult = {
  targets: CsOkrTarget[];
  source: TargetLoadSource;
};

type CsReportRow = {
  id: string;
  name: string;
  leads: number;
  dashboardLeads: number;
  leadBase: number;
  orders: number;
  doneOrders: number;
  cancelledOrders: number;
  revenue: number;
  spend: number;
  spam: number;
  conversionRate: number | null;
  spamRate: number | null;
  avgResponseSeconds: number | null;
  slaHitRate: number | null;
  unanswered: number;
  score: number | null;
};

type OkrMetricRow = {
  key: string;
  label: string;
  actual: string;
  target: string;
  progress: number | null;
  source: string;
};

type TargetBenchmarks = {
  conversionTargetPercent: number;
  responseTargetSeconds: number;
  slaTargetPercent: number;
  spamTargetPercent: number;
};

const numberFormatter = new Intl.NumberFormat('id-ID');
const currencyFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

function createTargetId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cs-okr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeCsOkrTarget(value: Partial<CsOkrTarget>, month: string): CsOkrTarget {
  return {
    id: value.id || createTargetId(),
    month,
    csId: value.csId || '',
    platformId: value.platformId || null,
    leadsTarget: safeNumber(value.leadsTarget),
    orderTarget: safeNumber(value.orderTarget),
    revenueTarget: safeNumber(value.revenueTarget),
    conversionTargetPercent: safeNumber(value.conversionTargetPercent) || CONVERSION_TARGET_PERCENT,
    responseTargetSeconds: safeNumber(value.responseTargetSeconds) || RESPONSE_TARGET_SECONDS,
    slaTargetPercent: safeNumber(value.slaTargetPercent) || SLA_TARGET_PERCENT,
    spamTargetPercent: safeNumber(value.spamTargetPercent) || SPAM_TARGET_PERCENT,
    notes: value.notes || '',
    updatedAt: value.updatedAt,
  };
}

function getLocalTargets(month: string): CsOkrTarget[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(`${CS_OKR_TARGET_STORAGE_PREFIX}${month}`);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeCsOkrTarget(item, month)).filter((item) => item.csId)
      : [];
  } catch (error) {
    console.error('Failed to read local CS OKR targets', error);
    return [];
  }
}

function setLocalTargets(month: string, targets: CsOkrTarget[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${CS_OKR_TARGET_STORAGE_PREFIX}${month}`, JSON.stringify(targets));
}

async function loadCsOkrTargets(month: string): Promise<TargetLoadResult> {
  try {
    const response = await fetch(buildMakeServerUrl(`/cs-okr-targets/${month}`), {
      headers: await getSessionBackedEdgeHeaders(),
    });

    if (response.ok) {
      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : payload.targets || [];
      return {
        targets: list.map((item: Partial<CsOkrTarget>) => normalizeCsOkrTarget(item, month)).filter((item: CsOkrTarget) => item.csId),
        source: 'server',
      };
    }
  } catch (error) {
    console.error('Failed to load server CS OKR targets', error);
  }

  const localTargets = getLocalTargets(month);
  return {
    targets: localTargets,
    source: localTargets.length ? 'local' : 'empty',
  };
}

async function saveCsOkrTargets(month: string, targets: CsOkrTarget[]): Promise<TargetLoadResult> {
  const normalized = targets
    .map((target) => normalizeCsOkrTarget({ ...target, updatedAt: new Date().toISOString() }, month))
    .filter((target) => target.csId);

  try {
    const response = await fetch(buildMakeServerUrl(`/cs-okr-targets/${month}`), {
      method: 'POST',
      headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
      body: JSON.stringify({ targets: normalized }),
    });

    if (response.ok) {
      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : payload.targets || normalized;
      const savedTargets = list
        .map((item: Partial<CsOkrTarget>) => normalizeCsOkrTarget(item, month))
        .filter((target: CsOkrTarget) => target.csId);
      setLocalTargets(month, savedTargets);
      return { targets: savedTargets, source: 'server' };
    }
  } catch (error) {
    console.error('Failed to save server CS OKR targets', error);
  }

  setLocalTargets(month, normalized);
  return { targets: normalized, source: 'local' };
}

function toDateInputValue(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function getMonthStartInput(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return toDateInputValue(startOfMonth(parsed));
}

function getMonthEndInput(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return toDateInputValue(endOfMonth(parsed));
}

function toJakartaStartIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toJakartaEndIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T23:59:59.999+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateKey(value?: string | null) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return format(parsed, 'yyyy-MM-dd');
}

function isWithinDateRange(value: string | null | undefined, fromDate: string, toDate: string) {
  const key = toDateKey(value);
  return Boolean(key && key >= fromDate && key <= toDate);
}

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function progressToTarget(actual: number, target: number) {
  if (target <= 0) return null;
  return clampPercent((actual / target) * 100);
}

function progressLowerIsBetter(actual: number | null, target: number) {
  if (actual === null || target <= 0) return null;
  if (actual <= target) return 100;
  return clampPercent((target / actual) * 100);
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value || 0));
}

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value || 0));
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value.toFixed(digits)}%`;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  if (seconds < 60) return `${Math.round(seconds)} dtk`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}j ${restMinutes}m` : `${hours}j`;
}

function getOrderDate(order: Order) {
  return order.created_at || order.leadDate || order.serviceDate;
}

function isDoneOrder(order: Order) {
  return order.status === 'done' || order.effectiveStatus?.toLowerCase() === 'done';
}

function isCancelledOrder(order: Order) {
  return order.status === 'cancelled' || order.effectiveStatus?.toLowerCase() === 'cancelled';
}

function getOrderRevenue(order: Order) {
  return safeNumber(order.income || order.price);
}

function getAdSpend(ad: DailyAd) {
  return safeNumber(ad.amountSpent) + safeNumber(ad.ppnAmount) + safeNumber(ad.feeAmount);
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function weightedAverage(
  rows: WhatsAppCsPerformance[],
  valueKey: 'avgResponseSeconds' | 'slaHitRate',
  weightKey: 'responseSampleCount' | 'conversationCount',
) {
  let weightedSum = 0;
  let weightTotal = 0;

  rows.forEach((row) => {
    const value = row[valueKey];
    const weight = safeNumber(row[weightKey]);
    if (value === null || !Number.isFinite(value) || weight <= 0) return;
    weightedSum += value * weight;
    weightTotal += weight;
  });

  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

function averageTargetValue(targets: CsOkrTarget[], key: keyof TargetBenchmarks, fallback: number) {
  const values = targets
    .map((target) => safeNumber(target[key]))
    .filter((value) => value > 0);

  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildBenchmarks(targets: CsOkrTarget[]): TargetBenchmarks {
  return {
    conversionTargetPercent: averageTargetValue(targets, 'conversionTargetPercent', CONVERSION_TARGET_PERCENT),
    responseTargetSeconds: averageTargetValue(targets, 'responseTargetSeconds', RESPONSE_TARGET_SECONDS),
    slaTargetPercent: averageTargetValue(targets, 'slaTargetPercent', SLA_TARGET_PERCENT),
    spamTargetPercent: averageTargetValue(targets, 'spamTargetPercent', SPAM_TARGET_PERCENT),
  };
}

function getProgressTone(progress: number | null) {
  if (progress === null) return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  if (progress >= 100) return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (progress >= 80) return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300';
  if (progress >= 60) return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
  return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300';
}

function getProgressLabel(progress: number | null) {
  if (progress === null) return 'Belum ada target';
  if (progress >= 100) return 'Tercapai';
  if (progress >= 80) return 'On track';
  if (progress >= 60) return 'Monitor';
  return 'Perlu aksi';
}

function getProgressIndicator(progress: number | null) {
  if (progress === null) return 'bg-slate-400';
  if (progress >= 100) return 'bg-emerald-600';
  if (progress >= 80) return 'bg-blue-600';
  if (progress >= 60) return 'bg-amber-500';
  return 'bg-rose-600';
}

function buildMetricScore(
  row: Pick<CsReportRow, 'conversionRate' | 'spamRate' | 'avgResponseSeconds' | 'slaHitRate'>,
  benchmarks: TargetBenchmarks,
  hasTargets: boolean,
) {
  if (!hasTargets) return null;
  return average([
    progressToTarget(row.conversionRate ?? 0, benchmarks.conversionTargetPercent),
    progressLowerIsBetter(row.avgResponseSeconds, benchmarks.responseTargetSeconds),
    progressToTarget(row.slaHitRate ?? 0, benchmarks.slaTargetPercent),
    progressLowerIsBetter(row.spamRate, benchmarks.spamTargetPercent),
  ]);
}

function countLeads(items: Lead[]) {
  return items.length;
}

function sumSpam(items: LeadSpamDailyInput[]) {
  return items.reduce((sum, item) => sum + safeNumber(item.spamCount), 0);
}

function CsOkrReportPage() {
  const {
    users = [],
    leads = [],
    orders = [],
    dailyAds = [],
    leadSpamDailyInputs = [],
    platforms = [],
    currentUser,
    currentRole,
  } = useMasterData();
  const { hasPermission } = usePermissions();

  const today = React.useMemo(() => new Date(), []);
  const [fromDate, setFromDate] = React.useState(() => toDateInputValue(startOfMonth(today)));
  const [toDate, setToDate] = React.useState(() => toDateInputValue(endOfMonth(today)));
  const [selectedCsId, setSelectedCsId] = React.useState<string>(ALL_VALUE);
  const [selectedPlatformId, setSelectedPlatformId] = React.useState<string>(ALL_VALUE);
  const [targets, setTargets] = React.useState<CsOkrTarget[]>([]);
  const [targetSource, setTargetSource] = React.useState<TargetLoadSource>('empty');
  const [targetsLoading, setTargetsLoading] = React.useState(false);
  const [targetsSaving, setTargetsSaving] = React.useState(false);
  const [targetDialogOpen, setTargetDialogOpen] = React.useState(false);
  const [targetDrafts, setTargetDrafts] = React.useState<CsOkrTarget[]>([]);
  const [whatsAppPerformance, setWhatsAppPerformance] = React.useState<WhatsAppPerformanceSummary | null>(null);
  const [whatsAppLoading, setWhatsAppLoading] = React.useState(false);

  const currentUserIsCs = isCsRole(currentRole || currentUser?.role);
  const canViewAllCs = !currentUserIsCs;
  const canManageTargets = !currentUserIsCs && hasPermission('cs_okr.manage');
  const targetMonthKey = (fromDate || toDate || toDateInputValue(today)).slice(0, 7);

  const csUsers = React.useMemo(() => {
    if (currentUserIsCs && currentUser) {
      return [currentUser];
    }

    const activeCs = users
      .filter((user) => isCsRole(user.role) && user.status !== 'inactive')
      .sort((a, b) => a.name.localeCompare(b.name));

    return activeCs;
  }, [currentUser, currentUserIsCs, users]);

  React.useEffect(() => {
    if (currentUserIsCs && currentUser?.id) {
      setSelectedCsId(currentUser.id);
    }
  }, [currentUser?.id, currentUserIsCs]);

  const fetchTargets = React.useCallback(async () => {
    setTargetsLoading(true);
    try {
      const result = await loadCsOkrTargets(targetMonthKey);
      setTargets(result.targets);
      setTargetSource(result.source);
    } catch (error) {
      console.error('Failed to load CS OKR targets', error);
      setTargets([]);
      setTargetSource('empty');
    } finally {
      setTargetsLoading(false);
    }
  }, [targetMonthKey]);

  const fetchPerformance = React.useCallback(async (showToast = false) => {
    setWhatsAppLoading(true);
    try {
      const overview = await fetchWhatsAppOverview({
        includePerformance: true,
        includeContacts: false,
        includeMessageCounts: false,
        includeConversations: false,
        from: toJakartaStartIso(fromDate),
        to: toJakartaEndIso(toDate),
      });
      setWhatsAppPerformance(overview.performance ?? null);
      if (showToast) toast.success('Performa WhatsApp diperbarui');
    } catch (error) {
      console.error('Failed to load WhatsApp performance for CS OKR', error);
      setWhatsAppPerformance(null);
      if (showToast) toast.error('Performa WhatsApp belum bisa dimuat');
    } finally {
      setWhatsAppLoading(false);
    }
  }, [fromDate, toDate]);

  React.useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  React.useEffect(() => {
    fetchPerformance(false);
  }, [fetchPerformance]);

  const selectedCsUsers = React.useMemo(() => {
    if (currentUserIsCs && currentUser) return [currentUser];
    if (selectedCsId === ALL_VALUE) return csUsers;
    return csUsers.filter((user) => user.id === selectedCsId);
  }, [csUsers, currentUser, currentUserIsCs, selectedCsId]);

  const selectedCsIds = React.useMemo(
    () => selectedCsUsers.map((user) => user.id),
    [selectedCsUsers],
  );

  const whatsAppByCsId = React.useMemo(() => {
    const map = new Map<string, WhatsAppCsPerformance>();
    whatsAppPerformance?.cs.forEach((row) => {
      if (row.csProfileId) map.set(row.csProfileId, row);
    });
    return map;
  }, [whatsAppPerformance]);

  const matchesSelectedCs = React.useCallback((csId?: string | null) => {
    if (currentUserIsCs) return Boolean(currentUser?.id && csId === currentUser.id);
    if (selectedCsId !== ALL_VALUE) return csId === selectedCsId;
    if (!selectedCsIds.length) return true;
    return Boolean(csId && selectedCsIds.includes(csId));
  }, [currentUser?.id, currentUserIsCs, selectedCsId, selectedCsIds]);

  const matchesSelectedDailyAdCs = React.useCallback((csId?: string | null) => {
    if (currentUserIsCs) return Boolean(currentUser?.id && csId === currentUser.id);
    if (selectedCsId !== ALL_VALUE) return csId === selectedCsId;
    if (!selectedCsIds.length) return true;
    return !csId || selectedCsIds.includes(csId);
  }, [currentUser?.id, currentUserIsCs, selectedCsId, selectedCsIds]);

  const report = React.useMemo(() => {
    const platformFilterActive = selectedPlatformId !== ALL_VALUE;
    const matchesPlatform = (platformId?: string | null) =>
      !platformFilterActive || platformId === selectedPlatformId;

    const filteredLeads = leads.filter((lead) =>
      isWithinDateRange(lead.timestamp, fromDate, toDate) &&
      matchesSelectedCs(lead.csId) &&
      matchesPlatform(lead.platformId),
    );

    const filteredOrders = orders.filter((order) =>
      isWithinDateRange(getOrderDate(order), fromDate, toDate) &&
      matchesSelectedCs(order.csId) &&
      matchesPlatform(order.platformId),
    );

    const filteredDailyAds = dailyAds.filter((ad) =>
      isWithinDateRange(ad.date, fromDate, toDate) &&
      matchesSelectedDailyAdCs(ad.csId) &&
      matchesPlatform(ad.platformId),
    );

    const filteredSpam = leadSpamDailyInputs.filter((item) =>
      isWithinDateRange(item.inputDate, fromDate, toDate) &&
      matchesSelectedCs(item.csId) &&
      matchesPlatform(item.platformId),
    );

    const scopedTargets = targets.filter((target) => {
      if (target.month && target.month !== targetMonthKey) return false;
      if (selectedCsIds.length && !selectedCsIds.includes(target.csId || '')) return false;
      return true;
    });
    const hasScopedPlatformTargets = platformFilterActive && scopedTargets.some((target) => target.platformId === selectedPlatformId);
    const filteredTargets = scopedTargets.filter((target) => {
      if (!platformFilterActive) return true;
      return hasScopedPlatformTargets ? target.platformId === selectedPlatformId : !target.platformId;
    });
    const hasTargets = filteredTargets.length > 0;

    const doneOrders = filteredOrders.filter(isDoneOrder);
    const cancelledOrders = filteredOrders.filter(isCancelledOrder);
    const dashboardLeads = filteredDailyAds.reduce((sum, ad) => sum + safeNumber(ad.leadsDashboard), 0);
    const leadBase = dashboardLeads || countLeads(filteredLeads);
    const revenue = doneOrders.reduce((sum, order) => sum + getOrderRevenue(order), 0);
    const spend = filteredDailyAds.reduce((sum, ad) => sum + getAdSpend(ad), 0);
    const spamCount = sumSpam(filteredSpam);
    const conversionRate = leadBase > 0 ? (doneOrders.length / leadBase) * 100 : null;
    const spamRate = leadBase > 0 ? (spamCount / leadBase) * 100 : null;
    const selectedWaRows = selectedCsIds
      .map((csId) => whatsAppByCsId.get(csId))
      .filter((row): row is WhatsAppCsPerformance => Boolean(row));
    const avgResponseSeconds = weightedAverage(selectedWaRows, 'avgResponseSeconds', 'responseSampleCount');
    const slaHitRate = weightedAverage(selectedWaRows, 'slaHitRate', 'responseSampleCount');
    const unanswered = selectedWaRows.reduce((sum, row) => sum + safeNumber(row.unansweredConversationCount), 0);
    const targetTotals = filteredTargets.reduce(
      (sum, target) => ({
        leads: sum.leads + safeNumber(target.leadsTarget),
        orders: sum.orders + safeNumber(target.orderTarget),
        revenue: sum.revenue + safeNumber(target.revenueTarget),
      }),
      { leads: 0, orders: 0, revenue: 0 },
    );
    const benchmarks = buildBenchmarks(filteredTargets);

    const csRows: CsReportRow[] = selectedCsUsers.map((cs) => {
      const scopedCsTargets = targets.filter((target) => {
        if (target.month && target.month !== targetMonthKey) return false;
        if (target.csId !== cs.id) return false;
        return true;
      });
      const hasCsPlatformTargets = platformFilterActive && scopedCsTargets.some((target) => target.platformId === selectedPlatformId);
      const csTargets = scopedCsTargets.filter((target) => {
        if (!platformFilterActive) return true;
        return hasCsPlatformTargets ? target.platformId === selectedPlatformId : !target.platformId;
      });
      const hasCsTargets = csTargets.length > 0;
      const csBenchmarks = buildBenchmarks(csTargets);
      const csLeads = leads.filter((lead) =>
        lead.csId === cs.id &&
        isWithinDateRange(lead.timestamp, fromDate, toDate) &&
        matchesPlatform(lead.platformId),
      );
      const csOrders = orders.filter((order) =>
        order.csId === cs.id &&
        isWithinDateRange(getOrderDate(order), fromDate, toDate) &&
        matchesPlatform(order.platformId),
      );
      const csDailyAds = dailyAds.filter((ad) =>
        ad.csId === cs.id &&
        isWithinDateRange(ad.date, fromDate, toDate) &&
        matchesPlatform(ad.platformId),
      );
      const csSpamInputs = leadSpamDailyInputs.filter((item) =>
        item.csId === cs.id &&
        isWithinDateRange(item.inputDate, fromDate, toDate) &&
        matchesPlatform(item.platformId),
      );
      const wa = whatsAppByCsId.get(cs.id);
      const rowDashboardLeads = csDailyAds.reduce((sum, ad) => sum + safeNumber(ad.leadsDashboard), 0);
      const rowLeadBase = rowDashboardLeads || countLeads(csLeads);
      const rowDoneOrders = csOrders.filter(isDoneOrder);
      const rowSpam = sumSpam(csSpamInputs);
      const row: CsReportRow = {
        id: cs.id,
        name: cs.name,
        leads: countLeads(csLeads),
        dashboardLeads: rowDashboardLeads,
        leadBase: rowLeadBase,
        orders: csOrders.length,
        doneOrders: rowDoneOrders.length,
        cancelledOrders: csOrders.filter(isCancelledOrder).length,
        revenue: rowDoneOrders.reduce((sum, order) => sum + getOrderRevenue(order), 0),
        spend: csDailyAds.reduce((sum, ad) => sum + getAdSpend(ad), 0),
        spam: rowSpam,
        conversionRate: rowLeadBase > 0 ? (rowDoneOrders.length / rowLeadBase) * 100 : null,
        spamRate: rowLeadBase > 0 ? (rowSpam / rowLeadBase) * 100 : null,
        avgResponseSeconds: wa?.avgResponseSeconds ?? null,
        slaHitRate: wa?.slaHitRate ?? null,
        unanswered: safeNumber(wa?.unansweredConversationCount),
        score: null,
      };
      row.score = buildMetricScore(row, csBenchmarks, hasCsTargets);
      return row;
    }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const okrRows: OkrMetricRow[] = [
      {
        key: 'leads',
        label: 'Lead masuk',
        actual: formatNumber(leadBase),
        target: targetTotals.leads > 0 ? formatNumber(targetTotals.leads) : '-',
        progress: progressToTarget(leadBase, targetTotals.leads),
        source: 'Leads + Ads',
      },
      {
        key: 'orders',
        label: 'Closing order',
        actual: formatNumber(doneOrders.length),
        target: targetTotals.orders > 0 ? formatNumber(targetTotals.orders) : '-',
        progress: progressToTarget(doneOrders.length, targetTotals.orders),
        source: 'Pesanan',
      },
      {
        key: 'revenue',
        label: 'Revenue selesai',
        actual: formatCurrency(revenue),
        target: targetTotals.revenue > 0 ? formatCurrency(targetTotals.revenue) : '-',
        progress: progressToTarget(revenue, targetTotals.revenue),
        source: 'Pesanan',
      },
      {
        key: 'conversion',
        label: 'Conversion rate',
        actual: formatPercent(conversionRate),
        target: hasTargets ? formatPercent(benchmarks.conversionTargetPercent, 0) : '-',
        progress: hasTargets ? progressToTarget(conversionRate ?? 0, benchmarks.conversionTargetPercent) : null,
        source: 'Leads + Pesanan',
      },
      {
        key: 'response',
        label: 'Avg response WA',
        actual: formatDuration(avgResponseSeconds),
        target: hasTargets ? `<= ${formatDuration(benchmarks.responseTargetSeconds)}` : '-',
        progress: hasTargets ? progressLowerIsBetter(avgResponseSeconds, benchmarks.responseTargetSeconds) : null,
        source: 'WhatsApp',
      },
      {
        key: 'sla',
        label: 'SLA hit rate',
        actual: formatPercent(slaHitRate),
        target: hasTargets ? formatPercent(benchmarks.slaTargetPercent, 0) : '-',
        progress: hasTargets ? progressToTarget(slaHitRate ?? 0, benchmarks.slaTargetPercent) : null,
        source: 'WhatsApp',
      },
      {
        key: 'spam',
        label: 'Spam rate',
        actual: formatPercent(spamRate),
        target: hasTargets ? `<= ${formatPercent(benchmarks.spamTargetPercent, 0)}` : '-',
        progress: hasTargets ? progressLowerIsBetter(spamRate, benchmarks.spamTargetPercent) : null,
        source: 'Input Spam',
      },
    ];

    const score = hasTargets ? average(okrRows.map((row) => row.progress)) : null;
    const leadBaseSource = dashboardLeads > 0 ? 'Dashboard Ads' : 'Input Lead';

    return {
      filteredLeads,
      filteredOrders,
      filteredDailyAds,
      filteredSpam,
      doneOrders,
      cancelledOrders,
      dashboardLeads,
      leadBase,
      revenue,
      spend,
      spamCount,
      conversionRate,
      spamRate,
      avgResponseSeconds,
      slaHitRate,
      unanswered,
      targetTotals,
      benchmarks,
      hasTargets,
      leadBaseSource,
      okrRows,
      csRows,
      score,
    };
  }, [
    dailyAds,
    fromDate,
    leadSpamDailyInputs,
    leads,
    matchesSelectedCs,
    matchesSelectedDailyAdCs,
    orders,
    selectedCsId,
    selectedCsIds,
    selectedCsUsers,
    selectedPlatformId,
    targetMonthKey,
    targets,
    toDate,
    whatsAppByCsId,
  ]);

  const selectedCsLabel = selectedCsId === ALL_VALUE
    ? 'Semua CS'
    : csUsers.find((user) => user.id === selectedCsId)?.name || 'CS';
  const selectedPlatformLabel = selectedPlatformId === ALL_VALUE
    ? 'Semua Platform'
    : platforms.find((platform) => platform.id === selectedPlatformId)?.name || 'Platform';

  const handleFromDateChange = React.useCallback((value: string) => {
    if (!value) {
      return;
    }

    setFromDate(value);
    setToDate((current) => {
      if (!current || current.slice(0, 7) !== value.slice(0, 7) || current < value) {
        return getMonthEndInput(value);
      }
      return current;
    });
  }, []);

  const handleToDateChange = React.useCallback((value: string) => {
    if (!value) {
      return;
    }

    setToDate(value);
    setFromDate((current) => {
      if (!current || current.slice(0, 7) !== value.slice(0, 7) || current > value) {
        return getMonthStartInput(value);
      }
      return current;
    });
  }, []);

  const openTargetDialog = React.useCallback(() => {
    setTargetDrafts(targets
      .filter((target) => target.month === targetMonthKey)
      .map((target) => normalizeCsOkrTarget(target, targetMonthKey)));
    setTargetDialogOpen(true);
  }, [targetMonthKey, targets]);

  const addTargetDraft = React.useCallback(() => {
    const fallbackCsId = selectedCsId !== ALL_VALUE
      ? selectedCsId
      : csUsers[0]?.id || '';
    if (!fallbackCsId) {
      toast.error('Belum ada CS aktif untuk dibuatkan target');
      return;
    }

    setTargetDrafts((current) => [
      ...current,
      normalizeCsOkrTarget({
        id: createTargetId(),
        month: targetMonthKey,
        csId: fallbackCsId,
        platformId: selectedPlatformId === ALL_VALUE ? null : selectedPlatformId,
        leadsTarget: 0,
        orderTarget: 0,
        revenueTarget: 0,
        conversionTargetPercent: CONVERSION_TARGET_PERCENT,
        responseTargetSeconds: RESPONSE_TARGET_SECONDS,
        slaTargetPercent: SLA_TARGET_PERCENT,
        spamTargetPercent: SPAM_TARGET_PERCENT,
      }, targetMonthKey),
    ]);
  }, [csUsers, selectedCsId, selectedPlatformId, targetMonthKey]);

  const updateTargetDraft = React.useCallback((
    id: string,
    field: keyof CsOkrTarget,
    value: string | number | null,
  ) => {
    setTargetDrafts((current) => current.map((target) => {
      if (target.id !== id) return target;
      if (field === 'platformId') return { ...target, platformId: value ? String(value) : null };
      if (field === 'csId' || field === 'notes') return { ...target, [field]: String(value || '') };
      return { ...target, [field]: safeNumber(value) };
    }));
  }, []);

  const removeTargetDraft = React.useCallback((id: string) => {
    setTargetDrafts((current) => current.filter((target) => target.id !== id));
  }, []);

  const handleSaveTargets = React.useCallback(async () => {
    setTargetsSaving(true);
    try {
      const result = await saveCsOkrTargets(targetMonthKey, targetDrafts);
      setTargets((current) => [
        ...current.filter((target) => target.month !== targetMonthKey),
        ...result.targets,
      ]);
      setTargetSource(result.source);
      setTargetDialogOpen(false);
      toast.success(result.source === 'server'
        ? 'Target OKR CS tersimpan'
        : 'Target OKR CS tersimpan lokal');
    } catch (error) {
      console.error('Failed to save CS OKR targets', error);
      toast.error('Gagal menyimpan target OKR CS');
    } finally {
      setTargetsSaving(false);
    }
  }, [targetDrafts, targetMonthKey]);

  const handleExportPdf = React.useCallback(() => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const periodLabel = `${format(new Date(fromDate), 'dd MMM yyyy', { locale: localeId })} - ${format(new Date(toDate), 'dd MMM yyyy', { locale: localeId })}`;

    doc.setFontSize(16);
    doc.text('Laporan OKR CS', 14, 14);
    doc.setFontSize(9);
    doc.text(`Periode: ${periodLabel}`, 14, 21);
    doc.text(`Scope: ${selectedCsLabel} / ${selectedPlatformLabel}`, 14, 27);

    autoTable(doc, {
      startY: 34,
      head: [['Metric', 'Nilai']],
      body: [
        ['OKR Score', report.score === null ? '-' : `${report.score.toFixed(0)}%`],
        ['Lead Base', formatNumber(report.leadBase)],
        ['Closing Order', formatNumber(report.doneOrders.length)],
        ['Revenue Selesai', formatCurrency(report.revenue)],
        ['Avg Response WA', formatDuration(report.avgResponseSeconds)],
        ['SLA Hit Rate', formatPercent(report.slaHitRate)],
      ],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      margin: { left: 14, right: 14 },
    });

    const afterSummaryY = ((doc as any).lastAutoTable?.finalY || 70) + 8;
    autoTable(doc, {
      startY: afterSummaryY,
      head: [['OKR', 'Actual', 'Target', 'Progress', 'Status', 'Source']],
      body: report.okrRows.map((row) => [
        row.label,
        row.actual,
        row.target,
        row.progress === null ? '-' : `${row.progress.toFixed(0)}%`,
        getProgressLabel(row.progress),
        row.source,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 118, 110] },
      margin: { left: 14, right: 14 },
    });

    const afterOkrY = ((doc as any).lastAutoTable?.finalY || afterSummaryY + 50) + 8;
    autoTable(doc, {
      startY: afterOkrY,
      head: [['CS', 'Leads', 'Orders', 'Done', 'Revenue', 'Conv.', 'Spam', 'Resp.', 'SLA', 'Score']],
      body: report.csRows.map((row) => [
        row.name,
        formatNumber(row.leadBase),
        formatNumber(row.orders),
        formatNumber(row.doneOrders),
        formatCurrency(row.revenue),
        formatPercent(row.conversionRate),
        formatPercent(row.spamRate),
        formatDuration(row.avgResponseSeconds),
        formatPercent(row.slaHitRate),
        row.score === null ? '-' : `${row.score.toFixed(0)}%`,
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [22, 163, 74] },
      margin: { left: 14, right: 14 },
    });

    doc.save(`OKR_CS_${fromDate}_${toDate}.pdf`);
    toast.success('Laporan OKR CS berhasil diexport');
  }, [fromDate, report, selectedCsLabel, selectedPlatformLabel, toDate]);

  return (
    <OperationalPageShell className="csOkrPage">
      <div className="csOkrStack flex flex-col space-y-4">
      <OperationalPageHeader
        eyebrow="Laporan CS"
        icon={Target}
        title="OKR CS"
        subtitle={`${selectedCsLabel} / ${selectedPlatformLabel} / ${format(new Date(fromDate), 'dd MMM yyyy', { locale: localeId })} - ${format(new Date(toDate), 'dd MMM yyyy', { locale: localeId })}`}
        onRefresh={() => {
          fetchTargets();
          fetchPerformance(true);
        }}
        isRefreshing={targetsLoading || whatsAppLoading}
        actions={(
          <div className="csOkrHeaderActions flex flex-wrap items-center justify-end gap-2">
            {canManageTargets && (
              <Button type="button" variant="outline" className="csOkrHeaderButton" onClick={openTargetDialog} title="Atur Target">
                <Target className="mr-2 h-4 w-4" />
                <span className="csOkrHeaderLabel">Atur Target</span>
              </Button>
            )}
            <Button type="button" className="csOkrHeaderButton csOkrHeaderButtonPrimary" onClick={handleExportPdf}>
              <Download className="mr-2 h-4 w-4" />
              <span>Export PDF</span>
            </Button>
          </div>
        )}
      />

      <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
        <DialogContent className="csOkrTargetDialog max-h-[88vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Target OKR CS</DialogTitle>
            <DialogDescription>
              Bulan {targetMonthKey}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={cn(
                'border',
                targetSource === 'server'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : targetSource === 'local'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600',
              )}
            >
              {targetSource === 'server' ? 'Server' : targetSource === 'local' ? 'Lokal' : 'Belum ada target'}
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={addTargetDraft}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Target
            </Button>
          </div>

          <div className="csOkrTargetCards">
            {targetDrafts.length === 0 ? (
              <OperationalEmptyState
                icon={Target}
                title="Belum ada target"
                description="Tambahkan target untuk mulai menghitung OKR CS."
                className="py-8"
              />
            ) : targetDrafts.map((target) => (
              <div key={target.id} className="csOkrTargetCard">
                <div className="csOkrTargetCardHeader">
                  <div>
                    <p>Target CS</p>
                    <span>{targetMonthKey}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeTargetDraft(target.id)}
                    title="Hapus target"
                  >
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
                <div className="csOkrTargetCardGrid">
                  <label className="csOkrTargetField csOkrTargetFieldWide">
                    <span>CS</span>
                    <Select
                      value={target.csId || csUsers[0]?.id || ''}
                      onValueChange={(value) => updateTargetDraft(target.id, 'csId', value)}
                    >
                      <SelectTrigger className="csOkrTargetControl">
                        <SelectValue placeholder="CS" />
                      </SelectTrigger>
                      <SelectContent>
                        {csUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="csOkrTargetField csOkrTargetFieldWide">
                    <span>Platform</span>
                    <Select
                      value={target.platformId || ALL_VALUE}
                      onValueChange={(value) => updateTargetDraft(target.id, 'platformId', value === ALL_VALUE ? null : value)}
                    >
                      <SelectTrigger className="csOkrTargetControl">
                        <SelectValue placeholder="Platform" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Semua Platform</SelectItem>
                        {platforms.filter((platform) => platform.status !== 'inactive').map((platform) => (
                          <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="csOkrTargetField">
                    <span>Leads</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={0}
                      value={target.leadsTarget}
                      onChange={(event) => updateTargetDraft(target.id, 'leadsTarget', event.target.value)}
                    />
                  </label>
                  <label className="csOkrTargetField">
                    <span>Order</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={0}
                      value={target.orderTarget}
                      onChange={(event) => updateTargetDraft(target.id, 'orderTarget', event.target.value)}
                    />
                  </label>
                  <label className="csOkrTargetField csOkrTargetFieldWide">
                    <span>Omzet</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={0}
                      step={1000}
                      value={target.revenueTarget}
                      onChange={(event) => updateTargetDraft(target.id, 'revenueTarget', event.target.value)}
                    />
                  </label>
                  <label className="csOkrTargetField">
                    <span>Conv %</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={0}
                      max={100}
                      value={target.conversionTargetPercent}
                      onChange={(event) => updateTargetDraft(target.id, 'conversionTargetPercent', event.target.value)}
                    />
                  </label>
                  <label className="csOkrTargetField">
                    <span>Resp mnt</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={1}
                      value={Math.round(target.responseTargetSeconds / 60)}
                      onChange={(event) => updateTargetDraft(target.id, 'responseTargetSeconds', safeNumber(event.target.value) * 60)}
                    />
                  </label>
                  <label className="csOkrTargetField">
                    <span>SLA %</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={0}
                      max={100}
                      value={target.slaTargetPercent}
                      onChange={(event) => updateTargetDraft(target.id, 'slaTargetPercent', event.target.value)}
                    />
                  </label>
                  <label className="csOkrTargetField">
                    <span>Spam %</span>
                    <Input
                      className="csOkrTargetControl"
                      type="number"
                      min={0}
                      max={100}
                      value={target.spamTargetPercent}
                      onChange={(event) => updateTargetDraft(target.id, 'spamTargetPercent', event.target.value)}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="csOkrTargetTable overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow className={OKR_TABLE_HEADER_ROW_CLASS}>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[180px]')}>CS</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[160px]')}>Platform</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[110px]')}>Leads</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[110px]')}>Order</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[150px]')}>Omzet</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[110px]')}>Conv %</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[120px]')}>Resp mnt</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[110px]')}>SLA %</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[110px]')}>Spam %</TableHead>
                  <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'w-12')}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targetDrafts.length === 0 ? (
                  <TableRow className={OKR_TABLE_ROW_CLASS}>
                    <TableCell colSpan={10} className={OKR_TABLE_CELL_CLASS}>
                      <OperationalEmptyState
                        icon={Target}
                        title="Belum ada target"
                        description="Tambahkan target untuk mulai menghitung OKR CS."
                        className="py-10"
                      />
                    </TableCell>
                  </TableRow>
                ) : targetDrafts.map((target) => (
                  <TableRow key={target.id} className={OKR_TABLE_ROW_CLASS}>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Select
                        value={target.csId || csUsers[0]?.id || ''}
                        onValueChange={(value) => updateTargetDraft(target.id, 'csId', value)}
                      >
                        <SelectTrigger className="csOkrTargetControl h-8">
                          <SelectValue placeholder="CS" />
                        </SelectTrigger>
                        <SelectContent>
                          {csUsers.map((user) => (
                            <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Select
                        value={target.platformId || ALL_VALUE}
                        onValueChange={(value) => updateTargetDraft(target.id, 'platformId', value === ALL_VALUE ? null : value)}
                      >
                        <SelectTrigger className="csOkrTargetControl h-8">
                          <SelectValue placeholder="Platform" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_VALUE}>Semua Platform</SelectItem>
                          {platforms.filter((platform) => platform.status !== 'inactive').map((platform) => (
                            <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={0}
                        value={target.leadsTarget}
                        onChange={(event) => updateTargetDraft(target.id, 'leadsTarget', event.target.value)}
                      />
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={0}
                        value={target.orderTarget}
                        onChange={(event) => updateTargetDraft(target.id, 'orderTarget', event.target.value)}
                      />
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={0}
                        step={1000}
                        value={target.revenueTarget}
                        onChange={(event) => updateTargetDraft(target.id, 'revenueTarget', event.target.value)}
                      />
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={0}
                        max={100}
                        value={target.conversionTargetPercent}
                        onChange={(event) => updateTargetDraft(target.id, 'conversionTargetPercent', event.target.value)}
                      />
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={1}
                        value={Math.round(target.responseTargetSeconds / 60)}
                        onChange={(event) => updateTargetDraft(target.id, 'responseTargetSeconds', safeNumber(event.target.value) * 60)}
                      />
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={0}
                        max={100}
                        value={target.slaTargetPercent}
                        onChange={(event) => updateTargetDraft(target.id, 'slaTargetPercent', event.target.value)}
                      />
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Input
                        className="csOkrTargetControl"
                        type="number"
                        min={0}
                        max={100}
                        value={target.spamTargetPercent}
                        onChange={(event) => updateTargetDraft(target.id, 'spamTargetPercent', event.target.value)}
                      />
                    </TableCell>
                    <TableCell className={cn(OKR_TABLE_CELL_CLASS, 'text-right')}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTargetDraft(target.id)}
                        title="Hapus target"
                      >
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTargetDialogOpen(false)}>
              Batal
            </Button>
            <Button type="button" onClick={handleSaveTargets} disabled={targetsSaving}>
              {targetsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Simpan Target
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperationalFilterPanel className="csOkrFilterPanel">
        <FilterRow className="csOkrFilterGrid grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="csOkrFilterField space-y-1.5">
            <Label htmlFor="okr-from-date">Dari</Label>
            <Input
              className="csOkrFilterControl"
              id="okr-from-date"
              type="date"
              value={fromDate}
              onChange={(event) => handleFromDateChange(event.target.value)}
            />
          </div>
          <div className="csOkrFilterField space-y-1.5">
            <Label htmlFor="okr-to-date">Sampai</Label>
            <Input
              className="csOkrFilterControl"
              id="okr-to-date"
              type="date"
              value={toDate}
              onChange={(event) => handleToDateChange(event.target.value)}
            />
          </div>
          <div className="csOkrFilterField space-y-1.5">
            <Label>CS</Label>
            <Select value={selectedCsId} onValueChange={setSelectedCsId} disabled={!canViewAllCs}>
              <SelectTrigger className="csOkrFilterControl">
                <SelectValue placeholder="Pilih CS" />
              </SelectTrigger>
              <SelectContent>
                {canViewAllCs && <SelectItem value={ALL_VALUE}>Semua CS</SelectItem>}
                {csUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="csOkrFilterField space-y-1.5">
            <Label>Platform</Label>
            <Select value={selectedPlatformId} onValueChange={setSelectedPlatformId}>
              <SelectTrigger className="csOkrFilterControl">
                <SelectValue placeholder="Pilih Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Semua Platform</SelectItem>
                {platforms.filter((platform) => platform.status !== 'inactive').map((platform) => (
                  <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FilterRow>
      </OperationalFilterPanel>

      <OperationalKpiGrid className="csOkrKpiGrid">
        <OperationalKpiCard
          label="OKR Score"
          icon={Target}
          tone={report.score !== null && report.score >= 80 ? 'emerald' : 'amber'}
          value={report.score === null ? '-' : `${report.score.toFixed(0)}%`}
        />
        <OperationalKpiCard
          label="Lead Base"
          icon={Users}
          tone="blue"
          value={(
            <div>
              <div>{formatNumber(report.leadBase)}</div>
              <p className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                {report.dashboardLeads > 0
                  ? `Ads ${formatNumber(report.dashboardLeads)} | Input ${formatNumber(report.filteredLeads.length)}`
                  : `Input ${formatNumber(report.filteredLeads.length)}`}
              </p>
            </div>
          )}
        />
        <OperationalKpiCard
          label="Closing Rate"
          icon={TrendingUp}
          tone="emerald"
          value={formatPercent(report.conversionRate)}
        />
        <OperationalKpiCard
          label="Revenue"
          icon={DollarSign}
          tone="violet"
          value={formatCurrency(report.revenue)}
        />
        <OperationalKpiCard
          label="Avg Response"
          icon={Clock}
          tone={report.avgResponseSeconds !== null && report.avgResponseSeconds <= report.benchmarks.responseTargetSeconds ? 'emerald' : 'amber'}
          value={formatDuration(report.avgResponseSeconds)}
        />
        <OperationalKpiCard
          label="SLA"
          icon={MessageSquare}
          tone={report.slaHitRate !== null && report.slaHitRate >= report.benchmarks.slaTargetPercent ? 'emerald' : 'rose'}
          value={formatPercent(report.slaHitRate)}
        />
      </OperationalKpiGrid>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <OperationalTableCard className="csOkrTableCard">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Progress OKR</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Target bulan {targetMonthKey}
              </p>
            </div>
            {targetsLoading ? (
              <Badge className="border-slate-200 bg-slate-50 text-slate-600" variant="outline">
                <Loader2 className="h-3 w-3 animate-spin" />
                Target
              </Badge>
            ) : (
              <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
                <BarChart3 className="h-3 w-3" />
                {formatNumber(report.targetTotals.leads + report.targetTotals.orders)} target
              </Badge>
            )}
          </div>
          <div className="csOkrMetricCards">
            {report.okrRows.map((row) => (
              <div key={row.key} className="csOkrMetricCard">
                <div className="csOkrMetricCardHeader">
                  <div>
                    <p className="csOkrMetricCardTitle">{row.label}</p>
                    <p className="csOkrMetricCardSource">{row.source}</p>
                  </div>
                  <Badge variant="outline" className={cn('border', getProgressTone(row.progress))}>
                    {getProgressLabel(row.progress)}
                  </Badge>
                </div>
                <div className="csOkrMetricCardValues">
                  <div>
                    <span>Actual</span>
                    <strong>{row.actual}</strong>
                  </div>
                  <div>
                    <span>Target</span>
                    <strong>{row.target}</strong>
                  </div>
                </div>
                <div className="csOkrMetricProgressRow">
                  <Progress
                    value={row.progress ?? 0}
                    indicatorClassName={getProgressIndicator(row.progress)}
                    className="h-2 bg-slate-100 dark:bg-slate-800"
                  />
                  <span>{row.progress === null ? '-' : `${row.progress.toFixed(0)}%`}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="csOkrTableScroll csOkrDesktopTable">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className={OKR_TABLE_HEADER_ROW_CLASS}>
                <TableHead className={OKR_TABLE_HEAD_CLASS}>Metric</TableHead>
                <TableHead className={OKR_TABLE_HEAD_CLASS}>Actual</TableHead>
                <TableHead className={OKR_TABLE_HEAD_CLASS}>Target</TableHead>
                <TableHead className={cn(OKR_TABLE_HEAD_CLASS, 'min-w-[170px]')}>Progress</TableHead>
                <TableHead className={OKR_TABLE_HEAD_CLASS}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.okrRows.map((row) => (
                <TableRow key={row.key} className={OKR_TABLE_ROW_CLASS}>
                  <TableCell className={OKR_TABLE_CELL_CLASS}>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{row.label}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{row.source}</div>
                  </TableCell>
                  <TableCell className={cn(OKR_TABLE_CELL_CLASS, 'font-medium text-slate-900 dark:text-slate-100')}>{row.actual}</TableCell>
                  <TableCell className={OKR_TABLE_CELL_CLASS}>{row.target}</TableCell>
                  <TableCell className={OKR_TABLE_CELL_CLASS}>
                    <div className="flex items-center gap-3">
                      <Progress
                        value={row.progress ?? 0}
                        indicatorClassName={getProgressIndicator(row.progress)}
                        className="h-2 min-w-24 bg-slate-100 dark:bg-slate-800"
                      />
                      <span className="w-10 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {row.progress === null ? '-' : `${row.progress.toFixed(0)}%`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={OKR_TABLE_CELL_CLASS}>
                    <Badge variant="outline" className={cn('border', getProgressTone(row.progress))}>
                      {row.progress !== null && row.progress >= 100 ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      {getProgressLabel(row.progress)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </OperationalTableCard>

        <OperationalTableCard className="csOkrTableCard">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ringkasan Per CS</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {formatNumber(report.csRows.length)} CS aktif
              </p>
            </div>
            {whatsAppLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
          {report.csRows.length === 0 ? (
            <OperationalEmptyState
              icon={Users}
              title="Belum ada CS"
              description="Data CS aktif belum tersedia untuk filter ini."
            />
          ) : (
            <>
            <div className="csOkrCsCards">
              {report.csRows.map((row) => (
                <div key={row.id} className="csOkrCsCard">
                  <div className="csOkrCsCardHeader">
                    <div>
                      <p className="csOkrCsName">{row.name}</p>
                      <p className="csOkrCsRevenue">{formatCurrency(row.revenue)} revenue</p>
                    </div>
                    <Badge variant="outline" className={cn('border', getProgressTone(row.score))}>
                      {row.score === null ? '-' : `${row.score.toFixed(0)}%`}
                    </Badge>
                  </div>
                  <div className="csOkrCsStats">
                    <div>
                      <span>Lead</span>
                      <strong>{formatNumber(row.leadBase)}</strong>
                    </div>
                    <div>
                      <span>Order</span>
                      <strong>{formatNumber(row.doneOrders)}</strong>
                    </div>
                    <div>
                      <span>Conv.</span>
                      <strong>{formatPercent(row.conversionRate)}</strong>
                    </div>
                    <div>
                      <span>Resp.</span>
                      <strong>{formatDuration(row.avgResponseSeconds)}</strong>
                    </div>
                  </div>
                  <p className="csOkrCsMeta">
                    Spam {formatNumber(row.spam)} / SLA {formatPercent(row.slaHitRate)}
                  </p>
                </div>
              ))}
            </div>
            <div className="csOkrTableScroll csOkrDesktopTable">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow className={OKR_TABLE_HEADER_ROW_CLASS}>
                  <TableHead className={OKR_TABLE_HEAD_CLASS}>CS</TableHead>
                  <TableHead className={OKR_TABLE_HEAD_CLASS}>Lead</TableHead>
                  <TableHead className={OKR_TABLE_HEAD_CLASS}>Order</TableHead>
                  <TableHead className={OKR_TABLE_HEAD_CLASS}>Conv.</TableHead>
                  <TableHead className={OKR_TABLE_HEAD_CLASS}>Resp.</TableHead>
                  <TableHead className={OKR_TABLE_HEAD_CLASS}>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.csRows.map((row) => (
                  <TableRow key={row.id} className={OKR_TABLE_ROW_CLASS}>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{row.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatCurrency(row.revenue)} revenue
                      </div>
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{formatNumber(row.leadBase)}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{formatNumber(row.spam)} spam</div>
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{formatNumber(row.orders)}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{formatNumber(row.doneOrders)} selesai</div>
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>{formatPercent(row.conversionRate)}</TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <div>{formatDuration(row.avgResponseSeconds)}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{formatPercent(row.slaHitRate)} SLA</div>
                    </TableCell>
                    <TableCell className={OKR_TABLE_CELL_CLASS}>
                      <Badge variant="outline" className={cn('border', getProgressTone(row.score))}>
                        {row.score === null ? '-' : `${row.score.toFixed(0)}%`}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            </>
          )}
        </OperationalTableCard>
      </div>
      </div>
    </OperationalPageShell>
  );
}

export { CsOkrReportPage };
export default CsOkrReportPage;
