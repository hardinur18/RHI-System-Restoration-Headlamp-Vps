import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar as CalendarIcon,
  Search,
  DollarSign, 
  TrendingUp, 
  CheckCircle2,
  PlusCircle,
  Edit,
  ArrowRightLeft,
  Loader2,
  Briefcase,
  User,
  Wallet,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle,
  Trash2,
  ArrowUpDown,
  Eye,
  Copy,
  LayoutList,
  Users,
  X
} from 'lucide-react';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { id } from 'date-fns/locale';
import { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { copyToClipboard } from '@/lib/clipboard';

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Card } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import {
  createDataTableColumns,
  DataTable,
  TableActionCell,
  TableActionHeader,
  TableActionMenu,
  TableActionMenuItem,
  TableText,
} from "@/app/components/ui/data-table";
import { MasterDataTableTitle } from "@/app/components/ui/master-data-table-title";
import {
  MasterDataCurrencyInput,
  MasterDataFieldLabel,
  MasterDataFormDialogContent,
  MasterDataFormField,
  MasterDataFormGrid,
  MasterDataFormHeader,
} from "@/app/components/ui/master-data-ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription } from "@/app/components/ui/sheet";
import { useIsMobile } from "@/app/components/ui/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Label } from "@/app/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import {
  Dialog,
} from "@/app/components/ui/dialog";
import { FoundationDateRangePicker } from "@/app/components/ui/date-range-picker";
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from "@/app/components/ui/operational-page";

import { useMasterData } from '@/app/pages/master-data/context';
import { usePermissions } from '@/app/hooks/usePermissions';
import { logActivity } from '@/app/services/auditService';
import { supabase } from '@/lib/supabaseClient';
import { cn } from "@/app/components/ui/utils";
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import {
  OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY,
  type OperationalExpenseForwardDraft,
} from '@/app/data/operationalExpenseForwardDraft';
import { isTechnicianRole } from '@/app/data/roleHelpers';
import { FilterRow } from '@/app/components/ui/control-layout';

// --- Types (Classic Interface) ---

const OPERATIONAL_EXPENSES_URL = buildMakeServerUrl('/finance/operational-expenses');

interface DailyReport {
  id?: string;
  createdAt?: string;
  date: string;
  technicianId: string;
  technicianName: string;
  role: string;
  
  totalOrders: number;
  totalFinished: number;
  totalVisit: number;
  totalHomeService: number;
  
  revenueCash: number;
  revenueTransfer: number;
  
  cashDepositStatus: 'Pending' | 'Verified' | 'Issue';
  paymentStatus: 'Unpaid' | 'Paid' | 'Paid_Transfer'; // Updated
  
  commissionRate: number;
  transportCost: number;
  otherCost: number;
  otherCostDesc: string;
  notes?: string;
  savingRate: number;
  
  technicianDepositAmount: number;
  depositType: 'Transfer' | 'Cash';
  depositReceiver: string;
  depositDestination: string;

  picName?: string;
}

type OperationalTransactionSource = 'finance_recap' | 'technician_billing' | 'transfer_request' | 'manual';

type OperationalTransactionRow = {
  id: string;
  actionId: string;
  report: DailyReport;
  reports: DailyReport[];
  reportIds: string[];
  reportCount: number;
  date: string;
  dateLabel: string;
  technicianName: string;
  role: string;
  type: 'deposit' | 'billing' | 'payout';
  source: OperationalTransactionSource;
  sources?: OperationalTransactionSource[];
  sourceLabel: string;
  requestedAt?: string;
  label: string;
  direction: 'Masuk' | 'Keluar';
  amount: number;
  status: 'done' | 'pending' | 'issue';
  statusLabel: string;
  description: string;
  templateText?: string;
};

type OperationalTransactionTab = 'all' | 'finance' | 'request';

type OperationalTransactionAuditRow = Pick<
  OperationalTransactionRow,
  'id' | 'type' | 'source' | 'sourceLabel' | 'label' | 'direction' | 'amount' | 'description'
> & {
  reportId?: string;
  reportIds?: string[];
  reportSnapshot: DailyReport;
  reportSnapshots?: DailyReport[];
  templateText?: string;
};

const OPERATIONAL_TRANSACTION_AUDIT_ACTIONS = {
  technicianBilling: 'REPORT_TECHNICIAN_BILLING_COPIED',
  financeRecap: 'REPORT_FINANCE_RECAP_COPIED',
  transferRequest: 'REPORT_TRANSFER_REQUEST_COPIED',
} as const;

const OPERATIONAL_TRANSACTION_CANCEL_ACTION = 'REPORT_OPERATIONAL_TRANSACTION_CANCELLED';

const OPERATIONAL_TRANSACTION_SOURCE_LABELS: Record<OperationalTransactionRow['source'], string> = {
  finance_recap: 'Rekap Finance',
  technician_billing: 'Tagihan Teknisi',
  transfer_request: 'Req Transfer',
  manual: 'Manual',
};

const OPERATIONAL_TRANSACTION_TEMPLATE_LABELS: Partial<Record<OperationalTransactionRow['source'], string>> = {
  finance_recap: 'Salin Rekap',
  transfer_request: 'Salin Req Transfer',
};

const getOperationalTransactionTemplateLabel = (tx: OperationalTransactionRow) => {
  if (!tx.templateText) return '';
  if (tx.type === 'billing') return 'Salin Tagihan';
  if (tx.type === 'payout') return 'Salin Req Transfer';
  return OPERATIONAL_TRANSACTION_TEMPLATE_LABELS[tx.source] || '';
};

const getOperationalTransactionSources = (tx: Pick<OperationalTransactionRow, 'source' | 'sources'>) =>
  tx.sources?.length ? tx.sources : [tx.source];

const getCancelledOperationalTransactionActionIds = (logs: any[] = [], localIds: string[] = []) => {
  const ids = new Set(localIds.map(String));

  logs.forEach((log) => {
    const metadata = log?.metadata || {};
    const cancelledActionId = metadata.cancelledActionId || metadata.actionId;

    if (
      log?.action === OPERATIONAL_TRANSACTION_CANCEL_ACTION &&
      metadata.operationalTransactionCancellation &&
      cancelledActionId
    ) {
      ids.add(String(cancelledActionId));
    }
  });

  return ids;
};

const matchesOperationalTransactionTab = (
  tx: OperationalTransactionRow,
  tab: OperationalTransactionTab,
) => {
  const sources = getOperationalTransactionSources(tx);

  if (tab === 'all') return true;
  if (tab === 'request') return tx.type === 'payout' || sources.includes('transfer_request');
  if (tab === 'finance') return sources.includes('finance_recap') && tx.type !== 'payout' && !sources.includes('transfer_request');

  return true;
};

const getOperationalTransactionVisual = (tx: Pick<OperationalTransactionRow, 'type' | 'direction'>) => {
  if (tx.type === 'payout') {
    return {
      categoryLabel: 'Transfer ke Teknisi',
      directionLabel: 'Keluar Teknisi',
      rowClass: 'border-l-4 border-l-violet-500 bg-violet-50/40 hover:bg-violet-50/70',
      categoryClass: 'border-violet-200 bg-violet-50 text-violet-700',
      transactionClass: 'border-violet-200 bg-white text-violet-700',
      directionClass: 'border-violet-200 bg-violet-50 text-violet-700',
      amountClass: 'text-violet-700',
    };
  }

  if (tx.type === 'billing') {
    return {
      categoryLabel: 'Wajib Setoran',
      directionLabel: 'Masuk Kantor',
      rowClass: 'border-l-4 border-l-rose-500 bg-rose-50/30 hover:bg-rose-50/60',
      categoryClass: 'border-rose-200 bg-rose-50 text-rose-700',
      transactionClass: 'border-rose-200 bg-white text-rose-700',
      directionClass: 'border-rose-200 bg-rose-50 text-rose-700',
      amountClass: 'text-rose-700',
    };
  }

  return {
    categoryLabel: 'Wajib Setoran',
    directionLabel: 'Masuk Kantor',
    rowClass: 'border-l-4 border-l-amber-500 bg-amber-50/35 hover:bg-amber-50/70',
    categoryClass: 'border-amber-200 bg-amber-50 text-amber-700',
    transactionClass: 'border-amber-200 bg-white text-amber-700',
    directionClass: 'border-amber-200 bg-amber-50 text-amber-700',
    amountClass: 'text-amber-700',
  };
};

const CANCELLED_OPERATIONAL_TRANSACTION_KEY = 'rhi:cancelled-operational-transactions:v1';

const getReportDateTime = (report: DailyReport) => new Date(report.date).getTime();

const getReportDateRangeLabel = (items: DailyReport[]) => {
  const sorted = [...items].sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (!first || !last) return 'Tanggal laporan';
  if (first.date === last.date) return format(new Date(first.date), 'dd MMM yyyy', { locale: id });
  return `${format(new Date(first.date), 'dd MMM', { locale: id })} - ${format(new Date(last.date), 'dd MMM yyyy', { locale: id })}`;
};

const buildOperationalExpenseForwardRef = (tx: OperationalTransactionRow) => {
  const reportKey = tx.reportIds.length > 0
    ? tx.reportIds.join(',')
    : `${tx.technicianName}-${tx.date}`;

  return `operational-report:${tx.actionId}:${tx.type}:${reportKey}`;
};

const getOperationalTransactionRowDedupeKey = (row: Pick<
  OperationalTransactionAuditRow,
  'source' | 'type' | 'direction' | 'reportId' | 'reportIds' | 'reportSnapshot'
>) => {
  const reportKey = row.reportIds?.length
    ? [...row.reportIds].sort().join(',')
    : row.reportId || row.reportSnapshot?.id || `${row.reportSnapshot?.technicianName || 'unknown'}-${row.reportSnapshot?.date || 'unknown'}`;

  return [row.type, row.direction, reportKey].join('|');
};

const isTechnicianPayoutPaid = (paymentStatus: DailyReport['paymentStatus']) =>
  paymentStatus === 'Paid' || paymentStatus === 'Paid_Transfer';

const getOperationalTransactionSourceLabel = (tx: Pick<OperationalTransactionRow, 'type' | 'sourceLabel'>) => {
  if (tx.type === 'payout') return 'Req Transfer';
  return tx.sourceLabel;
};

const fetchForwardedOperationalExpenseRefs = async () => {
  const params = new URLSearchParams({
    page: '1',
    limit: '200',
    q: 'operational-report:',
    status: 'active',
  });
  const response = await fetch(`${OPERATIONAL_EXPENSES_URL}?${params.toString()}`, {
    headers: await getSessionBackedEdgeHeaders(),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row: any) => String(row?.source_ref || ''))
    .filter((sourceRef: string) => sourceRef.startsWith('operational-report:'));
};

const buildDepositCheckTemplateText = (
  reports: DailyReport[],
  formatRupiah: (num: number) => string
) => {
  const sortedReports = [...reports].sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
  const primaryReport = sortedReports[0];
  if (!primaryReport) return '';

  let totalTarget = 0;
  let totalSetor = 0;
  let totalSelisih = 0;
  let rincianText = '';

  sortedReports.forEach((item, index) => {
      const calcs = calculateFinancials(item);
      const target = calcs.targetSetor;
      const setor = item.technicianDepositAmount || 0;
      const selisih = Math.max(target - setor, 0);

      totalTarget += target;
      totalSetor += setor;
      totalSelisih += selisih;

      rincianText += `${index + 1}. ${format(new Date(item.date), 'dd MMM yyyy', { locale: id })}\n`;
      rincianText += `   - Target Setor: ${formatRupiah(target)}\n`;
      rincianText += `   - Setor Aktual: ${formatRupiah(setor)}\n`;
      rincianText += `   - Selisih: ${formatRupiah(selisih)}\n\n`;
  });

  return `Rekap Finance - Cek Setoran Teknisi\n\n` +
      `Teknisi: ${primaryReport.technicianName}\n` +
      `Tanggal: ${getReportDateRangeLabel(sortedReports)}\n` +
      `Role: ${primaryReport.role}\n\n` +
      `Rincian:\n` +
      rincianText +
      `--------------------------\n` +
      `TOTAL TARGET SETOR: ${formatRupiah(totalTarget)}\n` +
      `TOTAL SETOR AKTUAL: ${formatRupiah(totalSetor)}\n` +
      `TOTAL SELISIH: ${formatRupiah(totalSelisih)}\n\n` +
      `Mohon dicek dan divalidasi. Terima kasih.`;
};

const buildTechnicianBillingTemplateText = (
  reports: DailyReport[],
  formatRupiah: (num: number) => string
) => {
  const sortedReports = [...reports].sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
  const primaryReport = sortedReports[0];
  if (!primaryReport) return '';

  let totalCash = 0;
  let totalHak = 0;
  let totalSetor = 0;
  let totalKurang = 0;
  let rincianText = '';

  sortedReports.forEach((item, index) => {
      const calcs = calculateFinancials(item);
      const kurangSetor = Math.max(calcs.balance, 0);

      totalCash += calcs.cashOnHand;
      totalSetor += item.technicianDepositAmount || 0;
      totalKurang += kurangSetor;
      if (item.role === 'Freelance') totalHak += calcs.netHakTeknisi;

      rincianText += `${index + 1}. ${format(new Date(item.date), 'dd MMM yyyy', { locale: id })}\n`;
      rincianText += `   - Cash Diterima: ${formatRupiah(calcs.cashOnHand)}\n`;
      if (item.role === 'Freelance') {
          rincianText += `   - Potong Hak Teknisi: ${formatRupiah(calcs.netHakTeknisi)}\n`;
      } else {
          if ((item.transportCost || 0) > 0) rincianText += `   - Transport: ${formatRupiah(item.transportCost || 0)}\n`;
          if ((item.otherCost || 0) > 0) rincianText += `   - Biaya Lain: ${formatRupiah(item.otherCost || 0)} ${item.notes ? `(${item.notes})` : ''}\n`;
      }
      rincianText += `   - Sudah Setor: ${formatRupiah(item.technicianDepositAmount || 0)}\n`;
      rincianText += `   - Kurang Setor: ${formatRupiah(kurangSetor)}\n\n`;
  });

  const totalHakLine = primaryReport.role === 'Freelance'
      ? `TOTAL POTONG HAK: ${formatRupiah(totalHak)}\n`
      : '';

  return `Halo ${primaryReport.technicianName},\n` +
      `Berikut rincian tagihan setoran untuk ${getReportDateRangeLabel(sortedReports)}:\n\n` +
      `Rincian:\n` +
      rincianText +
      `--------------------------\n` +
      `TOTAL CASH: ${formatRupiah(totalCash)}\n` +
      totalHakLine +
      `TOTAL SETOR: ${formatRupiah(totalSetor)}\n` +
      `TOTAL KURANG SETOR: ${formatRupiah(totalKurang)}\n\n` +
      `Mohon segera ditransfer ke rekening kantor. Terima kasih.`;
};

// --- Logic: Financial Calculation (Revised for Transparency) ---
const calculateFinancials = (data: DailyReport) => {
  const isFreelanceRole = data.role === 'Freelance';
  const totalRevenue = (data.revenueCash || 0) + (data.revenueTransfer || 0);

  // 1. Hitung Hak Teknisi (Deductions)
  const effectiveCommRate = data.commissionRate || 0;
  const effectiveSavingRate = data.savingRate || 0;

  const commissionAmount = (totalRevenue * effectiveCommRate) / 100;
  const savingAmount = (commissionAmount * effectiveSavingRate) / 100;
  
  // Gross Hak = Hak kotor sebelum potongan tabungan
  // Net Hak = Hak bersih yang bisa dibawa pulang hari ini (atau ditransfer)
  const grossHakTeknisi = commissionAmount + (data.transportCost || 0) + (data.otherCost || 0);
  const netHakTeknisi = grossHakTeknisi - savingAmount;

  // 2. Hitung Kewajiban & Neraca
  const cashOnHand = (data.revenueCash || 0);
  const actualSetor = (data.technicianDepositAmount || 0);
  const cashRetained = cashOnHand - actualSetor; // Uang cash yang masih dipegang teknisi

  let targetSetor = 0; // Berapa yang SEHARUSNYA disetor
  let balance = 0; // Selisih akhir (Positif = Kurang Setor, Negatif = Lebih Setor/Piutang)
  let officeDebt = 0; // Hutang kantor ke teknisi (jika ada)
  
  // Status Bayar Logic:
  // Unpaid: Belum dibayar
  // Paid: Dibayar (bisa potong cash atau transfer, tergantung adaptive logic)
  // Paid_Transfer: Dibayar via Transfer Manual (Full Cash Wajib Setor)
  
  const isPaidTransfer = data.paymentStatus === 'Paid_Transfer';
  const isPaidGeneric = data.paymentStatus === 'Paid';
  const isUnpaid = data.paymentStatus === 'Unpaid';
  const isAutoDeducted = isPaidGeneric && netHakTeknisi > 0 && actualSetor < (cashOnHand - 1000);

  if (isPaidTransfer) {
      // Jika sudah ditransfer manual, teknisi tidak boleh potong cash.
      // Target Setor = Full Cash On Hand.
      targetSetor = cashOnHand;
      
      // Balance = Target - Actual
      balance = targetSetor - actualSetor;
      
      // Office Debt = 0 (Karena sudah Paid)
      officeDebt = 0;
      
      // Jika Balance < 0 (Lebih Setor), itu jadi Hutang Kantor tambahan (Deposit lebih)
      if (balance < 0) {
          officeDebt += Math.abs(balance);
      }
      
  } else if (isUnpaid) {
      // Jika Belum Bayar, teknisi diharapkan setor full cash (nanti dibayar terpisah/bareng gaji)
      // TAPI: Tetap catat Hutang Kantor sebesar Net Hak.
      targetSetor = cashOnHand;
      balance = targetSetor - actualSetor;
      
      officeDebt = netHakTeknisi;
      
      if (balance < 0) officeDebt += Math.abs(balance);
      
  } else {
      // isPaidGeneric ('Paid') -> Legacy / Adaptive Logic (Potong Cash)
      // Asumsi: Jika status Paid tapi Actual Setor < Cash, berarti potong cash.
      
      if (isAutoDeducted) {
           targetSetor = Math.max(0, cashOnHand - netHakTeknisi);
      } else {
           targetSetor = cashOnHand;
      }
      
      balance = targetSetor - actualSetor;
      officeDebt = 0; // Paid
      
      if (balance < 0) officeDebt += Math.abs(balance);
  }

  // Label Status Pembayaran Hak (Payout)
  let payoutStatusLabel = 'Clear';
  if (officeDebt > 0) {
      payoutStatusLabel = 'Belum Bayar';
  } else if (isPaidTransfer) {
      payoutStatusLabel = 'Lunas (Transfer)';
  } else if (netHakTeknisi > 0 && balance === 0) {
      payoutStatusLabel = 'Lunas (Potong)';
  } else {
      payoutStatusLabel = 'Lunas';
  }

  return {
    totalRevenue,
    commissionAmount,
    savingAmount,
    grossHakTeknisi,
    netHakTeknisi,
    targetSetor,
    balance,
    cashOnHand,
    actualSetor,
    cashRetained,
    officeDebt,
    payoutStatusLabel,
    isAutoDeducted
  };
};

interface LaporanProps {
  mode?: 'daily' | 'finance';
}

export function Laporan({ mode: _mode = 'daily' }: LaporanProps) {
  const isMobile = useIsMobile();
  const { currentUser, users, payments, orders, auditLogs = [] } = useMasterData();
  const { hasPermission } = usePermissions();
  const canViewReport = hasPermission('daily_report.view') || hasPermission('finance_report.view');
  const canValidateOperationalTransactions = hasPermission('finance.manage') || hasPermission('daily_report.edit');
  const canViewOperationalExpenses = hasPermission('operational_expenses.view') || hasPermission('operational_expenses.create');
  const canForwardOperationalExpenses = hasPermission('operational_expenses.create');

  if (!canViewReport) {
      return (
        <div className="flex flex-col items-center justify-center h-[80vh] text-slate-400">
          <AlertTriangle className="w-12 h-12 mb-4 text-slate-300" />
          <h2 className="text-lg font-semibold text-slate-600">Akses Dibatasi</h2>
          <p>Anda tidak memiliki izin untuk melihat halaman ini.</p>
        </div>
      );
  }
  
  // --- Filters ---
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    return {
      from: subDays(today, 6),
      to: today,
    };
  });
  const [dateTypeFilter, setDateTypeFilter] = useState<'service_date' | 'created_at'>('service_date');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Paid' | 'Unpaid'>('all');
  const [technicianFilter, setTechnicianFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<DailyReport | null>(null);
  const [initialFormData, setInitialFormData] = useState<DailyReport | null>(null);
  
  const [showUnsavedAlert, setShowUnsavedAlert] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingOrder, setIsFetchingOrder] = useState(false);
  const [activeTechnicians, setActiveTechnicians] = useState<any[]>([]);
  
  // --- Bulk Selection State ---
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [localTransactionLogs, setLocalTransactionLogs] = useState<any[]>([]);
  const activeTransactionDedupeKeysRef = useRef<Set<string>>(new Set());
  const [cancelledTransactionActionIds, setCancelledTransactionActionIds] = useState<string[]>(() => {
      if (typeof window === 'undefined') return [];
      try {
          const raw = window.localStorage.getItem(CANCELLED_OPERATIONAL_TRANSACTION_KEY);
          return raw ? JSON.parse(raw) : [];
      } catch {
          return [];
      }
  });
  const [pendingBulkAction, setPendingBulkAction] = useState<{
      kind: 'billing' | 'finance' | 'transfer';
      title: string;
      description: string;
      confirmLabel: string;
  } | null>(null);
  const [pendingDeleteReport, setPendingDeleteReport] = useState<DailyReport | null>(null);
  const [pendingTransactionCancel, setPendingTransactionCancel] = useState<OperationalTransactionRow | null>(null);
  const [forwardedExpenseRefs, setForwardedExpenseRefs] = useState<string[]>([]);
  const cancelledOperationalTransactionActionIds = useMemo(
      () => getCancelledOperationalTransactionActionIds([...(auditLogs || []), ...localTransactionLogs], cancelledTransactionActionIds),
      [auditLogs, cancelledTransactionActionIds, localTransactionLogs],
  );

  useEffect(() => {
      if (!canViewOperationalExpenses) return;

      let cancelled = false;
      fetchForwardedOperationalExpenseRefs()
          .then((serverRefs) => {
              if (cancelled) return;
              setForwardedExpenseRefs(Array.from(new Set(serverRefs)));
          })
          .catch((error) => {
              console.warn('[Laporan] Gagal sinkron status forward biaya operasional:', error);
          });

      return () => {
          cancelled = true;
      };
  }, [canViewOperationalExpenses]);

  const handleToggleSelect = (id: string) => {
      setSelectedReportIds(prev => 
          prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
      );
  };

  const handleToggleSelectAll = () => {
      if (selectedReportIds.length === filteredReports.length) {
          setSelectedReportIds([]);
      } else {
          setSelectedReportIds(filteredReports.map(rep => rep.id!));
      }
  };

  const selectedReportsForBulkAction = reports.filter(rep => selectedReportIds.includes(rep.id!));

  const requestBulkAction = (kind: 'billing' | 'finance' | 'transfer') => {
      if (selectedReportIds.length === 0) {
          toast.error('Pilih laporan harian dulu.');
          return;
      }

      const actionCopy = {
          billing: {
              title: 'Salin tagihan teknisi?',
              description: `Tagihan untuk ${selectedReportIds.length} laporan akan disalin dan dicatat sebagai transaksi Tagihan Kurang Setor.`,
              confirmLabel: 'Ya, Salin Tagihan',
          },
          finance: {
              title: 'Buat rekap finance?',
              description: `${selectedReportIds.length} laporan akan dibuat menjadi transaksi Cek Setoran Teknisi untuk validator finance.`,
              confirmLabel: 'Ya, Buat Rekap',
          },
          transfer: {
              title: 'Buat req transfer?',
              description: `${selectedReportIds.length} laporan akan dibuat menjadi transaksi Req Transfer jika ada nominal yang harus dibayar finance.`,
              confirmLabel: 'Ya, Buat Req Transfer',
          },
      }[kind];

      setPendingBulkAction({ kind, ...actionCopy });
  };

  const confirmPendingBulkAction = async () => {
      if (!pendingBulkAction) return;

      const action = pendingBulkAction.kind;
      setPendingBulkAction(null);

      if (action === 'billing') {
          await handleBulkCopy();
          return;
      }
      if (action === 'finance') {
          await handleBulkCopyFinance();
          return;
      }
      await handleBulkCopyTransferRequest();
  };

  const createTransactionActionId = (source: OperationalTransactionRow['source']) => {
      const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return `operational-transaction:${source}:${randomPart}`;
  };

  const buildActionTransactionRows = (
      source: OperationalTransactionRow['source'],
      selectedReports: DailyReport[]
  ): OperationalTransactionAuditRow[] => {
      const sourceLabel = OPERATIONAL_TRANSACTION_SOURCE_LABELS[source];
      const groups = selectedReports.reduce((acc, report) => {
          const key = report.technicianId || report.technicianName;
          if (!acc[key]) acc[key] = [];
          acc[key].push(report);
          return acc;
      }, {} as Record<string, DailyReport[]>);

      return Object.entries(groups).flatMap(([groupKey, items]) => {
          const sortedItems = [...items].sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
          const primaryReport = sortedItems[0];
          const reportSnapshot = { ...primaryReport };
          const reportSnapshots = sortedItems.map((report) => ({ ...report }));
          const reportIds = sortedItems.map((report) => report.id).filter(Boolean) as string[];
          const dateRangeLabel = getReportDateRangeLabel(sortedItems);
          const rows: OperationalTransactionAuditRow[] = [];
          const buildTransferRequestText = (amount: number) => {
              let rincianText = '';

              sortedItems.forEach((item) => {
                  const calcs = calculateFinancials(item);
                  const hakTransfer = Math.max(calcs.officeDebt, 0);
                  if (hakTransfer <= 0) return;

                  rincianText += `- Tgl ${format(new Date(item.date), 'dd/MM')}: (Hak ${formatRupiah(hakTransfer)})\n`;
                  rincianText += `  - Revenue: ${formatRupiah(calcs.totalRevenue)}\n`;
                  if (calcs.commissionAmount > 0) rincianText += `  - Komisi: ${formatRupiah(calcs.commissionAmount)}\n`;
                  if (item.transportCost > 0) rincianText += `  - Transport: ${formatRupiah(item.transportCost)}\n`;
                  if (item.otherCost > 0) rincianText += `  - Biaya Lain: ${formatRupiah(item.otherCost)} (${item.notes || item.otherCostDesc || '-'})\n`;
                  rincianText += `\n`;
              });

              return `Request Transfer Hak Teknisi\n\n` +
                  `Teknisi: ${primaryReport.technicianName}\n` +
                  `Tanggal: ${dateRangeLabel}\n` +
                  `Role: ${primaryReport.role}\n\n` +
                  `Rincian:\n` +
                  rincianText +
                  `--------------------------\n` +
                  `TOTAL TRANSFER: ${formatRupiah(amount)}\n\n` +
                  `Mohon diproses transfer ke rekening teknisi. Terima kasih.`;
          };
          const buildDepositCheckText = () => {
              let totalTarget = 0;
              let totalSetor = 0;
              let totalSelisih = 0;
              let rincianText = '';

              sortedItems.forEach((item, index) => {
                  const calcs = calculateFinancials(item);
                  const target = calcs.targetSetor;
                  const setor = item.technicianDepositAmount || 0;
                  const selisih = Math.max(target - setor, 0);

                  totalTarget += target;
                  totalSetor += setor;
                  totalSelisih += selisih;

                  rincianText += `${index + 1}. ${format(new Date(item.date), 'dd MMM yyyy', { locale: id })}\n`;
                  rincianText += `   - Target Setor: ${formatRupiah(target)}\n`;
                  rincianText += `   - Setor Aktual: ${formatRupiah(setor)}\n`;
                  rincianText += `   - Selisih: ${formatRupiah(selisih)}\n\n`;
              });

              return `Rekap Finance - Cek Setoran Teknisi\n\n` +
                  `Teknisi: ${primaryReport.technicianName}\n` +
                  `Tanggal: ${dateRangeLabel}\n` +
                  `Role: ${primaryReport.role}\n\n` +
                  `Rincian:\n` +
                  rincianText +
                  `--------------------------\n` +
                  `TOTAL TARGET SETOR: ${formatRupiah(totalTarget)}\n` +
                  `TOTAL SETOR AKTUAL: ${formatRupiah(totalSetor)}\n` +
                  `TOTAL SELISIH: ${formatRupiah(totalSelisih)}\n\n` +
                  `Mohon dicek dan divalidasi. Terima kasih.`;
          };

          if (source === 'technician_billing') {
              const totalBilling = sortedItems.reduce((total, report) => {
                  const calcs = calculateFinancials(report);
                  return total + Math.max(calcs.balance, 0);
              }, 0);

              if (totalBilling > 500) {
                  rows.push({
                      id: `${groupKey}-billing-${source}`,
                      reportId: primaryReport.id,
                      reportIds,
                      reportSnapshot,
                      reportSnapshots,
                      type: 'billing',
                      source,
                      sourceLabel,
                      label: 'Tagihan Kurang Setor',
                      direction: 'Masuk',
                      amount: totalBilling,
                      description: `Tagihan gabungan ${sortedItems.length} laporan (${dateRangeLabel}).`,
                      templateText: buildTechnicianBillingTemplateText(sortedItems, formatRupiah),
                  });
              }
              return rows;
          }

          if (source === 'finance_recap') {
              const depositRows = sortedItems.map((report) => {
                  const calcs = calculateFinancials(report);
                  return {
                      report,
                      calcs,
                      amount: Math.max(report.technicianDepositAmount || 0, calcs.targetSetor || calcs.cashOnHand || 0),
                  };
              }).filter(({ report, calcs }) => calcs.cashOnHand > 0 || report.technicianDepositAmount > 0 || Math.abs(calcs.balance) > 500);
              const totalDepositCheck = depositRows.reduce((total, row) => total + row.amount, 0);

              if (totalDepositCheck > 0) {
                  rows.push({
                      id: `${groupKey}-deposit-${source}`,
                      reportId: primaryReport.id,
                      reportIds,
                      reportSnapshot,
                      reportSnapshots,
                      type: 'deposit',
                      source,
                      sourceLabel,
                      label: 'Cek Setoran Teknisi',
                      direction: 'Masuk',
                      amount: totalDepositCheck,
                      description: `Cek setoran gabungan ${depositRows.length} laporan (${dateRangeLabel}).`,
                      templateText: buildDepositCheckText(),
                  });
              }

              return rows;
          }

          if (source === 'transfer_request') {
              const totalTransfer = sortedItems.reduce((total, report) => {
                  const calcs = calculateFinancials(report);
                  return total + Math.max(calcs.officeDebt, 0);
              }, 0);

              if (totalTransfer > 0) {
                  rows.push({
                      id: `${groupKey}-payout-${source}`,
                      reportId: primaryReport.id,
                      reportIds,
                      reportSnapshot,
                      reportSnapshots,
                      type: 'payout',
                      source,
                      sourceLabel,
                      label: 'Req Transfer Teknisi',
                      direction: 'Keluar',
                      amount: totalTransfer,
                      description: `Permintaan transfer gabungan ${sortedItems.length} laporan (${dateRangeLabel}).`,
                      templateText: buildTransferRequestText(totalTransfer),
                  });
              }
              return rows;
          }

          return rows;
      });
  };

  const recordOperationalTransactionAction = (
      source: OperationalTransactionRow['source'],
      selectedReports: DailyReport[],
      templateText?: string
  ) => {
      const rows = buildActionTransactionRows(source, selectedReports);
      if (rows.length === 0) return false;
      const knownActions = new Set<string>(Object.values(OPERATIONAL_TRANSACTION_AUDIT_ACTIONS));
      const activeExistingKeys = new Set<string>();

      [...localTransactionLogs, ...(auditLogs || [])].forEach((log: any) => {
          const metadata = log?.metadata || {};
          const actionId = String(metadata.actionId || log?.id || '');
          const existingRows = Array.isArray(metadata.rows) ? metadata.rows as OperationalTransactionAuditRow[] : [];

          if (!metadata.operationalTransactionBatch) return;
          if (!knownActions.has(String(log?.action || ''))) return;
          if (!actionId || cancelledOperationalTransactionActionIds.has(actionId)) return;

          existingRows.forEach((row) => {
              activeExistingKeys.add(getOperationalTransactionRowDedupeKey(row));
          });
      });

      activeTransactionDedupeKeysRef.current.forEach((key) => {
          activeExistingKeys.add(key);
      });

      const uniqueRows = rows.filter((row) => !activeExistingKeys.has(getOperationalTransactionRowDedupeKey(row)));
      if (uniqueRows.length === 0) {
          toast.info('Transaksi untuk laporan ini sudah ada di tab Transaksi.');
          return false;
      }

      uniqueRows.forEach((row) => {
          activeTransactionDedupeKeysRef.current.add(getOperationalTransactionRowDedupeKey(row));
      });

      const createdAt = new Date().toISOString();
      const actionId = createTransactionActionId(source);
      const actionMap: Partial<Record<OperationalTransactionRow['source'], string>> = {
          finance_recap: OPERATIONAL_TRANSACTION_AUDIT_ACTIONS.financeRecap,
          technician_billing: OPERATIONAL_TRANSACTION_AUDIT_ACTIONS.technicianBilling,
          transfer_request: OPERATIONAL_TRANSACTION_AUDIT_ACTIONS.transferRequest,
      };
      const action = actionMap[source] || 'REPORT_OPERATIONAL_TRANSACTION_COPIED';
      const metadata = {
          operationalTransactionBatch: true,
          actionId,
          source,
          sourceLabel: OPERATIONAL_TRANSACTION_SOURCE_LABELS[source],
          reportIds: selectedReports.map((report) => report.id).filter(Boolean),
          rows: uniqueRows,
          templateText,
      };

      setLocalTransactionLogs((prev) => [
          {
              id: actionId,
              created_at: createdAt,
              action,
              entity: 'Laporan Operasional',
              entity_id: actionId,
              metadata,
          },
          ...prev,
      ]);

      if (currentUser) {
          logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              action,
              'Laporan Operasional',
              `${OPERATIONAL_TRANSACTION_SOURCE_LABELS[source]} dibuat dari ${uniqueRows.length} transaksi`,
              actionId,
              metadata,
          );
      }

      return true;
  };

  const handleBulkCopy = async () => {
      const selectedReports = reports.filter(rep => selectedReportIds.includes(rep.id!));
      if (selectedReports.length === 0) return;

      // Group by Technician
      const groups = selectedReports.reduce((acc, curr) => {
          if (!acc[curr.technicianName]) {
              acc[curr.technicianName] = [];
          }
          acc[curr.technicianName].push(curr);
          return acc;
      }, {} as Record<string, DailyReport[]>);

      let finalText = "";

      Object.entries(groups).forEach(([techName, items]) => {
          // Sort by date
          items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
          let totalCash = 0;
          let totalHak = 0;
          let totalSetor = 0;
          let totalBalance = 0;
          
          finalText += `*REKAP SETORAN - ${techName.toUpperCase()}*\n`;
          finalText += `Periode: ${format(new Date(items[0].date), 'dd MMM')} s/d ${format(new Date(items[items.length-1].date), 'dd MMM yyyy')}\n\n`;
          
          items.forEach((item, idx) => {
             const calcs = calculateFinancials(item);
             const bal = calcs.balance;
             
             totalCash += calcs.cashOnHand;
             if (item.role === 'Freelance') totalHak += calcs.netHakTeknisi;
             totalSetor += (item.technicianDepositAmount || 0);
             totalBalance += bal;

             let statusDetail = "";
             if (bal === 0) statusDetail = "LUNAS";
             else if (bal > 0) statusDetail = `KURANG ${formatRupiah(bal)}`;
             else statusDetail = `LEBIH ${formatRupiah(Math.abs(bal))}`;

             // Rincian per hari
             finalText += `${idx + 1}. ${format(new Date(item.date), 'dd MMM')}:\n`;
             finalText += `   • Cash: ${formatRupiah(calcs.cashOnHand)}\n`;
             
             if (item.role === 'Freelance') {
                finalText += `   • Potong Hak: ${formatRupiah(calcs.netHakTeknisi)}\n`;
             } else if (calcs.officeDebt > 0 && !isTechnicianPayoutPaid(item.paymentStatus)) {
                 finalText += `   • Belum Bayar (Hak): ${formatRupiah(calcs.officeDebt)}\n`;
             }
             
             finalText += `   • Setor: ${formatRupiah(item.technicianDepositAmount || 0)}\n`;
             finalText += `   => Status: *${statusDetail}*\n\n`;
          });

          finalText += `--------------------------------\n`;
          finalText += `*TOTAL AKHIR*\n`;
          finalText += `Total Cash: ${formatRupiah(totalCash)}\n`;
          if (items[0].role === 'Freelance') finalText += `Total Potongan Hak: ${formatRupiah(totalHak)}\n`;
          finalText += `Total Setor: ${formatRupiah(totalSetor)}\n`;
          finalText += `--------------------------------\n`;
          
          if (totalBalance > 0) {
              finalText += `*TOTAL KURANG SETOR: ${formatRupiah(totalBalance)}* ❌\n`;
          } else if (totalBalance < 0) {
              finalText += `*TOTAL LEBIH SETOR (HUTANG KANTOR): ${formatRupiah(Math.abs(totalBalance))}* 🔵\n`;
          } else {
              finalText += `*STATUS: LUNAS / CLEAR* ✅\n`;
          }
          finalText += `\n`;
      });

      if (recordOperationalTransactionAction('technician_billing', selectedReports, finalText)) {
          handleCopy(finalText);
      }
  };

  const handleBulkCopyFinance = async () => {
      const selectedReports = reports.filter(rep => selectedReportIds.includes(rep.id!));
      if (selectedReports.length === 0) return;

      // Sort by date
      selectedReports.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let finalText = `*LAPORAN REKAP FINANCE*\n`;
      finalText += `Tgl Cetak: ${format(new Date(), 'dd MMM yyyy HH:mm')}\n`;
      finalText += `Item Terpilih: ${selectedReports.length} Data\n`;
      finalText += `--------------------------------\n\n`;

      let grandTotalOmset = 0;
      let grandTotalCash = 0;
      let grandTotalTrf = 0;
      let grandTotalSetorAktual = 0;
      let grandTotalBalance = 0; // Positif = Piutang (Kurang Setor), Negatif = Hutang (Lebih Setor)

      selectedReports.forEach((item, idx) => {
          const calcs = calculateFinancials(item);
          
          // Akumulasi Global
          grandTotalOmset += calcs.totalRevenue;
          grandTotalCash += (item.revenueCash || 0);
          grandTotalTrf += (item.revenueTransfer || 0);
          grandTotalSetorAktual += (item.technicianDepositAmount || 0);
          grandTotalBalance += calcs.balance;

          finalText += `${idx + 1}. *${item.technicianName}* (${format(new Date(item.date), 'dd MMM')})\n`;
          finalText += `   • Cash: ${formatRupiah(calcs.cashOnHand)}\n`;
          finalText += `   • Setor: ${formatRupiah(item.technicianDepositAmount || 0)}\n`;
          
          if (calcs.balance > 0) finalText += `   • Status: KURANG ${formatRupiah(calcs.balance)}\n`;
          else if (calcs.balance < 0) finalText += `   • Status: LEBIH ${formatRupiah(Math.abs(calcs.balance))}\n`;
          else finalText += `   • Status: LUNAS\n`;
          
          finalText += `\n`;
      });

      finalText += `--------------------------------\n`;
      finalText += `*SUMMARY TOTAL*\n`;
      finalText += `Total Omset: ${formatRupiah(grandTotalOmset)}\n`;
      finalText += `   ├ Cash: ${formatRupiah(grandTotalCash)}\n`;
      finalText += `   └ Trf: ${formatRupiah(grandTotalTrf)}\n\n`;
      
      finalText += `Total Setor Aktual: ${formatRupiah(grandTotalSetorAktual)}\n`;
      
      if (grandTotalBalance > 0) {
         finalText += `Total Kurang Setor (Piutang): ${formatRupiah(grandTotalBalance)}\n`;
      } else if (grandTotalBalance < 0) {
         finalText += `Total Lebih Setor (Hutang): ${formatRupiah(Math.abs(grandTotalBalance))}\n`;
      } else {
         finalText += `Status Balance: CLEAR\n`;
      }

      if (recordOperationalTransactionAction('finance_recap', selectedReports, finalText)) {
          setViewMode('transactions');
          setSelectedReportIds([]);
          toast.success('Rekap Finance dibuat di tab Transaksi.');
      }
  };

  const handleBulkCopyTransferRequest = async () => {
      const selectedReports = reports.filter(rep => selectedReportIds.includes(rep.id!));
      if (selectedReports.length === 0) return;

      // Group by Technician
      const groups = selectedReports.reduce((acc, curr) => {
          if (!acc[curr.technicianName]) {
              acc[curr.technicianName] = [];
          }
          acc[curr.technicianName].push(curr);
          return acc;
      }, {} as Record<string, DailyReport[]>);

      let finalText = "";
      let hasData = false;

      Object.entries(groups).forEach(([techName, items]) => {
          items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
          // Hitung total transfer untuk teknisi ini
          let techTotalTransfer = 0;
          let rincianText = "";

          items.forEach((item) => {
             const calcs = calculateFinancials(item);
             const hakTransfer = calcs.officeDebt; // Hanya ambil yang statusnya Hutang Kantor

             if (hakTransfer > 0) {
                 techTotalTransfer += hakTransfer;
                 
                 rincianText += `- Tgl ${format(new Date(item.date), 'dd/MM')}: (Hak ${formatRupiah(hakTransfer)})\n`;
                 // Rincian pendukung
                 rincianText += `  • Revenue: ${formatRupiah(calcs.totalRevenue)}\n`;
                 if (calcs.commissionAmount > 0) rincianText += `  • Komisi: ${formatRupiah(calcs.commissionAmount)}\n`;
                 if (item.transportCost > 0) rincianText += `  • Transport: ${formatRupiah(item.transportCost)}\n`;
                 if (item.otherCost > 0) rincianText += `  • Biaya Lain: ${formatRupiah(item.otherCost)} (${item.notes || item.otherCostDesc || '-'})\n`;
                 rincianText += `\n`;
             }
          });

          if (techTotalTransfer > 0) {
              hasData = true;
              const role = items[0].role;
              const dateRangeStr = items.length === 1 
                ? format(new Date(items[0].date), 'dd MMMM yyyy', { locale: id })
                : `${format(new Date(items[0].date), 'dd MMM')} - ${format(new Date(items[items.length-1].date), 'dd MMM yyyy', { locale: id })}`;

              finalText += `Request Transfer Hak Teknisi\n\n`;
              finalText += `Teknisi: ${techName}\n`;
              finalText += `Tanggal: ${dateRangeStr}\n`;
              finalText += `Role: ${role}\n\n`;
              finalText += `Rincian:\n`;
              finalText += rincianText;
              finalText += `--------------------------\n`;
              finalText += `TOTAL TRANSFER: ${formatRupiah(techTotalTransfer)}\n\n`;
              finalText += `Mohon diproses transfer ke rekening teknisi. Terima kasih.\n\n`;
              finalText += `================================\n\n`;
          }
      });

      if (!hasData) {
          toast.error("Tidak ada data 'Bayar ke Teknisi' (Office Debt) pada item yang dipilih.");
          return;
      }

      if (recordOperationalTransactionAction('transfer_request', selectedReports, finalText)) {
          setViewMode('transactions');
          setSelectedReportIds([]);
          toast.success('Req Transfer dibuat di tab Transaksi.');
      }
  };

  // Detail Dialog State
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedDetailReport, setSelectedDetailReport] = useState<DailyReport | null>(null);
  const [selectedDetailReports, setSelectedDetailReports] = useState<DailyReport[]>([]);
  const [pendingValidation, setPendingValidation] = useState<{
      kind: 'deposit' | 'payout';
      reportIds: string[];
      title: string;
      description: string;
  } | null>(null);

  const handleViewDetail = (reportOrReports: DailyReport | DailyReport[]) => {
      const detailReports = Array.isArray(reportOrReports) ? reportOrReports : [reportOrReports];
      setSelectedDetailReports(detailReports);
      setSelectedDetailReport(detailReports[0] || null);
      setIsDetailOpen(true);
  };

  const requestTransactionValidation = (tx: OperationalTransactionRow, kind: 'deposit' | 'payout') => {
      if (!canValidateOperationalTransactions) {
          toast.error('Akses validasi finance belum aktif untuk akun ini.');
          return;
      }

      if (tx.reportIds.length === 0) {
          toast.error('Data laporan harian untuk validasi tidak ditemukan.');
          return;
      }

      setPendingValidation({
          kind,
          reportIds: tx.reportIds,
          title: kind === 'deposit' ? 'Validasi Setoran?' : 'Validasi Transfer?',
          description: kind === 'deposit'
              ? `Setoran ${tx.technicianName} untuk ${tx.reportCount} laporan akan ditandai terverifikasi. Data di List Harian ikut berubah.`
              : `Transfer ${tx.technicianName} untuk ${tx.reportCount} laporan akan ditandai sudah dibayar. Data di List Harian ikut berubah.`,
      });
  };

  const requestSinglePaymentValidation = (report: DailyReport) => {
      if (!canValidateOperationalTransactions) {
          toast.error('Akses validasi finance belum aktif untuk akun ini.');
          return;
      }

      if (!report.id) {
          toast.error('Data laporan harian untuk validasi tidak ditemukan.');
          return;
      }

      setPendingValidation({
          kind: 'payout',
          reportIds: [report.id],
          title: 'Validasi Transfer?',
          description: `Transfer untuk laporan ${report.technicianName} tanggal ${format(new Date(report.date), 'dd MMM yyyy', { locale: id })} akan ditandai sudah dibayar. Data di List Harian ikut berubah.`,
      });
  };

  const confirmPendingValidation = async () => {
      if (!pendingValidation) return;

      const validation = pendingValidation;
      setPendingValidation(null);

      if (validation.kind === 'deposit') {
          await handleUpdateDepositStatus(validation.reportIds, 'Verified');
          return;
      }

      await handleUpdatePaymentStatus(validation.reportIds, 'Paid_Transfer');
  };

  const cancelOperationalTransaction = (tx: OperationalTransactionRow) => {
      const cancelledAt = new Date().toISOString();
      const cancellationLogId = `${tx.actionId}-cancelled-${Date.now()}`;
      const cancellationMetadata = {
          operationalTransactionCancellation: true,
          cancelledActionId: tx.actionId,
          transactionId: tx.id,
          source: tx.source,
          type: tx.type,
          direction: tx.direction,
          reportIds: tx.reportIds,
          amount: tx.amount,
          label: tx.label,
          cancelledAt,
      };

      activeTransactionDedupeKeysRef.current.delete(getOperationalTransactionRowDedupeKey({
          source: tx.source,
          type: tx.type,
          direction: tx.direction,
          reportIds: tx.reportIds,
          reportSnapshot: tx.report,
      }));
      const nextIds = Array.from(new Set([...cancelledTransactionActionIds, tx.actionId]));
      setCancelledTransactionActionIds(nextIds);
      if (typeof window !== 'undefined') {
          window.localStorage.setItem(CANCELLED_OPERATIONAL_TRANSACTION_KEY, JSON.stringify(nextIds));
      }
      setLocalTransactionLogs((prev) => [
          {
              id: cancellationLogId,
              created_at: cancelledAt,
              action: OPERATIONAL_TRANSACTION_CANCEL_ACTION,
              entity: 'Laporan Operasional',
              entity_id: tx.actionId,
              metadata: cancellationMetadata,
          },
          ...prev.filter((log) => (log?.metadata?.actionId || log?.id) !== tx.actionId),
      ]);
      if (currentUser) {
          logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              OPERATIONAL_TRANSACTION_CANCEL_ACTION,
              'Laporan Operasional',
              `${tx.status === 'done' ? 'Menghapus' : 'Membatalkan'} transaksi ${tx.label} ${tx.technicianName} dari daftar`,
              tx.actionId,
              cancellationMetadata,
          );
      }
      setPendingTransactionCancel(null);
      toast.success(tx.status === 'done' ? 'Transaksi disembunyikan dari daftar.' : 'Permintaan transaksi dibatalkan dari daftar.');
  };

  const handleUpdatePaymentStatus = async (reportId: string | string[], status: 'Paid' | 'Paid_Transfer' | 'Unpaid') => {
      if (!canValidateOperationalTransactions) {
          toast.error('Akses validasi finance belum aktif untuk akun ini.');
          return;
      }

      try {
          const reportIds = Array.isArray(reportId) ? reportId : [reportId];
          const { error } = await supabase
              .from('technician_daily_reports')
              .update({ payment_status: status })
              .in('id', reportIds);

          if (error) throw error;

          toast.success(
            isTechnicianPayoutPaid(status)
              ? status === 'Paid_Transfer'
                ? 'Status ditandai LUNAS (Sudah Transfer)'
                : 'Status ditandai LUNAS'
              : 'Status ditandai BELUM BAYAR'
          );
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'PAYMENT', 'Laporan Harian',
              `Mengubah status pembayaran ${reportIds.length} laporan menjadi ${isTechnicianPayoutPaid(status) ? status === 'Paid_Transfer' ? 'Lunas Transfer' : 'Lunas' : 'Belum Bayar'}`,
              reportIds.join(',')
            );
          }

          // Optimistic update
          setReports(prev => prev.map(r => r.id && reportIds.includes(r.id) ? { ...r, paymentStatus: status } : r));
          if (selectedDetailReport?.id && reportIds.includes(selectedDetailReport.id)) {
              setSelectedDetailReport(prev => prev ? { ...prev, paymentStatus: status } : null);
          }
          setSelectedDetailReports(prev => prev.map(r => r.id && reportIds.includes(r.id) ? { ...r, paymentStatus: status } : r));
      } catch (err: any) {
          toast.error("Gagal update status: " + err.message);
      }
  };

  const handleUpdateDepositStatus = async (reportId: string | string[], status: 'Pending' | 'Verified' | 'Issue') => {
      if (!canValidateOperationalTransactions) {
          toast.error('Akses validasi finance belum aktif untuk akun ini.');
          return;
      }

      try {
          const reportIds = Array.isArray(reportId) ? reportId : [reportId];
          const { error } = await supabase
              .from('technician_daily_reports')
              .update({ deposit_status: status })
              .in('id', reportIds);

          if (error) throw error;

          toast.success(status === 'Verified' ? 'Setoran ditandai sudah masuk' : 'Status setoran diperbarui');
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'PAYMENT', 'Laporan Harian',
              `Mengubah status setoran ${reportIds.length} laporan menjadi ${status}`,
              reportIds.join(',')
            );
          }

          setReports(prev => prev.map(r => r.id && reportIds.includes(r.id) ? { ...r, cashDepositStatus: status } : r));
          if (selectedDetailReport?.id && reportIds.includes(selectedDetailReport.id)) {
              setSelectedDetailReport(prev => prev ? { ...prev, cashDepositStatus: status } : null);
          }
          setSelectedDetailReports(prev => prev.map(r => r.id && reportIds.includes(r.id) ? { ...r, cashDepositStatus: status } : r));
      } catch (err: any) {
          toast.error("Gagal update status setoran: " + err.message);
      }
  };

  const handleForwardToOperationalExpenses = (tx: OperationalTransactionRow) => {
      if (!canForwardOperationalExpenses) {
          toast.error('Akses tambah Biaya Operasional belum aktif untuk akun ini.');
          return;
      }

      if (tx.direction !== 'Keluar') {
          toast.error('Hanya transaksi keluar yang bisa diteruskan ke Biaya Operasional.');
          return;
      }

      try {
          const sourceRef = buildOperationalExpenseForwardRef(tx);
          const serviceDateLabel = tx.date
              ? format(new Date(tx.date), 'dd MMM yyyy', { locale: id })
              : 'tanggal laporan';
          const isRefund = tx.label.toLowerCase().includes('refund');
          const draft: OperationalExpenseForwardDraft = {
              source: 'operational-report-transaction',
              source_type: 'cash_out_forward',
              report_id: tx.report.id,
              transaction_id: tx.id,
              expense_date: tx.date || new Date().toISOString().slice(0, 10),
              branch_id: 'all',
              category: isRefund ? 'Pengeluaran Lain - lain' : 'Beban Operasional',
              subcategory: isRefund ? 'Lain - lain tidak Rutin' : 'Gaji & Komisi',
              vendor_name: tx.technicianName,
              description: `${tx.label} - ${tx.technicianName} (${serviceDateLabel})`,
              amount: String(tx.amount || ''),
              payment_source: '',
              source_ref: sourceRef,
              notes: `Draft dari Laporan Operasional > Transaksi. ${tx.description}`,
              auto_save: true,
              created_at: new Date().toISOString(),
          };

          window.localStorage.setItem(OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY, JSON.stringify(draft));
          toast.success('Biaya Operasional sedang dibuat.');
          window.location.href = '/finance/operational-expenses?draft=operational-report';
      } catch {
          toast.error('Gagal menyiapkan draft Biaya Operasional.');
      }
  };

  const handleCopy = (text: string) => {
      copyToClipboard(text, { successMessage: "Info berhasil disalin!" });
  };

  // --- Fetch Data ---

  const fetchData = async () => {
    setLoading(true);

    try {
      let query = supabase
        .from('technician_daily_reports')
        .select('*')
        .order('created_at', { ascending: false });

      // Apply Date Filter
      if (dateRange?.from) {
         if (dateTypeFilter === 'service_date') {
             // Filter by Service Date (Column type: Date)
             const fromStr = format(dateRange.from, 'yyyy-MM-dd');
             const toStr = dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;
             query = query.gte('service_date', fromStr).lte('service_date', toStr);
         } else {
             // Filter by Created At (Column type: Timestamp)
             // Use explicit start/end of day to handle time correctly
             const fromISO = startOfDay(dateRange.from).toISOString();
             const toISO = endOfDay(dateRange.to || dateRange.from).toISOString();
             query = query.gte('created_at', fromISO).lte('created_at', toISO);
         }
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      const mapped: DailyReport[] = (data || []).map((reportItem: any) => ({
         id: reportItem.id,
         createdAt: reportItem.created_at,
         date: reportItem.service_date,
         technicianId: reportItem.technician_id,
         technicianName: reportItem.technician_name,
         role: reportItem.technician_role || 'Karyawan',
         totalOrders: reportItem.total_orders || 0,
         totalFinished: reportItem.total_finished || 0,
         totalVisit: reportItem.total_visit || 0,
         totalHomeService: reportItem.total_home_service || 0,
         revenueCash: reportItem.revenue_cash || 0,
         revenueTransfer: reportItem.revenue_transfer || 0,
         technicianDepositAmount: reportItem.deposit_amount || 0,
         depositType: reportItem.deposit_method || 'Transfer',
         depositReceiver: reportItem.deposit_receiver || '',
         depositDestination: '',
         cashDepositStatus: reportItem.deposit_status || 'Pending',
         commissionRate: (reportItem.commission_amount !== null && reportItem.commission_amount !== undefined && reportItem.revenue_total) ? (reportItem.commission_amount / reportItem.revenue_total * 100) : (reportItem.technician_role === 'Freelance' ? 25 : 0),
         transportCost: reportItem.transport_cost || 0,
         otherCost: reportItem.other_cost || 0,
         otherCostDesc: reportItem.notes || reportItem.other_cost_desc || '',
         notes: reportItem.notes || reportItem.other_cost_desc || '',
         savingRate: (reportItem.saving_amount && reportItem.commission_amount) ? ((reportItem.saving_amount / reportItem.commission_amount) * 100) : 0,
         paymentStatus: reportItem.payment_status || 'Unpaid',
         picName: reportItem.pic_name
      }));
      setReports(mapped);
    } catch (err: any) {
      console.error("Error fetching reports:", err);
      toast.error(`Gagal memuat data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange, dateTypeFilter, users]);

  // --- Filter Logic ---

  const availableTechnicians = useMemo(() => {
    const techMap = new Map<string, string>();

    users
      .filter((user) => user.status === 'active' && isTechnicianRole(user.role))
      .forEach((user) => {
        techMap.set(user.id, user.name);
      });

    reports.forEach(r => {
        if (r.technicianId && r.technicianName) {
            techMap.set(r.technicianId, r.technicianName);
        }
    });
    return Array.from(techMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
  }, [reports, users]);

  const filteredReports = useMemo(() => {
      return reports.filter(r => {
          const matchSearch = r.technicianName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              r.role.toLowerCase().includes(searchQuery.toLowerCase());
          
          let matchStatus = true;
          if (statusFilter === 'Paid') matchStatus = isTechnicianPayoutPaid(r.paymentStatus);
          if (statusFilter === 'Unpaid') matchStatus = !isTechnicianPayoutPaid(r.paymentStatus); // Handle Unpaid/Pending

          let matchTechnician = true;
          if (technicianFilter !== 'all') {
              matchTechnician = r.technicianId === technicianFilter;
          }

          let matchRole = true;
          if (roleFilter !== 'all') {
             matchRole = r.role.toLowerCase() === roleFilter.toLowerCase();
          }

          return matchSearch && matchStatus && matchTechnician && matchRole;
      });
  }, [reports, searchQuery, statusFilter, technicianFilter, roleFilter]);

  // --- State: View Mode ---
  const [viewMode, setViewMode] = useState<'daily' | 'summary' | 'transactions'>('daily');
  const [transactionTab, setTransactionTab] = useState<OperationalTransactionTab>('all');

  const transactionTabOptions: Array<{
    value: OperationalTransactionTab;
    label: string;
  }> = [
    {
      value: 'all',
      label: 'Semua',
    },
    {
      value: 'finance',
      label: 'Rekap Finance',
    },
    {
      value: 'request',
      label: 'Req Transfer',
    },
  ];

  const selectedTechnicianFilterLabel = useMemo(() => {
      if (technicianFilter === 'all') return '';
      return availableTechnicians.find((technician) => technician.id === technicianFilter)?.name || '';
  }, [availableTechnicians, technicianFilter]);

  const reportDateFilterLabel = useMemo(() => {
      if (!dateRange?.from) return 'Semua Waktu';
      const fromLabel = format(dateRange.from, 'd MMM yyyy', { locale: id });
      const toLabel = dateRange.to ? format(dateRange.to, 'd MMM yyyy', { locale: id }) : fromLabel;
      return fromLabel === toLabel ? fromLabel : `${fromLabel} - ${toLabel}`;
  }, [dateRange]);

  const reportFilterSummary = useMemo(() => {
      const parts = [
          dateTypeFilter === 'service_date' ? 'Tgl Service' : 'Waktu Input',
          reportDateFilterLabel,
      ];
      if (selectedTechnicianFilterLabel) parts.push(selectedTechnicianFilterLabel);
      if (!selectedTechnicianFilterLabel && roleFilter !== 'all') parts.push(roleFilter);
      if (statusFilter !== 'all') parts.push(statusFilter === 'Paid' ? 'Sudah Dibayar' : 'Belum Dibayar');
      if (viewMode === 'transactions' && transactionTab !== 'all') {
          const tabLabel = transactionTabOptions.find((tab) => tab.value === transactionTab)?.label;
          if (tabLabel) parts.push(tabLabel);
      }
      if (searchQuery.trim()) parts.push(`"${searchQuery.trim()}"`);
      return parts.slice(0, 3).join(' / ');
  }, [
      dateTypeFilter,
      reportDateFilterLabel,
      roleFilter,
      searchQuery,
      selectedTechnicianFilterLabel,
      statusFilter,
      transactionTab,
      viewMode,
  ]);

  const activeReportFilterCount = useMemo(() => {
      let count = 0;
      if (dateTypeFilter !== 'service_date') count += 1;
      if (searchQuery.trim()) count += 1;
      if (statusFilter !== 'all') count += 1;
      if (technicianFilter !== 'all') count += 1;
      if (roleFilter !== 'all') count += 1;
      if (viewMode === 'transactions' && transactionTab !== 'all') count += 1;
      return count;
  }, [dateTypeFilter, roleFilter, searchQuery, statusFilter, technicianFilter, transactionTab, viewMode]);

  // --- Logic: Summary / Recap by Technician ---
  const technicianSummary = useMemo(() => {
    const summary = filteredReports.reduce((acc, curr) => {
        const id = curr.technicianId;
        if (!acc[id]) {
            acc[id] = {
                id: curr.technicianId,
                name: curr.technicianName,
                role: curr.role,
                totalOrders: 0,
                totalFinished: 0,
                totalVisit: 0,
                totalHomeService: 0,
                totalRevenue: 0,
                totalCommission: 0,
                totalSaving: 0,
                totalTransport: 0,
                totalOtherCost: 0,
                totalDeposit: 0,
                totalDebt: 0,       // Kurang Setor (Balance)
                totalOfficeDebt: 0, // Hutang kantor ke teknisi (gaji/komisi belum dibayar)
                count: 0
            };
        }
        
        const calcs = calculateFinancials(curr);
        
        acc[id].totalOrders += curr.totalOrders;
        acc[id].totalFinished += curr.totalFinished;
        acc[id].totalVisit += (curr.totalVisit || 0);
        acc[id].totalHomeService += (curr.totalHomeService || 0);
        acc[id].totalRevenue += calcs.totalRevenue;
        acc[id].totalCommission += calcs.commissionAmount;
        acc[id].totalSaving += calcs.savingAmount;
        acc[id].totalTransport += (curr.transportCost || 0);
        acc[id].totalOtherCost += (curr.otherCost || 0);
        acc[id].totalDeposit += curr.technicianDepositAmount;
        acc[id].totalDebt += calcs.balance;
        acc[id].totalOfficeDebt += calcs.officeDebt;
        acc[id].count += 1;
        
        return acc;
    }, {} as Record<string, any>);
    
    return Object.values(summary).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);
  }, [filteredReports]);

  // --- Summary Stats for Technician Recap ---
  const summaryStats = useMemo(() => {
    let totalReceivable = 0;  // Total Kurang Setor (Uang di Teknisi)
    let totalPayable = 0;     // Total Lebih Setor (Hutang ke Teknisi / over-deposit)
    let totalOfficeDebt = 0;  // Total Hutang Kantor ke Teknisi (gaji/komisi belum dibayar)

    technicianSummary.forEach((tech: any) => {
        if (tech.totalDebt > 0) {
            totalReceivable += tech.totalDebt;
        } else if (tech.totalDebt < 0) {
            totalPayable += Math.abs(tech.totalDebt);
        }
        totalOfficeDebt += (tech.totalOfficeDebt || 0);
    });

    return { totalReceivable, totalPayable, totalOfficeDebt };
  }, [technicianSummary]);

  // --- Helper: Format Rupiah ---
  const formatRupiah = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const transactionActionLogs = useMemo(() => {
    const knownActions = new Set<string>(Object.values(OPERATIONAL_TRANSACTION_AUDIT_ACTIONS));
    const combinedLogs = [...localTransactionLogs, ...(auditLogs || [])];
    const seen = new Set<string>();

    return combinedLogs
      .filter((log: any) => {
        const metadata = log?.metadata || {};
        return metadata.operationalTransactionBatch && knownActions.has(String(log?.action || ''));
      })
      .filter((log: any) => {
        const key = log?.metadata?.actionId || log?.id;
        if (!key || seen.has(key)) return false;
        if (cancelledOperationalTransactionActionIds.has(String(key))) return false;
        seen.add(key);
        return true;
      });
  }, [auditLogs, cancelledOperationalTransactionActionIds, localTransactionLogs]);

  const operationalTransactions = useMemo(() => {
    const reportById = new Map(reports.filter((report) => report.id).map((report) => [report.id, report]));

    const rawTransactions = transactionActionLogs
      .flatMap((log: any) => {
        const rows = Array.isArray(log?.metadata?.rows) ? log.metadata.rows as OperationalTransactionAuditRow[] : [];
        const requestedAt = log?.created_at || new Date().toISOString();
        const actionTemplateText = typeof log?.metadata?.templateText === 'string' ? log.metadata.templateText : '';

        return rows.map((row, index) => {
          const actionId = String(log?.metadata?.actionId || log?.id || '');
          const sourceSnapshots = row.reportSnapshots?.length ? row.reportSnapshots : [row.reportSnapshot];
          const sourceReportIds = row.reportIds?.length ? row.reportIds : row.reportId ? [row.reportId] : [];
          const rowReports = sourceSnapshots
            .map((snapshot) => snapshot?.id && reportById.has(snapshot.id) ? reportById.get(snapshot.id)! : snapshot)
            .filter(Boolean);
          sourceReportIds.forEach((reportId) => {
            const liveReport = reportById.get(reportId);
            if (liveReport && !rowReports.some((report) => report.id === liveReport.id)) {
              rowReports.push(liveReport);
            }
          });

          const sortedReports = rowReports.sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
          const report = sortedReports[0] || row.reportSnapshot;
          const reportIds = sortedReports.map((item) => item.id).filter(Boolean) as string[];
          const totalTarget = sortedReports.reduce((total, item) => total + calculateFinancials(item).targetSetor, 0);
          const totalDeposit = sortedReports.reduce((total, item) => total + (item.technicianDepositAmount || 0), 0);
          const totalBalance = sortedReports.reduce((total, item) => total + calculateFinancials(item).balance, 0);
          let status: OperationalTransactionRow['status'] = 'pending';
          let statusLabel = 'Menunggu';
          let description = row.description;

          if (row.type === 'deposit') {
            const hasIssue = sortedReports.some((item) => item.cashDepositStatus === 'Issue');
            const allVerified = sortedReports.every((item) => item.cashDepositStatus === 'Verified');
            const hasAnyDeposit = totalDeposit > 0;
            const currentGap = totalTarget - totalDeposit;

            if (hasIssue) {
              status = 'issue';
              statusLabel = 'Issue';
            } else if (allVerified) {
              status = 'done';
              statusLabel = 'Terverifikasi';
            } else if (hasAnyDeposit && Math.abs(currentGap) <= 500) {
              statusLabel = 'Perlu Validasi';
            } else if (hasAnyDeposit) {
              statusLabel = 'Cek Selisih';
            } else {
              statusLabel = 'Belum Masuk';
            }
            description = `Gabungan ${sortedReports.length} laporan | Target ${formatRupiah(totalTarget)} | Setor aktual ${formatRupiah(totalDeposit)} | Selisih ${formatRupiah(Math.max(currentGap, 0))}`;
          }

          if (row.type === 'billing') {
            const isSettled = totalBalance <= 500 || sortedReports.every((item) => item.cashDepositStatus === 'Verified');
            status = isSettled ? 'done' : 'pending';
            statusLabel = isSettled ? 'Setoran Sesuai' : 'Belum Sesuai';
            description = `Gabungan ${sortedReports.length} laporan | Tagihan ${formatRupiah(row.amount)} | Selisih saat ini ${formatRupiah(Math.max(totalBalance, 0))}`;
          }

          if (row.type === 'payout') {
            const isPaid = sortedReports.every((item) => isTechnicianPayoutPaid(item.paymentStatus));
            status = isPaid ? 'done' : 'pending';
              statusLabel = isPaid ? 'Sudah Dibayar' : 'Menunggu Validator';
            description = `Gabungan ${sortedReports.length} laporan | Req transfer ${formatRupiah(row.amount)} | Status finance: ${isPaid ? 'sudah transfer' : 'belum transfer'}`;
          }

          let fallbackTemplateText = '';
          if (row.type === 'deposit' && row.source === 'finance_recap') {
            fallbackTemplateText = buildDepositCheckTemplateText(sortedReports, formatRupiah);
          }
          if (row.type === 'billing') {
            fallbackTemplateText = buildTechnicianBillingTemplateText(sortedReports, formatRupiah);
          }

          return {
            id: `${log?.metadata?.actionId || log?.id}-${row.id}-${index}`,
            actionId,
            report,
            reports: sortedReports,
            reportIds,
            reportCount: sortedReports.length,
            date: report.date,
            dateLabel: getReportDateRangeLabel(sortedReports),
            technicianName: report.technicianName,
            role: report.role,
            type: row.type,
            source: row.source,
            sources: [row.source],
            sourceLabel: row.type === 'payout'
              ? OPERATIONAL_TRANSACTION_SOURCE_LABELS.transfer_request
              : row.sourceLabel || OPERATIONAL_TRANSACTION_SOURCE_LABELS[row.source],
            requestedAt,
            label: row.label,
            direction: row.direction,
            amount: row.amount,
            status,
            statusLabel,
            description,
            templateText: row.templateText || actionTemplateText || fallbackTemplateText,
          } satisfies OperationalTransactionRow;
        });
      });

    const groupedTransactions = Array.from(rawTransactions.reduce((acc, tx) => {
      const reportKey = tx.reportIds.length > 0
        ? [...tx.reportIds].sort().join(',')
        : `${tx.technicianName}-${tx.date}`;
      const key = [tx.type, tx.direction, reportKey].join('|');
      const existing = acc.get(key);

      if (!existing) {
        acc.set(key, tx);
        return acc;
      }

      const reportMap = new Map(existing.reports.map((report) => [report.id || `${report.date}-${report.technicianName}`, report]));
      tx.reports.forEach((report) => {
        reportMap.set(report.id || `${report.date}-${report.technicianName}`, report);
      });
      const mergedReports = Array.from(reportMap.values()).sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
      const mergedReportIds = mergedReports.map((report) => report.id).filter(Boolean) as string[];
      const totalTarget = mergedReports.reduce((total, report) => total + calculateFinancials(report).targetSetor, 0);
      const totalDeposit = mergedReports.reduce((total, report) => total + (report.technicianDepositAmount || 0), 0);
      const totalBalance = mergedReports.reduce((total, report) => total + calculateFinancials(report).balance, 0);
      const mergedSources = Array.from(new Set([...getOperationalTransactionSources(existing), ...getOperationalTransactionSources(tx)]));
      let status = existing.status;
      let statusLabel = existing.statusLabel;
      let description = existing.description;
      let amount = existing.amount;

      if (existing.type === 'deposit') {
        const hasIssue = mergedReports.some((report) => report.cashDepositStatus === 'Issue');
        const allVerified = mergedReports.every((report) => report.cashDepositStatus === 'Verified');
        const currentGap = totalTarget - totalDeposit;
        amount = mergedReports.reduce((total, report) => {
          const calcs = calculateFinancials(report);
          return total + Math.max(report.technicianDepositAmount || 0, calcs.targetSetor || calcs.cashOnHand || 0);
        }, 0);
        status = hasIssue ? 'issue' : allVerified ? 'done' : 'pending';
        statusLabel = hasIssue
          ? 'Issue'
          : allVerified
            ? 'Terverifikasi'
            : totalDeposit > 0 && Math.abs(currentGap) <= 500
              ? 'Perlu Validasi'
              : totalDeposit > 0
                ? 'Cek Selisih'
                : 'Belum Masuk';
        description = `Gabungan ${mergedReports.length} laporan | Target ${formatRupiah(totalTarget)} | Setor aktual ${formatRupiah(totalDeposit)} | Selisih ${formatRupiah(Math.max(currentGap, 0))}`;
      } else if (existing.type === 'billing') {
        const isSettled = totalBalance <= 500 || mergedReports.every((report) => report.cashDepositStatus === 'Verified');
        amount = mergedReports.reduce((total, report) => total + Math.max(calculateFinancials(report).balance, 0), 0);
        status = isSettled ? 'done' : 'pending';
        statusLabel = isSettled ? 'Setoran Sesuai' : 'Belum Sesuai';
        description = `Gabungan ${mergedReports.length} laporan | Tagihan ${formatRupiah(amount)} | Selisih saat ini ${formatRupiah(Math.max(totalBalance, 0))}`;
      } else if (existing.type === 'payout') {
        const isPaid = mergedReports.every((report) => isTechnicianPayoutPaid(report.paymentStatus));
        amount = mergedReports.reduce((total, report) => total + Math.max(calculateFinancials(report).officeDebt, 0), 0);
        status = isPaid ? 'done' : 'pending';
        statusLabel = isPaid ? 'Sudah Dibayar' : 'Menunggu Validator';
        description = `Gabungan ${mergedReports.length} laporan | Req transfer ${formatRupiah(amount)} | Status finance: ${isPaid ? 'sudah transfer' : 'belum transfer'}`;
      }

      acc.set(key, {
        ...existing,
        id: key,
        actionId: existing.actionId,
        report: mergedReports[0] || existing.report,
        reports: mergedReports,
        reportIds: mergedReportIds,
        reportCount: mergedReports.length,
        date: mergedReports[0]?.date || existing.date,
        dateLabel: getReportDateRangeLabel(mergedReports),
        amount,
        status,
        statusLabel,
        description,
        templateText: existing.templateText || tx.templateText,
        sources: mergedSources,
        sourceLabel: existing.type === 'payout'
          ? OPERATIONAL_TRANSACTION_SOURCE_LABELS.transfer_request
          : mergedSources
            .map((source) => OPERATIONAL_TRANSACTION_SOURCE_LABELS[source])
            .filter(Boolean)
            .join(' + '),
      });

      return acc;
    }, new Map<string, OperationalTransactionRow>()).values());

    return groupedTransactions
      .filter((tx) => {
        const q = searchQuery.trim().toLowerCase();
        const matchesSearch = !q
          || tx.technicianName.toLowerCase().includes(q)
          || tx.label.toLowerCase().includes(q)
          || getOperationalTransactionSourceLabel(tx).toLowerCase().includes(q);
        const matchesTechnician = technicianFilter === 'all' || tx.report.technicianId === technicianFilter;
        const matchesRole = roleFilter === 'all' || tx.role === roleFilter;
        const matchesStatus = statusFilter === 'all'
          || (statusFilter === 'Paid' ? tx.status === 'done' : tx.status !== 'done');
        const txDate = new Date(tx.date);
        const matchesDate = (!dateRange?.from || txDate >= startOfDay(dateRange.from))
          && (!dateRange?.to || txDate <= endOfDay(dateRange.to));

        return (
          matchesSearch &&
          matchesTechnician &&
          matchesRole &&
          matchesStatus &&
          matchesDate &&
          matchesOperationalTransactionTab(tx, transactionTab)
        );
      })
      .sort((a, b) => new Date(b.requestedAt || b.date).getTime() - new Date(a.requestedAt || a.date).getTime());
  }, [auditLogs, dateRange, localTransactionLogs, reports, roleFilter, searchQuery, statusFilter, technicianFilter, transactionActionLogs, transactionTab]);

  const transactionStats = useMemo(() => {
    return operationalTransactions.reduce((acc, tx) => {
        acc.total += tx.amount;
        if (tx.direction === 'Masuk') acc.incoming += tx.amount;
        if (tx.direction === 'Keluar') acc.outgoing += tx.amount;
        if (tx.status === 'pending') {
            acc.pending += tx.amount;
            acc.pendingCount += 1;
        }
        if (tx.status === 'done') acc.doneCount += 1;
        return acc;
    }, {
        total: 0,
        incoming: 0,
        outgoing: 0,
        pending: 0,
        pendingCount: 0,
        doneCount: 0,
    });
  }, [operationalTransactions]);

  const handleCopySummary = (tech: any) => {
     const text = `Rekap Performa Teknisi\nNama: ${tech.name}\nRole: ${tech.role}\n\nTotal Job: ${tech.totalFinished} / ${tech.totalOrders}\nTotal Omset: ${formatRupiah(tech.totalRevenue)}\nTotal Setor: ${formatRupiah(tech.totalDeposit)}\nKurang Setor: ${formatRupiah(tech.totalDebt)}\n\n(Data periode ini)`;
     handleCopy(text);
  };

  const handleExportExcel = () => {
    // Simple CSV export logic can be added here if needed
    toast.success("Fitur export akan segera hadir");
  };

  // --- Logic: Financial Calculation (Moved to top level) ---

  // --- Stats (Based on Filtered Data) ---
  const stats = useMemo(() => {
    return filteredReports.reduce((acc, curr) => {
        const fin = calculateFinancials(curr);
        
        acc.revenue += fin.totalRevenue;
        acc.finished += curr.totalFinished;
        acc.visit += curr.totalVisit;
        acc.homeService += curr.totalHomeService;
        
        acc.transfer += curr.revenueTransfer;
        acc.cash += curr.revenueCash;
        
        acc.commission += fin.commissionAmount;
        acc.saving += fin.savingAmount;
        acc.transport += curr.transportCost;
        acc.other += curr.otherCost;
        
        return acc;
    }, {
        revenue: 0,
        finished: 0,
        visit: 0,
        homeService: 0,
        transfer: 0,
        cash: 0,
        commission: 0,
        saving: 0,
        transport: 0,
        other: 0
    });
  }, [filteredReports]);

  // --- Handlers ---

  const handleOpenNewForm = () => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const newData: DailyReport = {
      date: todayStr,
      technicianId: '',
      technicianName: '',
      role: 'Karyawan',
      totalOrders: 0,
      totalFinished: 0,
      totalVisit: 0,
      totalHomeService: 0,
      revenueCash: 0,
      revenueTransfer: 0,
      cashDepositStatus: 'Pending',
      paymentStatus: 'Unpaid',
      commissionRate: 25,
      transportCost: 0,
      otherCost: 0,
      otherCostDesc: '',
      savingRate: 0,
      technicianDepositAmount: 0,
      depositType: 'Transfer',
      depositReceiver: '',
      depositDestination: '',
    };
    setFormData(newData);
    setInitialFormData(newData);
    setIsFormOpen(true);
  };

  const handleEditReport = (report: DailyReport) => {
    setFormData({ ...report });
    setInitialFormData({ ...report });
    setIsFormOpen(true);
  };

  const handleSheetOpenChange = (open: boolean) => {
    if (!open && formData && initialFormData) {
        // Simple dirty check
        const isDirty = JSON.stringify(formData) !== JSON.stringify(initialFormData);
        if (isDirty) {
            setShowUnsavedAlert(true);
            return;
        }
    }
    setIsFormOpen(open);
  };

  const handleTechnicianChange = (techId: string) => {
    const tech = users.find(u => u.id === techId);
    if (tech && formData) {
      const isFreelance = (tech.employmentStatus || '').toLowerCase() === 'freelance';
      setFormData({
        ...formData,
        technicianId: tech.id,
        technicianName: tech.name,
        role: isFreelance ? 'Freelance' : 'Karyawan',
        commissionRate: isFreelance ? 25 : 0,
      });
    }
  };

  // --- Fetch Orders (Robust) ---
  useEffect(() => {
    if (isFormOpen && !formData?.id && formData?.technicianId && formData?.date) {
        handleFetchOrders();
    }
    
    if (isFormOpen && formData?.date) {
        const dateStr = formData.date;
        const relevantOrders = orders.filter((o: any) => {
             const sDate = o.serviceDate || o.service_date;
             const status = (o.status || '').toLowerCase();
             return sDate === dateStr && ['done', 'selesai', 'waiting qc', 'teknisi_completed'].includes(status);
        });
        const techIds = Array.from(new Set(relevantOrders.map((o: any) => o.technicianId || o.technician_id).filter(Boolean)));
        const techs = users.filter(u => techIds.includes(u.id));
        techs.sort((a,b) => a.name.localeCompare(b.name));
        
        if (formData.technicianId && !techs.find(t => t.id === formData.technicianId)) {
            const t = users.find(u => u.id === formData.technicianId);
            if(t) techs.push(t);
        }
        setActiveTechnicians(techs);
    }
  }, [formData?.technicianId, formData?.date, isFormOpen]);

  const handleFetchOrders = async () => {
    if (!formData?.technicianId || !formData?.date) return;
    setIsFetchingOrder(true);
    
    try {
        const { data: dbOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('technician_id', formData.technicianId)
            .eq('service_date', formData.date);
            
        if (error) throw error;
        
        const finished = (dbOrders || []).filter((o: any) => ['done', 'selesai', 'waiting qc', 'teknisi_completed'].includes((o.status || '').toLowerCase()));
        
        const isCash = (o: any) => {
              const pmId = o.paymentMethodId || o.payment_method_id;
              const pm = payments.find(p => p.id === pmId);
              if (pm && pm.bankName?.toLowerCase() === 'cash') return true;
              return (o.paymentType || o.payment_type)?.toLowerCase() === 'cash';
        };

        const revCash = finished.filter(isCash).reduce((sum: number, o: any) => sum + (o.price || o.totalPrice || 0), 0);
        const revTrf = finished.filter(o => !isCash(o)).reduce((sum: number, o: any) => sum + (o.price || o.totalPrice || 0), 0);

        const visits = finished.filter((o: any) => (o.serviceCategory || o.service_category || '').toLowerCase() === 'visit').length;
        const homes = finished.filter((o: any) => (o.serviceCategory || o.service_category || '').toLowerCase() === 'home service').length;

        setFormData(prev => {
            if (!prev) return null;
            
            // Logic reset deposit jika cash 0 (agar tidak ada 'phantom deposit' saat form di-hide)
            const newDepositAmount = revCash === 0 ? 0 : prev.technicianDepositAmount;
            
            return {
                ...prev,
                totalOrders: (dbOrders || []).length,
                totalFinished: finished.length,
                totalVisit: visits,
                totalHomeService: homes,
                revenueCash: revCash,
                revenueTransfer: revTrf,
                technicianDepositAmount: newDepositAmount // Reset deposit if no cash
            };
        });

    } catch (err) {
        console.error(err);
    } finally {
        setIsFetchingOrder(false);
    }
  };

  const handleSave = async () => {
     if (!formData || !formData.technicianId) return toast.error("Pilih teknisi!");
     setIsSaving(true);
     
     const calcs = calculateFinancials(formData);
     
     const payload = {
        service_date: formData.date,
        technician_id: formData.technicianId,
        technician_name: formData.technicianName,
        technician_role: formData.role,
        total_orders: formData.totalOrders,
        total_finished: formData.totalFinished,
        total_visit: formData.totalVisit,
        total_home_service: formData.totalHomeService,
        revenue_cash: formData.revenueCash,
        revenue_transfer: formData.revenueTransfer,
        revenue_total: calcs.totalRevenue,
        deposit_amount: formData.technicianDepositAmount,
        deposit_method: formData.depositType,
        deposit_receiver: formData.depositReceiver,
        deposit_status: formData.cashDepositStatus,
        commission_amount: calcs.commissionAmount,
        saving_amount: calcs.savingAmount,
        transport_cost: formData.transportCost,
        other_cost: formData.otherCost,
        notes: formData.otherCostDesc,
        payment_status: formData.paymentStatus,
        pic_name: currentUser?.name || 'Admin'
     };

     try {
        let error;
        if (formData.id) {
            // Remove properties that might not be in the schema or are read-only
            const { error: e } = await supabase.from('technician_daily_reports').update(payload).eq('id', formData.id);
            error = e;
        } else {
            const { error: e } = await supabase.from('technician_daily_reports').insert(payload);
            error = e;
        }
        
        if (error) throw error;
        toast.success("Laporan tersimpan");
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            formData.id ? 'UPDATE' : 'CREATE',
            'Laporan Harian',
            `${formData.id ? 'Memperbarui' : 'Membuat'} laporan harian teknisi`,
            formData.id || ''
          );
        }
        // Clear initialFormData to avoid "unsaved changes" alert
        setInitialFormData(null);
        setIsFormOpen(false);
        fetchData();
     } catch (err: any) {
        toast.error("Gagal menyimpan: " + err.message);
     } finally {
        setIsSaving(false);
     }
  };

  const requestDeleteReport = (targetReport: DailyReport | null) => {
    if (!targetReport?.id) return;
    setPendingDeleteReport(targetReport);
  };

  const handleDelete = async (targetReport: DailyReport | null = formData) => {
    if (!targetReport?.id) return;
    
    setIsSaving(true);
    try {
        const { error } = await supabase.from('technician_daily_reports').delete().eq('id', targetReport.id);
        if (error) throw error;
        
        toast.success("Laporan berhasil dihapus");
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'DELETE', 'Laporan Harian',
            `Menghapus laporan harian teknisi`,
            targetReport.id
          );
        }
        setInitialFormData(null);
        setIsFormOpen(false);
        fetchData();
    } catch (err: any) {
        toast.error("Gagal menghapus: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  const mainReportTabs = [
    { value: 'daily', label: 'List Harian', icon: LayoutList },
    { value: 'summary', label: 'Rekap Teknisi', icon: Users },
    { value: 'transactions', label: 'Transaksi', icon: ArrowRightLeft },
  ] as const;

  const renderMainReportTabs = () => (
    <div className="operationalReportTabs" role="tablist" aria-label="Navigasi laporan operasional">
      {mainReportTabs.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={viewMode === value}
          onClick={() => setViewMode(value)}
          className={cn('operationalReportTab', viewMode === value && 'isActive')}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );

  const renderDailyTopFilters = () => (
    <FilterRow className="operationalReportControlFilters isDaily">
      <div className="operationalReportFilterControl operationalReportFilterDateType">
        <Select value={dateTypeFilter} onValueChange={(v: any) => setDateTypeFilter(v)}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <SelectValue placeholder="Tipe tanggal" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="service_date">Tgl Service</SelectItem>
            <SelectItem value="created_at">Waktu Input</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="operationalReportFilterControl operationalReportDateRange">
        <FoundationDateRangePicker
          date={dateRange}
          setDate={setDateRange}
          className="operationalReportDatePicker"
          contentClassName="operationalReportDateRangePopover"
        />
      </div>

      <div className="operationalReportFilterControl operationalReportFilterSearch relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Cari teknisi atau role..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-12 rounded-xl border-slate-200 bg-white pl-11 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      <div className="operationalReportFilterControl operationalReportFilterTechnician">
        <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 dark:border-slate-700 dark:bg-slate-900">
            <SelectValue placeholder="Semua Teknisi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Teknisi</SelectItem>
            {availableTechnicians.map((technician) => (
              <SelectItem key={technician.id} value={technician.id}>
                {technician.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="operationalReportFilterControl operationalReportFilterRole">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 dark:border-slate-700 dark:bg-slate-900">
            <SelectValue placeholder="Semua Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Role</SelectItem>
            <SelectItem value="Karyawan">Karyawan</SelectItem>
            <SelectItem value="Freelance">Freelance</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="operationalReportFilterControl operationalReportFilterStatus">
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 dark:border-slate-700 dark:bg-slate-900">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="Paid">Sudah Dibayar</SelectItem>
            <SelectItem value="Unpaid">Belum Dibayar</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </FilterRow>
  );

  const renderSummaryTopFilters = () => (
    <FilterRow className="operationalReportControlFilters isSummary">
      <div className="operationalReportFilterControl operationalReportFilterDateType">
        <Select value={dateTypeFilter} onValueChange={(v: any) => setDateTypeFilter(v)}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <SelectValue placeholder="Tipe tanggal" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="service_date">Tgl Service</SelectItem>
            <SelectItem value="created_at">Waktu Input</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="operationalReportFilterControl operationalReportDateRange">
        <FoundationDateRangePicker
          date={dateRange}
          setDate={setDateRange}
          className="operationalReportDatePicker"
          contentClassName="operationalReportDateRangePopover"
        />
      </div>
      <div className="operationalReportFilterControl operationalReportFilterSearch relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Cari teknisi..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-12 rounded-xl border-slate-200 bg-white pl-11 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
        />
      </div>
      <div className="operationalReportFilterControl operationalReportFilterTechnician">
        <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <SelectValue placeholder="Semua Teknisi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Teknisi</SelectItem>
            {availableTechnicians.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="operationalReportFilterControl operationalReportFilterRole">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <SelectValue placeholder="Semua Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Role</SelectItem>
            <SelectItem value="Karyawan">Karyawan</SelectItem>
            <SelectItem value="Freelance">Freelance</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="operationalReportFilterControl operationalReportFilterStatus">
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="Paid">Sudah Dibayar</SelectItem>
            <SelectItem value="Unpaid">Belum Dibayar</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </FilterRow>
  );

  const renderTransactionTopFilters = () => (
    <FilterRow className="operationalReportControlFilters isTransactions">
      <div className="operationalReportFilterControl operationalReportTransactionTabs">
        <div className="operationalReportInlineTabs" role="tablist" aria-label="Filter transaksi operasional">
          {transactionTabOptions.map((tab) => {
            const isActive = transactionTab === tab.value;

            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTransactionTab(tab.value)}
                className={cn('operationalReportInlineTab', isActive && 'isActive')}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="operationalReportFilterControl operationalReportDateRange">
        <FoundationDateRangePicker
          date={dateRange}
          setDate={setDateRange}
          className="operationalReportDatePicker"
          contentClassName="operationalReportDateRangePopover"
        />
      </div>
      <div className="operationalReportFilterControl operationalReportFilterSearch relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Cari teknisi atau transaksi..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-12 rounded-xl border-slate-200 bg-white pl-11 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
        />
      </div>
      <div className="operationalReportFilterControl operationalReportFilterTechnician">
        <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <SelectValue placeholder="Semua Teknisi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Teknisi</SelectItem>
            {availableTechnicians.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="operationalReportFilterControl operationalReportFilterRole">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <SelectValue placeholder="Semua Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Role</SelectItem>
            <SelectItem value="Karyawan">Karyawan</SelectItem>
            <SelectItem value="Freelance">Freelance</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="operationalReportFilterControl operationalReportFilterStatus">
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="h-12 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="Paid">Sudah Dibayar</SelectItem>
            <SelectItem value="Unpaid">Belum Dibayar</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </FilterRow>
  );

  const renderTopFilters = () => {
    if (viewMode === 'summary') return renderSummaryTopFilters();
    if (viewMode === 'transactions') return renderTransactionTopFilters();
    return renderDailyTopFilters();
  };

  return (
    <OperationalPageShell className="operationalReportPage">
      <OperationalPageHeader
        eyebrow="Operasional"
        icon={Briefcase}
        title="Laporan Operasional"
        subtitle="Rekap harian setoran, komisi, dan performa teknisi."
        actions={(
          hasPermission('daily_report.create') ? (
            <Button onClick={handleOpenNewForm}>
              <PlusCircle className="h-4 w-4" />
              Buat Laporan
            </Button>
          ) : null
        )}
      />

      <div className="operationalReportControlStack">
        {renderMainReportTabs()}
        <OperationalFilterPanel
          className="operationalReportFilterCard"
          collapsible
          isExpanded={isMobileFiltersOpen}
          onExpandedChange={setIsMobileFiltersOpen}
          summary={activeReportFilterCount > 0 ? `${activeReportFilterCount} filter aktif` : reportFilterSummary}
          contentClassName="operationalReportFilterContent"
        >
          {renderTopFilters()}
        </OperationalFilterPanel>
      </div>

      {/* KPI Cards */}
      <OperationalKpiGrid className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <OperationalKpiCard label="Revenue" value={formatRupiah(stats.revenue)} icon={TrendingUp} tone="emerald" />
        <OperationalKpiCard label="Selesai" value={`${stats.finished} Order`} icon={CheckCircle2} tone="blue" />
        <OperationalKpiCard
          label="Transfer"
          value={formatRupiah(stats.transfer)}
          icon={ArrowRightLeft}
          tone="violet"
        />
        <OperationalKpiCard label="Cash" value={formatRupiah(stats.cash)} icon={Wallet} tone="amber" />
        <OperationalKpiCard
          label="Visit"
          value={`${stats.visit} (${stats.finished > 0 ? ((stats.visit / stats.finished) * 100).toFixed(0) : 0}%)`}
          icon={Briefcase}
          tone="violet"
        />
        <OperationalKpiCard
          label="Home Service"
          value={`${stats.homeService} (${stats.finished > 0 ? ((stats.homeService / stats.finished) * 100).toFixed(0) : 0}%)`}
          icon={User}
          tone="blue"
        />
        <OperationalKpiCard label="Komisi" value={formatRupiah(stats.commission)} icon={DollarSign} tone="emerald" />
        <OperationalKpiCard label="Save Komisi" value={formatRupiah(stats.saving)} icon={Wallet} tone="default" />
        <OperationalKpiCard label="Transport" value={formatRupiah(stats.transport)} icon={ArrowRightLeft} tone="amber" />
        <OperationalKpiCard label="Biaya Lain" value={formatRupiah(stats.other)} icon={AlertTriangle} tone="rose" />
      </OperationalKpiGrid>

      {/* Main Content Area */}
      {viewMode === 'daily' ? (
      /* --- VIEW: DAILY LIST (Existing) --- */
      <OperationalTableCard className="operationalReportTableCard">
        <div className="operationalReportTableHeader">
          <div>
            <MasterDataTableTitle
              title="Riwayat Laporan"
              count={filteredReports.length}
              icon={LayoutList}
              variant="active"
            />
            <p className="operationalReportTableSubtitle">
              {dateRange?.from
                ? `Periode ${format(dateRange.from, 'dd MMM yyyy', { locale: id })}${dateRange.to ? ` sampai ${format(dateRange.to, 'dd MMM yyyy', { locale: id })}` : ''}`
                : 'Semua laporan operasional yang tersedia'}
            </p>
          </div>
        </div>

        {/* Mobile View: Cards */}
        <div className="md:hidden operationalReportMobileList">
             {filteredReports.length === 0 ? (
                <OperationalEmptyState
                    icon={Briefcase}
                    title="Belum ada laporan"
                    description="Sesuaikan filter tanggal untuk melihat data."
                    className="py-12"
                />
             ) : (
                filteredReports.map((r) => {
                    const calcs = calculateFinancials(r);
                    return (
                        <div key={r.id} className="operationalReportMobileCard bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-4 transition-all">
                            {/* Header */}
                            <div className="operationalReportMobileCardHeader flex justify-between items-start">
                                <div className="flex items-start gap-3">
                                    <Checkbox
                                        className="mt-0.5"
                                        checked={selectedReportIds.includes(r.id!)}
                                        onCheckedChange={() => handleToggleSelect(r.id!)}
                                        aria-label={`Pilih laporan ${r.technicianName}`}
                                    />
                                    <div>
                                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                                            {format(new Date(r.date), 'dd MMM yyyy', { locale: id })}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 uppercase tracking-wide font-medium">
                                            {format(new Date(r.date), 'EEEE', { locale: id })}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1.5">
                                    {/* Badge Status Setoran (Balance) */}
                                    <div className="flex items-center gap-1">
                                        <Badge variant="outline" className={cn(
                                            "text-[9px] px-1.5 h-5",
                                            calcs.balance === 0 ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
                                            calcs.balance > 0 ? "bg-red-50 text-red-600 border-red-200" :
                                            "bg-blue-50 text-blue-600 border-blue-200"
                                        )}>
                                            {calcs.balance === 0 ? "LUNAS" : calcs.balance > 0 ? "KURANG" : "LEBIH"}
                                        </Badge>
                                    </div>

                                    {/* Badge Status Bayar (Office Debt) */}
                                    {calcs.officeDebt > 0 && (
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] text-slate-400 font-medium">Hutang:</span>
                                            <Badge variant="outline" className="bg-purple-50 text-purple-600 border-purple-200 text-[9px] px-1.5 h-5">
                                                {formatRupiah(calcs.officeDebt)}
                                            </Badge>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Technician Info */}
                            <div className="operationalReportMobileTechnician flex items-center gap-3 pb-3 border-b border-slate-50 dark:border-slate-800">
                                <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg shrink-0">
                                    {r.technicianName.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight">{r.technicianName}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                                        <Briefcase className="w-3 h-3" />
                                        {r.role}
                                    </div>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="operationalReportMobileStats grid grid-cols-2 gap-4 text-sm">
                                <div className="space-y-1">
                                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Order</span>
                                    <div className="font-bold text-slate-900 dark:text-slate-100 flex items-baseline gap-1">
                                        {r.totalOrders}
                                        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                            {r.totalFinished} Selesai
                                        </span>
                                    </div>
                                </div>
                                <div className="space-y-1 text-right">
                                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Revenue</span>
                                    <div className="font-bold text-emerald-700">{formatRupiah(calcs.totalRevenue)}</div>
                                </div>
                            </div>
                            
                            {/* Settlement Info Box */}
                            <div className="operationalReportMobileSettlement bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 space-y-2 border border-slate-100 dark:border-slate-700">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 dark:text-slate-400">Kewajiban (Cash)</span>
                                    <span className="font-bold text-slate-700 dark:text-slate-300">{formatRupiah(calcs.cashOnHand)}</span>
                                </div>
                                
                                {r.role === 'Freelance' && calcs.netHakTeknisi > 0 && (
                                    <div className="flex justify-between items-center text-xs text-red-600/70">
                                        <span>(-) Potong Hak</span>
                                        <span>{formatRupiah(calcs.netHakTeknisi)}</span>
                                    </div>
                                )}

                                <div className="flex justify-between items-center text-xs text-blue-600">
                                    <span>(-) Sudah Setor</span>
                                    <span className="font-bold">{formatRupiah(r.technicianDepositAmount)}</span>
                                </div>

                                <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-200 dark:border-slate-700 border-dashed">
                                    <span className="font-medium text-slate-600 dark:text-slate-400">Sisa Kewajiban</span>
                                    <span className={cn(
                                        "font-bold px-2 py-0.5 rounded text-[10px]",
                                        calcs.balance > 0 ? "bg-red-100 text-red-700" : 
                                        calcs.balance < 0 ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                                    )}>
                                        {calcs.balance === 0 ? "LUNAS" : formatRupiah(calcs.balance)}
                                    </span>
                                </div>
                            </div>

                            {/* Action Buttons Footer */}
                            <div className="operationalReportMobileActions flex items-center gap-2 pt-2">
                                <Button variant="outline" size="sm" onClick={() => handleViewDetail(r)} className="flex-1 h-9 text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-slate-200 dark:border-slate-700 text-xs">
                                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                                    Detail
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleEditReport(r)} className="flex-1 h-9 text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-slate-200 dark:border-slate-700 text-xs">
                                    <Edit className="w-3.5 h-3.5 mr-1.5" />
                                    Edit
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => requestDeleteReport(r)} className="h-9 w-9 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 border-slate-200 dark:border-slate-700 shrink-0">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    );
                })
             )}
        </div>
        
        <DataTable
          className="hidden md:block operationalReportDataTable"
          columns={createDataTableColumns([
            'checkbox',
            'number',
            'date',
            'name',
            'quantity',
            'money',
            'money',
            'money',
            'status',
            'status',
            'action',
          ])}
          rowMinHeight={88}
          cellX={16}
          cellY={14}
          primaryLines={2}
          secondaryLines={2}
        >
          <table>
            <thead>
              <tr>
                <th className="text-center">
                  <Checkbox
                    className="mx-auto"
                    checked={filteredReports.length > 0 && selectedReportIds.length === filteredReports.length}
                    onCheckedChange={handleToggleSelectAll}
                    aria-label="Pilih semua laporan"
                  />
                </th>
                <th className="text-center">No</th>
                <th>
                  <span className="inline-flex items-center gap-2">
                    Tgl Service
                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </span>
                </th>
                <th>Teknisi / Role</th>
                <th>
                  <span className="inline-flex items-center gap-2">
                    Statistik
                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </span>
                </th>
                <th className="text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    Pendapatan
                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </span>
                </th>
                <th className="text-right">Hak & Biaya</th>
                <th className="text-right">Settlement</th>
                <th className="text-center">Setoran</th>
                <th className="text-center">Pembayaran</th>
                <TableActionHeader />
              </tr>
            </thead>
            <tbody>
              {filteredReports.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-20 text-center text-slate-400">
                    <OperationalEmptyState
                      icon={Briefcase}
                      title="Belum ada laporan"
                      description={dateRange?.from ? 'Tidak ada data pada rentang tanggal ini.' : 'Belum ada data laporan.'}
                      className="py-10"
                    />
                  </td>
                </tr>
              ) : (
                filteredReports.map((r, rowIndex) => {
                  const calcs = calculateFinancials(r);
                  const hasNote = r.notes || r.otherCostDesc;
                  const payoutPaid = isTechnicianPayoutPaid(r.paymentStatus);
                  const isPaidViaTransfer = payoutPaid && r.technicianDepositAmount >= (calcs.cashOnHand - 1000);
                  const settlementSecondary = [
                    calcs.cashOnHand > 0 ? `Cash ${formatRupiah(calcs.cashOnHand)}` : null,
                    r.technicianDepositAmount > 0 ? `Setor ${formatRupiah(r.technicianDepositAmount)}` : null,
                    r.role === 'Freelance' && calcs.balance === 0 && calcs.netHakTeknisi > 0 ? `Potong hak ${formatRupiah(calcs.netHakTeknisi)}` : null,
                  ].filter(Boolean).join(' . ');
                  const costSecondary = [
                    calcs.savingAmount > 0 ? `Save ${formatRupiah(calcs.savingAmount)}` : null,
                    r.transportCost > 0 ? `Transport ${formatRupiah(r.transportCost)}` : null,
                    r.otherCost > 0 ? `Lainnya ${formatRupiah(r.otherCost)}` : null,
                    hasNote ? String(r.notes || r.otherCostDesc) : null,
                  ].filter(Boolean).join(' . ');

                  return (
                    <tr
                      key={r.id}
                      onClick={() => handleViewDetail(r)}
                      className="operationalReportClickableRow"
                    >
                      <td className="text-center" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          className="mx-auto"
                          checked={selectedReportIds.includes(r.id!)}
                          onCheckedChange={() => handleToggleSelect(r.id!)}
                          aria-label={`Pilih laporan ${r.technicianName}`}
                        />
                      </td>
                      <td className="text-center text-sm font-semibold text-slate-500">{rowIndex + 1}</td>
                      <td>
                        <TableText
                          primary={format(new Date(r.date), 'dd MMM yyyy', { locale: id })}
                          secondary={`${format(new Date(r.date), 'EEEE', { locale: id })}${r.createdAt ? ` . Input ${format(new Date(r.createdAt), 'dd/MM HH:mm')}` : ''}`}
                        />
                      </td>
                      <td>
                        <TableText primary={r.technicianName} secondary={r.role} />
                      </td>
                      <td>
                        <TableText
                          primary={`${r.totalFinished}/${r.totalOrders} order`}
                          secondary={`Visit ${r.totalVisit} . HS ${r.totalHomeService}`}
                        />
                      </td>
                      <td className="text-right">
                        <TableText
                          className="items-end"
                          primary={formatRupiah(calcs.totalRevenue)}
                          secondary={`Cash ${new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(r.revenueCash)} . Transfer ${new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(r.revenueTransfer)}`}
                        />
                      </td>
                      <td className="text-right">
                        <TableText
                          className="items-end"
                          primary={formatRupiah(calcs.commissionAmount)}
                          primaryClassName="text-emerald-700"
                          secondary={costSecondary || '-'}
                        />
                      </td>
                      <td className="text-right">
                        <TableText
                          className="items-end"
                          primary={formatRupiah(calcs.targetSetor)}
                          secondary={settlementSecondary || '-'}
                        />
                      </td>
                      <td className="text-center">
                        {(() => {
                          const bal = calcs.balance;
                          if (calcs.cashOnHand === 0 && bal === 0) {
                            return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-400">CLEAR</Badge>;
                          }
                          if (bal === 0) {
                            return (
                              <div className="flex flex-col items-center gap-1">
                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-600">LUNAS</Badge>
                                {r.role === 'Freelance' && calcs.netHakTeknisi > 0 ? <span className="text-[10px] font-medium text-slate-400">Potong gaji</span> : null}
                              </div>
                            );
                          }
                          if (bal > 0) {
                            return (
                              <div className="flex flex-col items-center gap-1">
                                <Badge variant="outline" className="border-red-200 bg-red-50 text-[10px] text-red-600">KURANG</Badge>
                                <span className="text-[10px] font-bold text-red-600">{formatRupiah(bal)}</span>
                              </div>
                            );
                          }
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] text-blue-600">LEBIH</Badge>
                              <span className="text-[10px] font-bold text-blue-600">{formatRupiah(Math.abs(bal))}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="text-center">
                        {calcs.balance < 0 ? (
                          payoutPaid ? (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-600">SUDAH TRF</Badge>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className="border-purple-200 bg-purple-50 text-[10px] text-purple-600">HUTANG KANTOR</Badge>
                              <span className="text-[10px] font-medium text-purple-600">{formatRupiah(Math.abs(calcs.balance))}</span>
                            </div>
                          )
                        ) : calcs.officeDebt > 0 ? (
                          payoutPaid ? (
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-600">SUDAH TRF</Badge>
                              <span className="text-[10px] font-medium text-emerald-600">{formatRupiah(calcs.officeDebt)}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className="border-purple-200 bg-purple-50 text-[10px] text-purple-600">BELUM BAYAR</Badge>
                              <span className="text-[10px] font-medium text-purple-600">{formatRupiah(calcs.officeDebt)}</span>
                            </div>
                          )
                        ) : calcs.balance === 0 && calcs.netHakTeknisi > 0 && calcs.cashOnHand > r.technicianDepositAmount ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-600">AMBIL CASH</Badge>
                            <span className="text-[10px] font-medium text-emerald-600">{formatRupiah(calcs.netHakTeknisi)}</span>
                          </div>
                        ) : isPaidViaTransfer && calcs.netHakTeknisi > 0 ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-600">SUDAH TRF</Badge>
                            <span className="text-[10px] font-medium text-emerald-600">{formatRupiah(calcs.netHakTeknisi)}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-300">-</Badge>
                        )}
                      </td>
                      <TableActionCell onClick={(event) => event.stopPropagation()}>
                        <TableActionMenu>
                          <TableActionMenuItem icon={Eye} onClick={() => handleViewDetail(r)}>
                            Detail
                          </TableActionMenuItem>
                          {hasPermission('daily_report.edit') && (
                            <TableActionMenuItem icon={Edit} onClick={() => handleEditReport(r)}>
                              Edit
                            </TableActionMenuItem>
                          )}
                          {hasPermission('daily_report.delete') && (
                            <TableActionMenuItem danger icon={Trash2} onClick={() => requestDeleteReport(r)}>
                              Hapus
                            </TableActionMenuItem>
                          )}
                        </TableActionMenu>
                      </TableActionCell>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </DataTable>

        {/* Floating Bulk Action Bar */}
        {typeof document !== 'undefined' && selectedReportIds.length > 0 && createPortal(
            <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 animate-in slide-in-from-bottom-5 fade-in duration-300 md:bottom-6">
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-700/60 bg-slate-950/95 p-3 text-white shadow-2xl shadow-slate-950/30 ring-1 ring-white/10 backdrop-blur md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex items-center gap-3">
                            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-blue-500 px-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20">
                                {selectedReportIds.length}
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-100">{selectedReportIds.length} laporan dipilih</div>
                                <div className="text-xs text-slate-400">Total tagihan</div>
                            </div>
                        </div>
                        
                        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-sm">
                           <span className="font-mono font-bold tracking-tight text-emerald-300">{formatRupiah(selectedReportIds.reduce((sum, id) => {
                               const report = reports.find(x => x.id === id);
                               if(!report) return sum;
                               const c = calculateFinancials(report);
                               const tagihan = c.targetSetor - (report.technicianDepositAmount || 0);
                               return sum + (tagihan > 0 ? tagihan : 0);
                           }, 0))}</span>
                        </div>
                    </div>
                    
                    <div className="grid w-full grid-cols-[1fr_1fr_auto] gap-2 md:w-auto md:min-w-[420px]">
                        <Button size="sm" onClick={() => requestBulkAction('finance')} title="Buat rekap untuk validator finance" className="h-10 justify-center rounded-xl border-0 bg-indigo-500 px-5 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02] hover:bg-indigo-400 active:scale-95">
                            <Wallet className="w-3.5 h-3.5" />
                            Rekap Finance
                        </Button>
                        <Button size="sm" onClick={() => requestBulkAction('transfer')} title="Buat permintaan transfer ke teknisi" className="h-10 justify-center rounded-xl border-0 bg-violet-600 px-5 text-xs font-bold text-white shadow-lg shadow-violet-500/20 transition-all hover:scale-[1.02] hover:bg-violet-500 active:scale-95">
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            Req Transfer
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedReportIds([])} className="h-10 w-full rounded-xl p-0 text-slate-400 transition-colors hover:bg-red-950/30 hover:text-red-300 sm:w-10 [&>div]:hidden">
                            <span className="sr-only">Batal</span>
                            <X className="h-4 w-4" />
                            <div className="text-lg">✕</div>
                        </Button>
                    </div>
                </div>
            </div>,
            document.body
        )}

      </OperationalTableCard>
      ) : viewMode === 'summary' ? (
      <div className="space-y-6">
        {/* Summary Cards for Technician Recap */}
        <OperationalKpiGrid className="lg:grid-cols-3">
            <OperationalKpiCard
                label="Total Cash Belum Disetor"
                value={formatRupiah(summaryStats.totalReceivable)}
                icon={ArrowDownCircle}
                tone="rose"
            />
            <OperationalKpiCard
                label="Total Deposit / Lebih"
                value={formatRupiah(summaryStats.totalPayable)}
                icon={ArrowUpCircle}
                tone="blue"
            />
            <OperationalKpiCard
                label="Hutang ke Teknisi"
                value={formatRupiah(summaryStats.totalOfficeDebt)}
                icon={Briefcase}
                tone={summaryStats.totalOfficeDebt > 0 ? 'amber' : 'default'}
            />
        </OperationalKpiGrid>

      <OperationalTableCard className="operationalReportTableCard">
        <div className="operationalReportTableHeader">
          <div>
            <MasterDataTableTitle title="Rekap Performa Teknisi" count={technicianSummary.length} icon={Users} variant="active" />
            <p className="operationalReportTableSubtitle">
              Ringkasan performa dan keuangan per teknisi
              {dateRange?.from ? ` periode ${format(dateRange.from, 'dd MMM yyyy', { locale: id })}${dateRange.to ? ` sampai ${format(dateRange.to, 'dd MMM yyyy', { locale: id })}` : ''}` : ''}
            </p>
          </div>
        </div>

        <DataTable
          className="operationalReportDataTable"
          columns={createDataTableColumns([
            'number',
            'name',
            'quantity',
            'money',
            'money',
            'money',
            'money',
            'money',
            'money',
            'money',
            'action',
          ])}
          rowMinHeight={88}
          cellX={16}
          cellY={14}
          primaryLines={2}
          secondaryLines={2}
        >
        <table>
          <thead>
            <tr>
              <th className="text-center">No</th>
              <th>Teknisi</th>
              <th className="text-center">Job</th>
              <th className="text-right">Total Omset</th>
              <th className="text-right">Komisi</th>
              <th className="text-right">Save Komisi</th>
              <th className="text-right">Transport</th>
              <th className="text-right">Biaya Lain</th>
              <th className="text-right">Setoran Masuk</th>
              <th className="text-right">Kurang Setor</th>
              <TableActionHeader />
            </tr>
          </thead>
          <tbody>
            {technicianSummary.length === 0 ? (
               <tr>
                 <td colSpan={11} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <OperationalEmptyState
                        icon={Users}
                        title="Belum ada data rekap"
                        description="Sesuaikan filter untuk melihat data."
                        className="py-12"
                    />
                 </td>
               </tr>
            ) : (
               technicianSummary.map((tech: any, rowIndex: number) => {
                  const getPct = (val: number) => tech.totalRevenue > 0 ? ((val / tech.totalRevenue) * 100).toFixed(1) : '0';
                  
                  return (
                  <tr key={tech.id}>
                     <td className="text-center text-sm font-semibold text-slate-500">{rowIndex + 1}</td>
                     <td>
                        <TableText primary={tech.name} secondary={tech.role} />
                     </td>
                     <td className="text-center">
                        <TableText
                          className="items-center text-center"
                          primary={`${tech.totalFinished}/${tech.totalOrders}`}
                          secondary={`${tech.totalVisit} Visit . ${tech.totalHomeService} HS`}
                        />
                     </td>
                     <td className="text-right">
                        <TableText className="items-end" primary={formatRupiah(tech.totalRevenue)} />
                     </td>
                     <td className="text-right">
                        <TableText className="items-end" primary={formatRupiah(tech.totalCommission)} primaryClassName="text-emerald-700" secondary={`${getPct(tech.totalCommission)}%`} />
                     </td>
                     <td className="text-right">
                        <TableText className="items-end" primary={formatRupiah(tech.totalSaving)} primaryClassName="text-teal-700" secondary={`${getPct(tech.totalSaving)}%`} />
                     </td>
                     <td className="text-right">
                        <TableText className="items-end" primary={formatRupiah(tech.totalTransport)} primaryClassName="text-orange-700" secondary={`${getPct(tech.totalTransport)}%`} />
                     </td>
                     <td className="text-right">
                        <TableText className="items-end" primary={formatRupiah(tech.totalOtherCost)} primaryClassName="text-red-700" secondary={`${getPct(tech.totalOtherCost)}%`} />
                     </td>
                     <td className="text-right">
                        <TableText className="items-end" primary={formatRupiah(tech.totalDeposit)} primaryClassName="text-blue-700" />
                     </td>
                     <td className="text-right">
                        {(() => {
                            const balance = tech.totalDebt;
                            if (balance > 500) {
                                return <span className="font-bold text-[11px] text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100 whitespace-nowrap">Kurang {formatRupiah(balance)}</span>;
                            } else if (balance < -500) {
                                return <span className="font-bold text-[11px] text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 whitespace-nowrap">Lebih {formatRupiah(Math.abs(balance))}</span>;
                            } else {
                                return <span className="font-bold text-[11px] text-slate-400 bg-slate-100 px-2 py-1 rounded border border-slate-200">Lunas</span>;
                            }
                        })()}
                     </td>
                     <TableActionCell>
                        <TableActionMenu>
                          <TableActionMenuItem icon={Copy} onClick={() => handleCopySummary(tech)}>
                            Salin rekap
                          </TableActionMenuItem>
                        </TableActionMenu>
                     </TableActionCell>
                  </tr>
                  );
               })
            )}
          </tbody>
        </table>
        </DataTable>
      </OperationalTableCard>
    </div>
      ) : (
      <div className="space-y-4">
        <OperationalKpiGrid className="lg:grid-cols-4">
            <OperationalKpiCard
                label="Total Transaksi"
                value={formatRupiah(transactionStats.total)}
                icon={ArrowRightLeft}
                tone="default"
            />
            <OperationalKpiCard
                label="Menunggu Validasi"
                value={formatRupiah(transactionStats.pending)}
                icon={AlertTriangle}
                tone={transactionStats.pendingCount > 0 ? 'amber' : 'default'}
            />
            <OperationalKpiCard
                label="Kas Masuk"
                value={formatRupiah(transactionStats.incoming)}
                icon={ArrowDownCircle}
                tone="emerald"
            />
            <OperationalKpiCard
                label="Kas Keluar"
                value={formatRupiah(transactionStats.outgoing)}
                icon={ArrowUpCircle}
                tone="rose"
            />
        </OperationalKpiGrid>

        <OperationalTableCard className="operationalReportTableCard">
          <div className="operationalReportTableHeader">
            <div className="operationalReportTableTopline">
              <div>
                <MasterDataTableTitle title="Transaksi Operasional" count={operationalTransactions.length} icon={ArrowRightLeft} variant="active" />
                <p className="operationalReportTableSubtitle">
                  Rekap salin tagihan, rekap finance, dan req transfer untuk validator finance.
                </p>
              </div>
            </div>
          </div>

          <DataTable
            className="operationalReportDataTable"
            columns={createDataTableColumns([
              'number',
              'date',
              'name',
              'text',
              'status',
              'money',
              'status',
              'description',
              'action',
            ])}
            rowMinHeight={92}
            cellX={16}
            cellY={14}
            primaryLines={2}
            secondaryLines={2}
          >
            <table>
              <thead>
                <tr>
                  <th className="text-center">No</th>
                  <th>Tanggal</th>
                  <th>Teknisi</th>
                  <th>Transaksi</th>
                  <th className="text-center">Arah</th>
                  <th className="text-right">Nominal</th>
                  <th className="text-center">Status</th>
                  <th>Rincian</th>
                  <TableActionHeader />
                </tr>
              </thead>
              <tbody>
                {operationalTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <OperationalEmptyState
                        icon={ArrowRightLeft}
                        title="Belum ada transaksi"
                        description="Pilih laporan lalu klik Buat Rekap Finance atau Buat Req Transfer untuk mencatat transaksi."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  operationalTransactions.map((tx, rowIndex) => {
                    const canValidateDeposit = canValidateOperationalTransactions && tx.type === 'deposit' && tx.reportIds.length > 0 && tx.reports.some((report) => report.technicianDepositAmount > 0) && tx.status !== 'done';
                    const canValidatePayout = canValidateOperationalTransactions && tx.type === 'payout' && tx.reportIds.length > 0 && tx.status !== 'done';
                    const templateLabel = getOperationalTransactionTemplateLabel(tx);
                    const hasPrimaryValidation = canValidateDeposit || canValidatePayout;
                    const transactionVisual = getOperationalTransactionVisual(tx);
                    const forwardRef = buildOperationalExpenseForwardRef(tx);
                    const isForwardedExpense = tx.type === 'payout' && forwardedExpenseRefs.includes(forwardRef);

                    return (
                    <tr
                      key={tx.id}
                      onClick={() => handleViewDetail(tx.reports)}
                      className={cn("cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50", transactionVisual.rowClass)}
                    >
                      <td className="text-center text-sm font-semibold text-slate-500">{rowIndex + 1}</td>
                      <td>
                        <TableText
                          primary={tx.dateLabel}
                          secondary={`${tx.reportCount} laporan${tx.requestedAt ? ` . Forward ${format(new Date(tx.requestedAt), 'dd/MM HH:mm')}` : ''}`}
                        />
                      </td>
                      <td>
                        <TableText primary={tx.technicianName} secondary={tx.role} />
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="outline" className={cn("text-[10px] font-semibold uppercase tracking-wide", transactionVisual.categoryClass)}>
                            {transactionVisual.categoryLabel}
                          </Badge>
                          <Badge variant="outline" className={cn("text-[10px]", transactionVisual.transactionClass)}>
                            {tx.label}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {getOperationalTransactionSourceLabel(tx)}
                          {tx.requestedAt ? ` - ${format(new Date(tx.requestedAt), 'dd/MM HH:mm')}` : ''}
                        </div>
                      </td>
                      <td className="text-center">
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] font-semibold", transactionVisual.directionClass)}
                        >
                          {transactionVisual.directionLabel}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <div className={cn("font-semibold", transactionVisual.amountClass)}>
                          {formatRupiah(tx.amount)}
                        </div>
                      </td>
                      <td className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            tx.status === 'done' && "border-emerald-200 bg-emerald-50 text-emerald-700",
                            tx.status === 'pending' && "border-amber-200 bg-amber-50 text-amber-700",
                            tx.status === 'issue' && "border-red-200 bg-red-50 text-red-700"
                          )}
                        >
                          {tx.statusLabel}
                        </Badge>
                      </td>
                      <td>
                        <TableText primary={tx.description} secondary={tx.sourceLabel} />
                      </td>
                      <TableActionCell onClick={(event) => event.stopPropagation()}>
                        <TableActionMenu contentClassName="w-56">
                          <TableActionMenuItem icon={Eye} onClick={() => handleViewDetail(tx.reports)}>
                            Detail
                          </TableActionMenuItem>
                          {templateLabel && (
                            <TableActionMenuItem icon={Copy} onClick={() => handleCopy(tx.templateText!)}>
                              {templateLabel}
                            </TableActionMenuItem>
                          )}
                          {canValidateDeposit && (
                            <TableActionMenuItem icon={CheckCircle2} onClick={() => requestTransactionValidation(tx, 'deposit')}>
                              Validasi setoran
                            </TableActionMenuItem>
                          )}
                          {canValidatePayout && (
                            <TableActionMenuItem icon={CheckCircle2} onClick={() => requestTransactionValidation(tx, 'payout')}>
                              Validasi transfer
                            </TableActionMenuItem>
                          )}
                          {tx.type === 'payout' && tx.status === 'done' && isForwardedExpense && (
                            <TableActionMenuItem disabled icon={CheckCircle2}>
                              Sudah diforward
                            </TableActionMenuItem>
                          )}
                          {tx.type === 'payout' && tx.status === 'done' && !isForwardedExpense && canForwardOperationalExpenses && (
                            <TableActionMenuItem icon={ArrowRightLeft} onClick={() => handleForwardToOperationalExpenses(tx)}>
                              Forward biaya
                            </TableActionMenuItem>
                          )}
                          {tx.type === 'payout' && tx.status === 'done' && !isForwardedExpense && !canForwardOperationalExpenses && (
                            <TableActionMenuItem disabled icon={ArrowRightLeft}>
                              Forward terkunci
                            </TableActionMenuItem>
                          )}
                          {tx.type === 'payout' && tx.status !== 'done' && (
                            <TableActionMenuItem disabled icon={ArrowRightLeft}>
                              Forward setelah validasi
                            </TableActionMenuItem>
                          )}
                          <TableActionMenuItem
                            danger={tx.status !== 'done'}
                            icon={tx.status === 'done' ? Trash2 : X}
                            onClick={() => setPendingTransactionCancel(tx)}
                          >
                            {tx.status === 'done' ? 'Hapus dari daftar' : 'Batalkan'}
                          </TableActionMenuItem>
                        </TableActionMenu>
                      </TableActionCell>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </DataTable>
        </OperationalTableCard>
      </div>
      )}

      {/* DETAIL DIALOG */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <MasterDataFormDialogContent
          preventOutsideClose={false}
          size={selectedDetailReports.length > 1 ? 'wide' : 'default'}
          className="operationalReportDetailDialog"
        >
          <MasterDataFormHeader
            icon={Briefcase}
            title={selectedDetailReports.length > 1 ? 'Detail Transaksi' : 'Detail Laporan'}
            description={
              selectedDetailReports.length > 1
                ? 'Daftar laporan harian yang membentuk transaksi gabungan ini.'
                : 'Informasi lengkap laporan operasional teknisi.'
            }
          />
          
          {selectedDetailReports.length > 1 ? (() => {
             const sortedDetails = [...selectedDetailReports].sort((a, b) => getReportDateTime(a) - getReportDateTime(b));
             const detailTotals = sortedDetails.reduce((acc, report) => {
                const calcs = calculateFinancials(report);
                acc.revenue += calcs.totalRevenue;
                acc.cash += calcs.cashOnHand;
                acc.deposit += report.technicianDepositAmount || 0;
                acc.balance += calcs.balance;
                acc.officeDebt += calcs.officeDebt;
                return acc;
             }, {
                revenue: 0,
                cash: 0,
                deposit: 0,
                balance: 0,
                officeDebt: 0,
             });

             return (
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Laporan</div>
                      <div className="mt-1 text-base font-bold text-slate-900">{sortedDetails.length}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Revenue</div>
                      <div className="mt-1 text-base font-bold text-emerald-700">{formatRupiah(detailTotals.revenue)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Setor Aktual</div>
                      <div className="mt-1 text-base font-bold text-blue-700">{formatRupiah(detailTotals.deposit)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Selisih</div>
                      <div className={cn(
                        "mt-1 text-base font-bold",
                        detailTotals.balance > 500 ? "text-rose-700" : detailTotals.balance < -500 ? "text-blue-700" : "text-emerald-700"
                      )}>
                        {formatRupiah(detailTotals.balance)}
                      </div>
                    </div>
                  </div>

                  <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                    {sortedDetails.map((report) => {
                      const calcs = calculateFinancials(report);
                      return (
                        <div key={report.id || `${report.date}-${report.technicianName}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="font-bold text-slate-900">{format(new Date(report.date), 'dd MMMM yyyy', { locale: id })}</div>
                              <div className="mt-0.5 text-xs text-slate-500">{report.technicianName} . {report.role}</div>
                            </div>
                            <Badge
                              className={cn(
                                "w-fit text-[10px]",
                                calcs.balance > 500
                                  ? "bg-red-500 hover:bg-red-600"
                                  : calcs.balance < -500
                                    ? "bg-blue-500 hover:bg-blue-600"
                                    : "bg-emerald-500 hover:bg-emerald-600"
                              )}
                            >
                              {calcs.balance > 500 ? 'Kurang Setor' : calcs.balance < -500 ? 'Lebih Setor' : 'Lunas'}
                            </Badge>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                            <div>
                              <div className="text-[10px] font-bold uppercase text-slate-400">Order</div>
                              <div className="font-semibold text-slate-900">{report.totalFinished}/{report.totalOrders}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase text-slate-400">Revenue</div>
                              <div className="font-semibold text-emerald-700">{formatRupiah(calcs.totalRevenue)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase text-slate-400">Wajib Setor</div>
                              <div className="font-semibold text-blue-700">{formatRupiah(calcs.targetSetor)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase text-slate-400">Setor Aktual</div>
                              <div className="font-semibold text-slate-900">{formatRupiah(report.technicianDepositAmount || 0)}</div>
                            </div>
                          </div>

                          {(report.transportCost > 0 || report.otherCost > 0 || report.notes) && (
                            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                              {report.transportCost > 0 && <div>Transport: {formatRupiah(report.transportCost)}</div>}
                              {report.otherCost > 0 && <div>Biaya lain: {formatRupiah(report.otherCost)} {report.otherCostDesc ? `(${report.otherCostDesc})` : ''}</div>}
                              {report.notes && <div>Catatan: {report.notes}</div>}
                            </div>
                          )}

                          <div className="mt-3 flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setSelectedDetailReports([report])} className="h-8 px-3 text-xs">
                              Buka Detail
                            </Button>
                            {hasPermission('daily_report.edit') && (
                              <Button size="sm" onClick={() => {
                                setIsDetailOpen(false);
                                handleEditReport(report);
                              }} className="h-8 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700">
                                Edit
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
             );
          })() : selectedDetailReport && (() => {
             const r = selectedDetailReport;
             const calcs = calculateFinancials(r);
             return (
                 <div className="space-y-6 pt-2">
                     {/* Section 1: Header Info */}
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Tanggal</Label>
                            <div className="font-semibold text-slate-900 text-sm">{format(new Date(r.date), 'dd MMMM yyyy', { locale: id })}</div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Teknisi</Label>
                            <div className="font-semibold text-slate-900 text-sm">{r.technicianName}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{r.role}</div>
                        </div>
                     </div>

                     {/* Section 2: Stats Grid */}
                     <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-2">
                            <TrendingUp className="w-3.5 h-3.5" /> STATISTIK ORDER
                        </h4>
                        <div className="grid grid-cols-4 gap-2 text-center">
                             <div className="bg-white dark:bg-slate-800 p-2 rounded shadow-sm border border-slate-200 dark:border-slate-700">
                                <div className="text-[10px] text-slate-400 mb-0.5">Total</div>
                                <div className="text-sm font-bold">{r.totalOrders}</div>
                             </div>
                             <div className="bg-white dark:bg-slate-800 p-2 rounded shadow-sm border border-slate-200 dark:border-slate-700">
                                <div className="text-[10px] text-emerald-500 mb-0.5">Selesai</div>
                                <div className="text-sm font-bold text-emerald-600">{r.totalFinished}</div>
                             </div>
                             <div className="bg-white dark:bg-slate-800 p-2 rounded shadow-sm border border-slate-200 dark:border-slate-700">
                                <div className="text-[10px] text-blue-500 mb-0.5">Visit</div>
                                <div className="text-sm font-bold text-blue-600">{r.totalVisit}</div>
                             </div>
                             <div className="bg-white dark:bg-slate-800 p-2 rounded shadow-sm border border-slate-200 dark:border-slate-700">
                                <div className="text-[10px] text-indigo-500 mb-0.5">HS</div>
                                <div className="text-sm font-bold text-indigo-600">{r.totalHomeService}</div>
                             </div>
                        </div>
                     </div>

                     {/* Section 3: Financials */}
                     <div className="space-y-3">
                         <h4 className="text-xs font-bold text-slate-500 flex items-center gap-2 border-b border-slate-100 pb-2">
                             <Wallet className="w-3.5 h-3.5" /> RINCIAN KEUANGAN
                         </h4>
                         
                         {/* Revenue */}
                         <div className="flex justify-between items-center py-1">
                             <span className="text-sm text-slate-600 dark:text-slate-400">Total Pendapatan</span>
                             <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{formatRupiah(calcs.totalRevenue)}</span>
                         </div>
                         <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pl-4 border-l-2 border-slate-100">
                             <div className="flex justify-between">
                                 <span>Tunai (Cash):</span>
                                 <span>{formatRupiah(r.revenueCash)}</span>
                             </div>
                             <div className="flex justify-between">
                                 <span>Transfer:</span>
                                 <span>{formatRupiah(r.revenueTransfer)}</span>
                             </div>
                         </div>

                         {/* Costs */}
                         <div className="space-y-1 pt-2">
                             <div className="flex justify-between items-center text-sm">
                                 <span className="text-slate-600 dark:text-slate-400">Komisi Teknisi ({r.commissionRate}%)</span>
                                 <span className="font-medium text-emerald-600">{formatRupiah(calcs.commissionAmount)}</span>
                             </div>
                             {r.transportCost > 0 && (
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-600 dark:text-slate-400">Transport/Bensin</span>
                                     <span className="font-medium text-orange-600">{formatRupiah(r.transportCost)}</span>
                                 </div>
                             )}
                             {r.otherCost > 0 && (
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-600 dark:text-slate-400">Biaya Lain ({r.otherCostDesc})</span>
                                     <span className="font-medium text-orange-600">{formatRupiah(r.otherCost)}</span>
                                 </div>
                             )}
                         </div>

                         {/* Settlement / Finance Action */}
                         {calcs.officeDebt > 0 ? (
                             <div className="border border-blue-100 dark:border-blue-900/30 rounded-xl p-4 bg-white dark:bg-slate-900 shadow-sm mt-4">
                                 {/* Header */}
                                 <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100">
                                      <div className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-wide">
                                          <Briefcase className="w-4 h-4" />
                                          HAK TEKNISI (NET)
                                      </div>
                                      <span className="text-blue-600 font-bold text-base">{formatRupiah(calcs.netHakTeknisi)}</span>
                                 </div>
                         
                                 {/* Amount Box */}
                                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-center mb-4 shadow-sm">
                                      <div className="text-[10px] text-slate-400 font-bold uppercase mb-1 tracking-wider">FINANCE WAJIB TRANSFER</div>
                                      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatRupiah(calcs.officeDebt)}</div>
                                 </div>
                         
                                 {/* Toggle Controls */}
                                 <div className="space-y-2">
                                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">STATUS TRANSFER FINANCE</div>
                                      <div className="flex gap-2">
                                          <Button 
                                             variant={isTechnicianPayoutPaid(r.paymentStatus) ? 'default' : 'outline'}
                                             disabled={!canValidateOperationalTransactions}
                                             className={cn(
                                                 "flex-1 h-9 text-xs font-bold transition-all",
                                                 isTechnicianPayoutPaid(r.paymentStatus)
                                                     ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200" 
                                                     : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                                             )}
                                             onClick={() => requestSinglePaymentValidation(r)}
                                          >
                                             VALIDASI TRANSFER
                                          </Button>
                                          <Button 
                                             variant={!isTechnicianPayoutPaid(r.paymentStatus) ? 'default' : 'outline'}
                                             disabled={!canValidateOperationalTransactions}
                                             className={cn(
                                                 "flex-1 h-9 text-xs font-bold transition-all",
                                                 !isTechnicianPayoutPaid(r.paymentStatus)
                                                     ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border-2 border-slate-900 dark:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm" 
                                                     : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                                             )}
                                             onClick={() => handleUpdatePaymentStatus(r.id!, 'Unpaid')}
                                          >
                                             BELUM
                                          </Button>
                                      </div>
                                 </div>
                             </div>
                         ) : (
                             <div className="bg-blue-50 rounded-lg p-3 mt-2 border border-blue-100">
                                 <div className="flex justify-between items-center mb-1">
                                     <span className="text-xs font-semibold text-blue-700">KEWAJIBAN SETOR (CASH)</span>
                                     <span className="text-sm font-bold text-blue-800">{formatRupiah(calcs.cashOnHand)}</span>
                                 </div>
                                 
                                 {/* Pengurang: Hak Teknisi (Freelance) */}
                                 {r.role === 'Freelance' && calcs.netHakTeknisi > 0 && (
                                     <div className="flex justify-between items-center text-xs text-red-600/80 mt-1">
                                         <span>(-) Potong Hak</span>
                                         <span>{formatRupiah(calcs.netHakTeknisi)}</span>
                                     </div>
                                 )}
    
                                 {r.technicianDepositAmount > 0 && (
                                     <div className="flex justify-between items-center text-xs text-blue-600/80 mt-1">
                                         <span>(-) Sudah Setor ({r.depositType})</span>
                                         <span>{formatRupiah(r.technicianDepositAmount)}</span>
                                     </div>
                                 )}
                                 
                                 <div className="mt-2 pt-2 border-t border-blue-200/50 flex justify-between items-center">
                                     <span className="text-xs font-bold text-blue-900">STATUS AKHIR</span>
                                     <Badge className={cn(
                                         "text-[10px] h-5",
                                         calcs.balance > 500 ? "bg-red-500 hover:bg-red-600" : 
                                         calcs.balance < -500 ? "bg-blue-500 hover:bg-blue-600" : "bg-emerald-500 hover:bg-emerald-600"
                                     )}>
                                         {calcs.balance > 500 ? "KURANG SETOR" : calcs.balance < -500 ? "LEBIH SETOR (HUTANG)" : "LUNAS"}
                                     </Badge>
                                 </div>
                             </div>
                         )}
                     </div>
                     
                     {r.notes && (
                        <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 text-xs text-amber-800 flex gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                            <div>
                                <div className="font-bold mb-0.5">Catatan:</div>
                                {r.notes}
                            </div>
                        </div>
                     )}

                     {/* Action Templates (Copy Info) */}
                     <div className="grid grid-cols-2 gap-2 mt-4">
                        {/* 1. Button Tagih Setoran (Jika Kurang Setor / Balance > 0) */}
                        {calcs.balance > 0 && (
                            <Button 
                                variant="outline" 
                                className="h-auto py-2 flex flex-col items-center gap-1 border-slate-200 hover:bg-slate-50 hover:text-blue-600"
                                onClick={() => {
                                    const isFreelance = r.role === 'Freelance';
                                    let details = `Total Cash Diterima: ${formatRupiah(calcs.cashOnHand)}`;
                                    
                                    if (isFreelance) {
                                       details += `\n(-) Potongan Hak Teknisi: ${formatRupiah(calcs.netHakTeknisi)}`;
                                    } else {
                                       // Karyawan: Jika ada potongan operasional
                                       if ((r.transportCost || 0) > 0) details += `\n(-) Transport: ${formatRupiah(r.transportCost || 0)}`;
                                       if ((r.otherCost || 0) > 0) details += `\n(-) Biaya Lain: ${formatRupiah(r.otherCost || 0)} ${r.notes ? `(${r.notes})` : ''}`;
                                    }
                                    
                                    details += `\n(-) Sudah Setor: ${formatRupiah(r.technicianDepositAmount)}`;
                                    
                                    const text = `Halo ${r.technicianName},\nBerikut rincian setoran untuk tanggal ${format(new Date(r.date), 'dd MMMM yyyy', { locale: id })}:\n\n${details}\n--------------------------\nKURANG SETOR: ${formatRupiah(calcs.balance)}\n\nMohon segera ditransfer ke rekening kantor. Terima kasih.`;
                                    handleCopy(text);
                                    recordOperationalTransactionAction('technician_billing', [r], text);
                                }}
                            >
                                <Copy className="w-4 h-4 text-slate-400 mb-0.5" />
                                <span className="text-xs font-semibold">Salin Tagihan</span>
                                <span className="text-[9px] text-slate-400 font-normal">Untuk Teknisi</span>
                            </Button>
                        )}

                        {/* 2. Button Request Finance (Jika Lebih Setor / Balance < 0) */}
                        {calcs.balance < 0 && (
                            <Button 
                                variant="outline" 
                                className="h-auto py-2 flex flex-col items-center gap-1 border-slate-200 hover:bg-slate-50 hover:text-blue-600"
                                onClick={() => {
                                    const isFreelance = r.role === 'Freelance';
                                    let rincian = `- Cash Diterima: ${formatRupiah(calcs.cashOnHand)}`;
                                    rincian += `\n- Setoran Masuk: ${formatRupiah(r.technicianDepositAmount)}`;
                                    
                                    if (isFreelance) {
                                        rincian += `\n- Hak Teknisi (Tertahan): ${formatRupiah(calcs.netHakTeknisi)}`;
                                    }
                                    
                                    const amount = Math.abs(calcs.balance);
                                    
                                    const text = `Request Transfer Balik (Lebih Setor)\n\nTeknisi: ${r.technicianName}\nTanggal: ${format(new Date(r.date), 'dd MMMM yyyy', { locale: id })}\nRole: ${r.role}\n\nRincian:\n${rincian}\n--------------------------\nTOTAL TRANSFER BALIK: ${formatRupiah(amount)}\n\nMohon diproses transfer ke rekening teknisi. Terima kasih.`;
                                    handleCopy(text);
                                    if (recordOperationalTransactionAction('transfer_request', [r], text)) {
                                        setIsDetailOpen(false);
                                        setViewMode('transactions');
                                    }
                                }}
                            >
                                <Copy className="w-4 h-4 text-slate-400 mb-0.5" />
                                <span className="text-xs font-semibold">Salin Req. Refund</span>
                                <span className="text-[9px] text-slate-400 font-normal">Lebih Setor</span>
                            </Button>
                        )}
                     </div>

                 </div>
             )
          })()}
          
          <div className="pt-4 mt-2 border-t border-slate-100 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsDetailOpen(false)}>Tutup</Button>
              {hasPermission('daily_report.edit') && selectedDetailReports.length <= 1 && selectedDetailReport && (
              <Button onClick={() => {
                  setIsDetailOpen(false);
                  handleEditReport(selectedDetailReport!);
              }} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                  <Edit className="w-4 h-4" />
                  Edit Laporan
              </Button>
              )}
          </div>
        </MasterDataFormDialogContent>
      </Dialog>

      {/* MODAL */}
      <Sheet open={isFormOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent 
            side={isMobile ? "bottom" : "right"} 
            onInteractOutside={(e) => {
            // Prevent auto-close on outside click if dirty
            if (formData && initialFormData && JSON.stringify(formData) !== JSON.stringify(initialFormData)) {
                e.preventDefault();
                setShowUnsavedAlert(true);
            }
        }} className={cn(
            "bg-white dark:bg-slate-900 flex flex-col p-0 shadow-2xl transition-all duration-300",
            isMobile 
                ? "h-[92vh] max-h-[92vh] rounded-t-2xl border-t border-slate-200" 
                : "w-[900px] sm:max-w-[90vw] border-l border-slate-200 h-full"
        )}>
           <SheetHeader className="p-6 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
             <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Briefcase className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Form Laporan</span>
             </div>
             <SheetTitle className="text-xl font-bold text-slate-900 dark:text-slate-100">
               {formData?.id ? 'Edit Laporan Harian' : 'Buat Laporan Baru'}
             </SheetTitle>
             <SheetDescription className="text-slate-500 dark:text-slate-400">
               Isi data pendapatan dan pengeluaran operasional teknisi.
             </SheetDescription>
           </SheetHeader>
           
           {formData && (() => {
               const calcs = calculateFinancials(formData);
               return (
                  <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                       
                       {/* LEFT COLUMN */}
                       <div className="lg:col-span-7 space-y-8">
                           {/* Info Dasar */}
                           <MasterDataFormGrid className="grid-cols-1 md:grid-cols-2">
                              <MasterDataFormField span="half">
                                <MasterDataFieldLabel required>Tanggal Laporan</MasterDataFieldLabel>
                                <Input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="bg-white dark:bg-slate-800" />
                              </MasterDataFormField>
                              <MasterDataFormField span="half">
                                <MasterDataFieldLabel required>Nama Teknisi</MasterDataFieldLabel>
                                <Select value={formData.technicianId} onValueChange={handleTechnicianChange} disabled={!!formData.id}>
                                  <SelectTrigger className="bg-white dark:bg-slate-800"><SelectValue placeholder="Pilih Teknisi" /></SelectTrigger>
                                  <SelectContent>{activeTechnicians.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                </Select>
                              </MasterDataFormField>
                           </MasterDataFormGrid>
                           
                           {/* Cards Statistik */}
                           <div className="space-y-4">
                              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                <TrendingUp className="w-3 h-3" /> Statistik Order
                              </h3>
                              <div className="grid grid-cols-4 gap-3">
                                 <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Total</div>
                                    <div className="text-xl font-bold text-slate-900 dark:text-slate-100">{formData.totalOrders}</div>
                                 </div>
                                 <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-sm">
                                    <div className="text-[10px] font-bold text-emerald-500 uppercase mb-1">Selesai</div>
                                    <div className="text-xl font-bold text-emerald-600">{formData.totalFinished}</div>
                                 </div>
                                 <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-sm">
                                    <div className="text-[10px] font-bold text-blue-500 uppercase mb-1">Visit</div>
                                    <div className="text-xl font-bold text-blue-600">{formData.totalVisit}</div>
                                 </div>
                                 <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-sm">
                                    <div className="text-[10px] font-bold text-indigo-500 uppercase mb-1">Home</div>
                                    <div className="text-xl font-bold text-indigo-600">{formData.totalHomeService}</div>
                                 </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                 <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex justify-between items-center">
                                    <span className="text-xs font-bold text-orange-700">TUNAI (CASH)</span>
                                    <span className="text-base font-bold text-orange-800">{formatRupiah(formData.revenueCash)}</span>
                                 </div>
                                 <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex justify-between items-center">
                                    <span className="text-xs font-bold text-blue-700">TRANSFER</span>
                                    <span className="text-base font-bold text-blue-800">{formatRupiah(formData.revenueTransfer)}</span>
                                 </div>
                              </div>
                           </div>

                           {/* Input Setoran - UPDATED HEIGHT & STYLE & BANK DATA */}
                           {formData.revenueCash > 0 && (
                           <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                                <div className="flex justify-between items-center mb-3">
                                   <div className="flex items-center gap-2">
                                     <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-md"><Wallet className="w-4 h-4 text-slate-600"/></div>
                                     <Label className="text-slate-900 font-semibold">Setor Ke Kantor</Label>
                                   </div>
                                   <Button size="sm" variant="secondary" className="h-7 text-xs bg-slate-600 text-white hover:bg-slate-700" onClick={() => setFormData({...formData, technicianDepositAmount: calcs.targetSetor})}>
                                     Auto: {formatRupiah(calcs.targetSetor)}
                                   </Button>
                                </div>
                                
                                {/* Row 1: Amount & Method */}
                                <div className="grid grid-cols-2 gap-4">
                                    <MasterDataCurrencyInput
                                      className="h-10 bg-slate-50 text-sm font-bold transition-all focus:bg-white"
                                      value={formData.technicianDepositAmount || 0}
                                      onValueChange={(value) => setFormData({...formData, technicianDepositAmount: Number(value || 0)})}
                                    />
                                    <div className="w-full">
                                        <Select value={formData.depositType} onValueChange={(v:any) => setFormData({...formData, depositType: v})}>
                                            <SelectTrigger className="h-10 bg-slate-50 border-slate-200 w-full"><SelectValue /></SelectTrigger>
                                            <SelectContent><SelectItem value="Transfer">Transfer</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Row 2: Bank (Full Width) */}
                                <div>
                                    {formData.depositType === 'Transfer' ? (
                                        <Select value={formData.depositReceiver} onValueChange={v => setFormData({...formData, depositReceiver: v})}>
                                          <SelectTrigger className="h-10 bg-slate-50 border-slate-200 w-full"><SelectValue placeholder="Pilih Bank Penerima" /></SelectTrigger>
                                          <SelectContent>
                                            {payments
                                                .filter((p: any) => {
                                                    const name = p.bankName || p.name || p.bank || '';
                                                    return name && name.toLowerCase() !== 'cash';
                                                })
                                                .map((p:any) => {
                                                    const name = p.bankName || p.name || p.bank || 'Bank';
                                                    const number = p.accountNumber || p.account_number || p.number || '';
                                                    const owner = p.accountName || p.account_name || p.owner || '';
                                                    return (
                                                        <SelectItem key={p.id} value={name}>
                                                            {name} {number ? `- ${number}` : ''} {owner ? `(${owner})` : ''}
                                                        </SelectItem>
                                                    )
                                                })}
                                          </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input value={formData.depositReceiver} onChange={e => setFormData({...formData, depositReceiver: e.target.value})} className="h-10 bg-slate-50 border-slate-200 w-full" placeholder="Nama Penerima Cash..." />
                                    )}
                                </div>

                                {/* Dynamic Alert Indicator */}
                                {(() => {
                                    const diff = calcs.balance; // Target - Setor. Positif = Kurang Setor, Negatif = Lebih Setor
                                    if (calcs.officeDebt > 0) {
                                         return (
                                            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 text-sm">
                                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                                <span className="font-semibold">Defisit: Kantor Berhutang {formatRupiah(calcs.officeDebt)}</span>
                                            </div>
                                         )
                                    }
                                    if (diff > 500) {
                                        return (
                                            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 border border-red-100 text-sm animate-in fade-in slide-in-from-top-1">
                                                <ArrowDownCircle className="w-4 h-4 shrink-0" />
                                                <span>Kurang Setor: </span>
                                                <span className="font-bold">{formatRupiah(diff)}</span>
                                            </div>
                                        );
                                    }
                                    if (diff < -500) {
                                        return (
                                            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 text-sm animate-in fade-in slide-in-from-top-1">
                                                <ArrowUpCircle className="w-4 h-4 shrink-0" />
                                                <span>Lebih Setor (Simpanan): </span>
                                                <span className="font-bold">{formatRupiah(Math.abs(diff))}</span>
                                            </div>
                                        );
                                    }
                                    return (
                                         <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 text-slate-500 border border-slate-100 text-sm">
                                            <CheckCircle className="w-4 h-4 shrink-0" />
                                            <span className="font-medium">Setoran Sesuai (Lunas)</span>
                                         </div>
                                    );
                                })()}
                           </div>
                           )}
                           
                           {/* Potongan */}
                           <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Potongan Operasional</h4>
                              
                              {/* UPDATE: Enable inputs for ALL roles, not just Freelance */}
                              <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <Label className="text-xs mb-1 block">Komisi (%)</Label>
                                    <Input type="number" value={formData.commissionRate} onChange={e => setFormData({...formData, commissionRate: Number(e.target.value)})} className="bg-slate-50 border-slate-200" />
                                    <p className="text-[10px] text-slate-500 mt-1 text-right font-medium">{formatRupiah(calcs.commissionAmount)}</p>
                                 </div>
                                 <div>
                                    <Label className="text-xs mb-1 block">Save (%)</Label>
                                    <Input type="number" value={formData.savingRate} onChange={e => setFormData({...formData, savingRate: Number(e.target.value)})} className="bg-slate-50 border-slate-200" />
                                    <p className="text-[10px] text-slate-500 mt-1 text-right font-medium">{formatRupiah(calcs.savingAmount)}</p>
                                 </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <Label className="text-xs mb-1 block">Transport (Rp)</Label>
                                    <MasterDataCurrencyInput value={formData.transportCost || 0} onValueChange={(value) => setFormData({...formData, transportCost: Number(value || 0)})} className="bg-slate-50 border-slate-200" />
                                    <p className="text-[10px] text-slate-500 mt-1 text-right font-medium">
                                        {calcs.totalRevenue > 0 ? ((formData.transportCost / calcs.totalRevenue) * 100).toFixed(1) : '0'}% dari Omset
                                    </p>
                                 </div>
                                 <div>
                                    <Label className="text-xs mb-1 block">Lainnya (Rp)</Label>
                                    <MasterDataCurrencyInput value={formData.otherCost || 0} onValueChange={(value) => setFormData({...formData, otherCost: Number(value || 0)})} className="bg-slate-50 border-slate-200" />
                                    <p className="text-[10px] text-slate-500 mt-1 text-right font-medium">
                                        {calcs.totalRevenue > 0 ? ((formData.otherCost / calcs.totalRevenue) * 100).toFixed(1) : '0'}% dari Omset
                                    </p>
                                 </div>
                              </div>
                              <Textarea placeholder="Catatan pengeluaran..." value={formData.otherCostDesc} onChange={e => setFormData({...formData, otherCostDesc: e.target.value})} className="bg-slate-50 border-slate-200 min-h-[80px]" />
                           </div>
                       </div>

                       {/* RIGHT COLUMN - SETTLEMENT */}
                       <div className="lg:col-span-5 space-y-6">
                          <Card className="border-slate-200 shadow-md bg-white overflow-hidden">
                             <div className="p-4 bg-slate-50 border-b border-slate-200">
                                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                  <ArrowRightLeft className="w-4 h-4 text-blue-500"/> Settlement Akhir
                                </h3>
                             </div>
                             
                             <div className="p-6 space-y-6">
                                {/* Summary List */}
                                <div className="space-y-3 text-sm">
                                   <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                                     <span className="text-slate-500 dark:text-slate-400">Total Pendapatan</span>
                                     <span className="font-bold text-slate-900 text-base">{formatRupiah(calcs.totalRevenue)}</span>
                                   </div>
                                   <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                                     <span className="text-slate-500 dark:text-slate-400">Hak Teknisi (Net)</span>
                                     <span className="font-bold text-slate-900 text-base">{formatRupiah(calcs.netHakTeknisi)}</span>
                                   </div>
                                   
                                   <div className="pt-2 space-y-2">
                                       {calcs.commissionAmount > 0 && <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>Komisi</span><span>{formatRupiah(calcs.commissionAmount)}</span></div>}
                                       {formData.transportCost > 0 && <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>Transport</span><span>{formatRupiah(formData.transportCost)}</span></div>}
                                       {formData.otherCost > 0 && <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>Lainnya</span><span>{formatRupiah(formData.otherCost)}</span></div>}
                                       {calcs.savingAmount > 0 && <div className="flex justify-between text-xs text-red-500"><span>Potongan Save</span><span>- {formatRupiah(calcs.savingAmount)}</span></div>}
                                   </div>
                               </div>

                               {/* Uang Cash Card */}
                               <div className="bg-orange-50 rounded-xl p-4 border border-orange-100 flex flex-col gap-1 text-center">
                                  <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">Uang Cash Dipegang Teknisi</span>
                                  <span className="text-2xl font-bold text-orange-700">{formatRupiah(Math.max(0, calcs.cashOnHand))}</span>
                               </div>

                               {/* Status Logic Handling - DUAL STATUS SYSTEM */}
                               {(() => {
                                  // 1. STATUS SETORAN (KEWAJIBAN TEKNISI)
                                  // Muncul jika ada target setor ATAU ada deposit yang sudah masuk (walau target 0)
                                  const showDepositStatus = calcs.targetSetor > 0 || (formData.technicianDepositAmount || 0) > 0;
                                  
                                  return (
                                    <div className="space-y-4">
                                        {showDepositStatus && (
                                            <div className={cn(
                                                "rounded-xl p-4 text-center text-white shadow-sm transition-all relative overflow-hidden",
                                                calcs.balance > 500 ? "bg-slate-800" : 
                                                calcs.balance < -500 ? "bg-orange-500" : 
                                                "bg-emerald-600"
                                            )}>
                                                {/* Background Pattern */}
                                                <div className="absolute top-0 right-0 p-2 opacity-10"><Wallet className="w-12 h-12"/></div>
                                                
                                                <div className="relative z-10">
                                                    <p className="text-[10px] uppercase font-bold opacity-80 mb-1 tracking-widest">Status Setoran (Cash)</p>
                                                    <div className="text-xl font-bold">
                                                        {calcs.balance > 500 ? `KURANG: ${formatRupiah(calcs.balance)}` : 
                                                         calcs.balance < -500 ? `LEBIH: ${formatRupiah(Math.abs(calcs.balance))}` : 
                                                         "LUNAS / SESUAI"}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* 2. STATUS PEMBAYARAN (HAK TEKNISI) */}
                                        {/* Muncul jika teknisi punya hak net > 0 ATAU ada hutang kantor */}
                                        {(calcs.netHakTeknisi > 0 || calcs.officeDebt > 0) && (
                                            <div className="rounded-xl p-4 border border-blue-100 bg-blue-50/30 space-y-3">
                                                <div className="flex justify-between items-center pb-2 border-b border-blue-100">
                                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                                        <Briefcase className="w-3.5 h-3.5" />
                                                        Hak Teknisi (Net)
                                                    </span>
                                                    <span className="font-bold text-blue-700">{formatRupiah(calcs.netHakTeknisi)}</span>
                                                </div>

                                                {calcs.isAutoDeducted ? (
                                                     <div className="bg-blue-100 text-blue-800 px-3 py-3 rounded-lg text-xs font-bold text-center border border-blue-200 flex items-center justify-center gap-2">
                                                        <CheckCircle2 className="w-4 h-4" />
                                                        LUNAS OTOMATIS (Potong Cash)
                                                     </div>
                                                ) : (
                                                    <>
                                                         {/* Card Wajib Bayar */}
                                                         {calcs.officeDebt > 0 && (
                                                             <div className="bg-white p-3 rounded-lg border border-blue-200 text-center shadow-sm">
                                                                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Finance Wajib Transfer</div>
                                                                <div className="text-xl font-bold text-slate-800">{formatRupiah(calcs.officeDebt)}</div>
                                                             </div>
                                                         )}

                                                         {/* Toggle Switch */}
                                                         <div className="w-full">
                                                              <Label className="text-[10px] font-semibold text-slate-500 mb-1.5 block uppercase tracking-wider">Status Pembayaran</Label>
                                                              <div className="flex flex-col gap-2 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                                                  <div className="grid grid-cols-3 gap-1">
                                                                    <button
                                                                        onClick={() => setFormData({...formData, paymentStatus: 'Unpaid'})}
                                                                        className={cn(
                                                                            "py-2 text-[10px] font-bold rounded-md transition-all",
                                                                            formData.paymentStatus === 'Unpaid' 
                                                                            ? "bg-white text-slate-800 shadow-sm border border-slate-200" 
                                                                            : "text-slate-400 hover:bg-white/50"
                                                                        )}
                                                                    >
                                                                        BELUM
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setFormData({...formData, paymentStatus: 'Paid'})}
                                                                        className={cn(
                                                                            "py-2 text-[10px] font-bold rounded-md transition-all flex flex-col items-center justify-center leading-none gap-0.5",
                                                                            formData.paymentStatus === 'Paid' 
                                                                            ? "bg-blue-500 text-white shadow-sm" 
                                                                            : "text-slate-400 hover:bg-white/50"
                                                                        )}
                                                                    >
                                                                        <span>POTONG</span>
                                                                        <span className="text-[8px] opacity-80 font-normal">CASH</span>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setFormData({...formData, paymentStatus: 'Paid_Transfer'})}
                                                                        className={cn(
                                                                            "py-2 text-[10px] font-bold rounded-md transition-all flex flex-col items-center justify-center leading-none gap-0.5",
                                                                            formData.paymentStatus === 'Paid_Transfer' 
                                                                            ? "bg-emerald-500 text-white shadow-sm" 
                                                                            : "text-slate-400 hover:bg-white/50"
                                                                        )}
                                                                    >
                                                                        <span>LUNAS</span>
                                                                        <span className="text-[8px] opacity-80 font-normal">TRANSFER</span>
                                                                    </button>
                                                                  </div>
                                                                  
                                                                  {/* Info Text */}
                                                                  <div className="px-1 text-[10px] text-slate-500 italic text-center">
                                                                    {formData.paymentStatus === 'Unpaid' && "Teknisi setor full cash. Hak dibayar nanti."}
                                                                    {formData.paymentStatus === 'Paid' && "Teknisi langsung potong uang cash."}
                                                                    {formData.paymentStatus === 'Paid_Transfer' && "Teknisi setor full cash. Hak sudah ditransfer."}
                                                                  </div>
                                                              </div>
                                                         </div>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                  );
                               })()}

                             </div>
                          </Card>
                       </div>
                    </div>
                  </div>
               );
           })()}
           
           <SheetFooter className="p-6 border-t border-slate-100 bg-white gap-3 shrink-0 pb-8 sm:pb-6">
             {formData?.id && (
               <Button variant="destructive" onClick={() => requestDeleteReport(formData)} disabled={isSaving} className="w-full sm:w-auto order-2 sm:order-none sm:mr-auto">
                 Hapus
               </Button>
             )}
             <Button variant="outline" onClick={() => handleSheetOpenChange(false)} className="h-10 px-6 w-full sm:w-auto">Batal</Button>
             <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-6 w-full sm:w-auto">
               {isSaving ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : 'Simpan Laporan'}
             </Button>
           </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(pendingDeleteReport)} onOpenChange={(open) => {
        if (!open && !isSaving) setPendingDeleteReport(null);
      }}>
        <AlertDialogContent className="max-w-md rounded-2xl border-slate-200 bg-white shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus laporan operasional?</AlertDialogTitle>
            <AlertDialogDescription>
              Laporan {pendingDeleteReport?.technicianName || 'teknisi'} tanggal {pendingDeleteReport?.date ? format(new Date(pendingDeleteReport.date), 'dd MMM yyyy', { locale: id }) : '-'} akan dihapus permanen dari list harian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteReport(null)} disabled={isSaving}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingDeleteReport;
                setPendingDeleteReport(null);
                void handleDelete(target);
              }}
              disabled={isSaving}
              className="dangerButton"
            >
              Hapus Laporan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingBulkAction)} onOpenChange={(open) => {
        if (!open) setPendingBulkAction(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingBulkAction?.title || 'Lanjutkan aksi?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBulkAction?.description || 'Aksi ini akan diproses untuk laporan yang dipilih.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingBulkAction(null)}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingBulkAction} className="bg-blue-600 hover:bg-blue-700">
              {pendingBulkAction?.confirmLabel || 'Ya, Lanjutkan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingValidation)} onOpenChange={(open) => {
        if (!open) setPendingValidation(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingValidation?.title || 'Validasi data?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingValidation?.description || 'Data laporan harian terkait akan diperbarui.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingValidation(null)}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingValidation} className="bg-blue-600 hover:bg-blue-700">
              Ya, Validasi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingTransactionCancel)} onOpenChange={(open) => {
        if (!open) setPendingTransactionCancel(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingTransactionCancel?.status === 'done' ? 'Hapus dari daftar transaksi?' : 'Batalkan permintaan transaksi?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTransactionCancel?.label || 'Transaksi'} akan dicatat sebagai dibatalkan di audit log dan disembunyikan dari tab Transaksi. Data List Harian tidak ikut berubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingTransactionCancel(null)}>Tidak</AlertDialogCancel>
            <AlertDialogAction variant="danger"
              onClick={() => pendingTransactionCancel && cancelOperationalTransaction(pendingTransactionCancel)}
              className="bg-red-600 hover:bg-red-700"
            >
              {pendingTransactionCancel?.status === 'done' ? 'Ya, Hapus dari daftar' : 'Ya, Batalkan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnsavedAlert} onOpenChange={setShowUnsavedAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Perubahan belum disimpan</AlertDialogTitle>
            <AlertDialogDescription>
              Anda memiliki perubahan yang belum disimpan. Apakah Anda yakin ingin menutup formulir ini? Data yang belum disimpan akan hilang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowUnsavedAlert(false)}>Batal</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => { setShowUnsavedAlert(false); setIsFormOpen(false); }} className="bg-red-600 hover:bg-red-700">
              Tutup Tanpa Menyimpan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OperationalPageShell>
  );
}

export default Laporan;
