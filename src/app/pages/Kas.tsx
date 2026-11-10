import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  ClipboardCheck,
  Download,
  Edit,
  Eye,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Lock,
  Plus,
  ReceiptText,
  Search,
  Upload,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';
import type { DateRange } from 'react-day-picker';
import { supabase } from '@/lib/supabaseClient';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import { DEFAULT_OPERATIONAL_EXPENSE_ONLY_ACCOUNTS } from '@/app/data/operationalExpenseAccounts';
import {
  OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY,
  type OperationalExpenseForwardDraft,
} from '@/app/data/operationalExpenseForwardDraft';
import {
  assertSpreadsheetRowLimit,
  getSpreadsheetReadRowLimit,
  validateSpreadsheetUploadFile,
} from '@/app/utils/spreadsheetUploadGuards';
import { usePermissions } from '../hooks/usePermissions';
import { useMasterData } from './master-data/context';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import {
  Dialog,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Calendar as DatePickerCalendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  Tabs,
  TabsContent,
  TabsRail,
  TabsTrigger,
  TabsViewport,
} from '../components/ui/tabs';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { HorizontalDragScrollArea } from '../components/ui/horizontal-drag-scroll';
import {
  createDataTableColumns,
  DataTable,
  TableActionCell,
  TableActionHeader,
  TableActionMenu,
  TableActionMenuItem,
  TableText,
} from '../components/ui/data-table';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '../components/ui/operational-page';
import {
  MasterDataCurrencyInput,
  MasterDataDialogBody,
  MasterDataFieldLabel,
  MasterDataFormActions,
  MasterDataFormDialogContent,
  MasterDataFormField,
  MasterDataFormGrid,
  MasterDataFormHeader,
} from '../components/ui/master-data-ui';
import { PeriodFilterPicker } from '../components/ui/period-filter-picker';

type OperationalExpenseCategory = {
  id: string;
  category: string;
  subcategory: string;
  account_code?: string;
  account_type?: 'income' | 'expense' | 'cogs';
  description?: string;
  finance_account_id?: string;
  finance_category_id?: string;
  is_active?: boolean;
  sort_order?: number;
};

type FinanceCategoryRow = {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'cogs';
  active: boolean;
  sort_order: number;
};

type FinanceAccountRow = {
  id: string;
  category_id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
};

type OperationalExpenseRow = {
  id: string;
  expense_date: string;
  period_key: string;
  branch_id?: string | null;
  branch_name?: string;
  category: string;
  subcategory?: string;
  vendor_name?: string;
  description?: string;
  amount: number;
  payment_source?: string;
  source_type?: string;
  source_ref?: string;
  notes?: string;
  status: 'active' | 'void';
  void_reason?: string;
  created_at?: string;
};

type OperationalExpenseListResponse = {
  data: OperationalExpenseRow[];
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type Summary = {
  totalAmount: number;
  transactionCount: number;
  averageAmount: number;
  categoryCount: number;
  subcategoryCount: number;
};

type FormState = {
  id?: string;
  expense_date: string;
  branch_id: string;
  category: string;
  subcategory: string;
  vendor_name: string;
  description: string;
  amount: string;
  payment_source: string;
  source_type: string;
  source_ref: string;
  notes: string;
};

type OperationalExpensePayload = {
  expense_date: string;
  branch_id: string;
  category: string;
  subcategory: string;
  vendor_name: string;
  description: string;
  amount: number;
  payment_source: string;
  source_type: string;
  source_ref: string;
  notes: string;
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string) => {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
};

const today = () => toDateKey(new Date());
const OPERATIONAL_EXPENSES_URL = buildMakeServerUrl('/finance/operational-expenses');
const OPTIONAL_SELECT_NONE = '__none__';
const EMPTY_SUMMARY: Summary = {
  totalAmount: 0,
  transactionCount: 0,
  averageAmount: 0,
  categoryCount: 0,
  subcategoryCount: 0,
};

const EMPTY_FORM: FormState = {
  expense_date: today(),
  branch_id: 'all',
  category: '',
  subcategory: '',
  vendor_name: '',
  description: '',
  amount: '',
  payment_source: '',
  source_type: 'manual',
  source_ref: '',
  notes: '',
};

const BULK_NO_CHANGE = '__no_change__';
const BULK_CLEAR_VALUE = '__clear__';
const BULK_INVALID_BRANCH_PREFIX = '__invalid_branch__:';
const BULK_INPUT_DEFAULT_ROWS = 10;

type BulkEditState = {
  expense_date: string;
  branch_id: string;
  category: string;
  subcategory: string;
  vendor_name: string;
  amount: string;
  payment_source: string;
  description: string;
  source_ref: string;
  notes: string;
};

const EMPTY_BULK_EDIT: BulkEditState = {
  expense_date: '',
  branch_id: BULK_NO_CHANGE,
  category: BULK_NO_CHANGE,
  subcategory: BULK_NO_CHANGE,
  vendor_name: BULK_NO_CHANGE,
  amount: '',
  payment_source: BULK_NO_CHANGE,
  description: '',
  source_ref: '',
  notes: '',
};

type BulkInputPreviewRow = {
  errors: string[];
  line: number;
  payload?: OperationalExpensePayload;
  rowId: string;
  raw: string;
};

type BulkInputDraftRow = {
  id: string;
  expense_date: string;
  category: string;
  subcategory: string;
  amount: string;
  branch_id: string;
  vendor_name: string;
  payment_source: string;
  description: string;
  notes: string;
  source_ref: string;
};

const createLocalId = () => {
  const cryptoRandom = globalThis.crypto?.randomUUID?.();
  return cryptoRandom || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const createBulkInputDraftRow = (overrides: Partial<BulkInputDraftRow> = {}): BulkInputDraftRow => ({
  id: createLocalId(),
  expense_date: '',
  category: '',
  subcategory: '',
  amount: '',
  branch_id: 'all',
  vendor_name: '',
  payment_source: '',
  description: '',
  notes: '',
  source_ref: '',
  ...overrides,
});

const createBulkInputDraftRows = (count = BULK_INPUT_DEFAULT_ROWS) =>
  Array.from({ length: count }, () => createBulkInputDraftRow());

const buildOperationalExpensePayloadFromForm = (source: FormState): OperationalExpensePayload => ({
  expense_date: source.expense_date,
  branch_id: source.branch_id === 'all' ? '' : source.branch_id,
  category: source.category,
  subcategory: source.subcategory,
  vendor_name: source.vendor_name,
  description: source.description,
  amount: Number(source.amount),
  payment_source: source.payment_source,
  source_type: source.source_type || 'manual',
  source_ref: source.source_ref,
  notes: source.notes,
});

const buildOperationalExpensePayloadFromRow = (row: OperationalExpenseRow): OperationalExpensePayload => ({
  expense_date: row.expense_date,
  branch_id: row.branch_id || '',
  category: row.category,
  subcategory: row.subcategory || '',
  vendor_name: row.vendor_name || '',
  description: row.description || '',
  amount: Number(row.amount) || 0,
  payment_source: row.payment_source || '',
  source_type: row.source_type || 'manual',
  source_ref: row.source_ref || '',
  notes: row.notes || '',
});

const normalizeLookupKey = (value: unknown) => String(value || '').trim().toLowerCase();

const parseBulkDate = (value: unknown) => {
  if (value instanceof Date) return toDateKey(value);

  const source = String(value || '').trim();
  if (!source) return '';
  if (/^\d{5,6}$/.test(source)) {
    const parsedDate = XLSX.SSF.parse_date_code(Number(source));
    if (parsedDate?.y && parsedDate?.m && parsedDate?.d) {
      return toDateKey(new Date(parsedDate.y, parsedDate.m - 1, parsedDate.d));
    }
  }

  const isoMatch = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, rawYear, rawMonth, rawDay] = isoMatch;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return source;
  }

  const match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return '';

  const [, rawDay, rawMonth, rawYear] = match;
  const day = Number(rawDay);
  const month = Number(rawMonth);
  const year = Number(rawYear);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';

  return toDateKey(date);
};

const formatBulkDateInput = (value: string) => {
  const source = value.trim();
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return source;
};

const parseBulkAmount = (value: string) => {
  const normalized = value.replace(/[^\d-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
};

const BULK_INPUT_TEMPLATE_ROWS = [
  {
    Tanggal: '06/08/2026',
    Kategori: 'Beban Operasional',
    'Sub Kategori': 'Biaya Sewa Kantor / Cabang',
    Nominal: 650000,
    Cabang: 'Bandung',
    Vendor: 'Kost Bandung',
    'Sumber Pembayaran': 'Bank Jago',
    Keterangan: 'Kost Bandung periode Agustus',
    Catatan: '-',
    Referensi: 'INV-001',
  },
  {
    Tanggal: '07/08/2026',
    Kategori: 'Beban Operasional',
    'Sub Kategori': 'Biaya Konsumsi / Makan',
    Nominal: 125000,
    Cabang: 'Umum',
    Vendor: '-',
    'Sumber Pembayaran': '-',
    Keterangan: 'Konsumsi teknisi',
    Catatan: '-',
    Referensi: '',
  },
];

type BulkImportField = keyof Omit<BulkInputDraftRow, 'id'>;

const BULK_IMPORT_FIELD_ALIASES: Record<BulkImportField, string[]> = {
  expense_date: ['tanggal', 'tgl', 'date', 'expense date', 'expense_date', 'expenseDate'],
  category: ['kategori', 'category', 'akun kategori', 'finance category'],
  subcategory: ['sub kategori', 'subkategori', 'sub category', 'subcategory', 'sub_category', 'akun', 'account', 'finance account'],
  amount: ['nominal', 'amount', 'jumlah', 'total', 'nilai', 'biaya'],
  branch_id: ['cabang', 'branch', 'branch id', 'branch_id', 'lokasi'],
  vendor_name: ['vendor', 'vendor name', 'vendor_name', 'penerima', 'supplier'],
  payment_source: ['sumber pembayaran', 'sumber', 'payment source', 'payment_source', 'bank', 'rekening'],
  description: ['keterangan', 'description', 'deskripsi', 'uraian'],
  notes: ['catatan', 'notes', 'note', 'memo'],
  source_ref: ['referensi', 'reference', 'ref', 'source ref', 'source_ref', 'invoice', 'no invoice', 'no bukti', 'bukti'],
};

const normalizeBulkImportHeader = (value: unknown) => normalizeLookupKey(value).replace(/[^a-z0-9]/g, '');

const BULK_IMPORT_FIELD_BY_HEADER = Object.entries(BULK_IMPORT_FIELD_ALIASES).reduce((acc, [field, aliases]) => {
  aliases.forEach((alias) => acc.set(normalizeBulkImportHeader(alias), field as BulkImportField));
  return acc;
}, new Map<string, BulkImportField>());

type BulkDatePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
};

function BulkDatePicker({
  value,
  onValueChange,
  placeholder = 'Pilih tanggal',
  allowClear = false,
}: BulkDatePickerProps) {
  const [open, setOpen] = useState(false);
  const normalizedValue = parseBulkDate(value);
  const selectedDate = normalizedValue ? parseDateKey(normalizedValue) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={`kasBulkDatePicker ${normalizedValue ? '' : 'isEmpty'}`}
        >
          <CalendarDays className="h-4 w-4" />
          <span>{normalizedValue ? formatBulkDateInput(normalizedValue) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="kasBulkDatePopover">
        <DatePickerCalendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            if (date) {
              onValueChange(toDateKey(date));
              setOpen(false);
            }
          }}
          initialFocus
        />
        {allowClear && normalizedValue ? (
          <Button
            type="button"
            variant="ghost"
            className="kasBulkDateClear"
            onClick={() => {
              onValueChange('');
              setOpen(false);
            }}
          >
            Tidak diubah
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const mapFinanceCategoriesToOperationalOptions = (
  financeCategories: FinanceCategoryRow[],
  financeAccounts: FinanceAccountRow[],
): OperationalExpenseCategory[] => {
  const categoryById = new Map(
    financeCategories
      .filter((category) => category.active && (category.type === 'expense' || category.type === 'cogs'))
      .map((category) => [category.id, category]),
  );

  return financeAccounts
    .flatMap((account) => {
      const category = categoryById.get(account.category_id);
      if (!category || !account.active) return [];

      return [{
        id: account.id,
        category: category.name,
        subcategory: account.name,
        account_code: account.code,
        account_type: category.type,
        description: account.description || '',
        finance_account_id: account.id,
        finance_category_id: category.id,
        is_active: true,
        sort_order: (category.sort_order || 0) * 100 + (Number(account.code) || 0),
      }];
    })
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory));
};

const fetchFinanceExpenseCategoryOptions = async () => {
  const [categoryResult, accountResult] = await Promise.all([
    supabase
      .from('finance_categories')
      .select('id, name, type, active, sort_order')
      .in('type', ['expense', 'cogs'])
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('finance_accounts')
      .select('id, category_id, name, code, description, active')
      .eq('active', true)
      .order('category_id', { ascending: true })
      .order('code', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (categoryResult.error) throw categoryResult.error;
  if (accountResult.error) throw accountResult.error;

  return mapFinanceCategoriesToOperationalOptions(
    (categoryResult.data || []) as FinanceCategoryRow[],
    (accountResult.data || []) as FinanceAccountRow[],
  );
};

const buildFormFromForwardDraft = (draft: OperationalExpenseForwardDraft): FormState => ({
  ...EMPTY_FORM,
  expense_date: draft.expense_date || today(),
  branch_id: draft.branch_id || 'all',
  category: draft.category || '',
  subcategory: draft.subcategory || '',
  vendor_name: draft.vendor_name || '',
  description: draft.description || '',
  amount: String(draft.amount || ''),
  payment_source: draft.payment_source || '',
  source_type: draft.source_type || 'manual',
  source_ref: draft.source_ref || '',
  notes: draft.notes || '',
});

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: await getSessionBackedEdgeHeaders({
      includeJsonContentType: Boolean(options.body),
      headers: options.headers,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404 && url.includes('/finance/operational-expense')) {
      throw new Error('Endpoint Biaya Operasional belum tersedia di server. Deploy migration dan function terbaru dulu.');
    }
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  return payload as T;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const formatDate = (value?: string) => {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const getPaymentSourceLabel = (payment: { bankName: string; accountNumber?: string; accountHolder?: string }) =>
  [payment.bankName, payment.accountNumber, payment.accountHolder].filter(Boolean).join(' - ');

type ExpenseBreakdownItem = {
  label: string;
  amount: number;
  count: number;
  percent: number;
};

const buildExpenseBreakdown = (
  rows: OperationalExpenseRow[],
  getLabel: (row: OperationalExpenseRow) => string,
  totalAmount: number,
  limit = 5,
): ExpenseBreakdownItem[] => {
  const grouped = rows.reduce((acc, row) => {
    const label = getLabel(row).trim() || '-';
    const current = acc.get(label) || { label, amount: 0, count: 0, percent: 0 };
    current.amount += Number(row.amount) || 0;
    current.count += 1;
    acc.set(label, current);
    return acc;
  }, new Map<string, ExpenseBreakdownItem>());

  const safeTotal = totalAmount > 0 ? totalAmount : Array.from(grouped.values()).reduce((sum, item) => sum + item.amount, 0);
  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      percent: safeTotal > 0 ? Math.round((item.amount / safeTotal) * 100) : 0,
    }))
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
};

export function Kas() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const { activeBranches, branches, payments, vendors } = useMasterData();
  const canView = hasPermission('operational_expenses.view');
  const canCreate = hasPermission('operational_expenses.create');
  const canEdit = hasPermission('operational_expenses.edit');
  const canDelete = hasPermission('operational_expenses.delete');

  const [rows, setRows] = useState<OperationalExpenseRow[]>([]);
  const [categories, setCategories] = useState<OperationalExpenseCategory[]>([]);
  const [listMeta, setListMeta] = useState<OperationalExpenseListResponse['meta'] | null>(null);
  const lastLoadErrorRef = useRef('');
  const forwardDraftAppliedRef = useRef(false);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const bulkInputBodyRef = useRef<HTMLDivElement>(null);
  const bulkSavingRef = useRef(false);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<OperationalExpenseRow | null>(null);
  const [voidRow, setVoidRow] = useState<OperationalExpenseRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState<BulkEditState>(EMPTY_BULK_EDIT);
  const [bulkVoidOpen, setBulkVoidOpen] = useState(false);
  const [bulkVoidReason, setBulkVoidReason] = useState('');
  const [bulkInputOpen, setBulkInputOpen] = useState(false);
  const [bulkInputRows, setBulkInputRows] = useState<BulkInputDraftRow[]>(() => createBulkInputDraftRows());
  const [bulkInputSelectionMode, setBulkInputSelectionMode] = useState(false);
  const [selectedBulkInputRowIds, setSelectedBulkInputRowIds] = useState<Set<string>>(() => new Set());
  const [bulkInputEditOpen, setBulkInputEditOpen] = useState(false);
  const [bulkInputEdit, setBulkInputEdit] = useState<BulkEditState>(EMPTY_BULK_EDIT);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [filters, setFilters] = useState({
    startDate: toDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: today(),
    branchId: 'all',
    category: 'all',
    subcategory: 'all',
    q: '',
  });
  const [debouncedSearch, setDebouncedSearch] = useState(filters.q);

  const filterDateRange = useMemo<DateRange | undefined>(() => {
    const from = parseDateKey(filters.startDate);
    const to = parseDateKey(filters.endDate);
    if (!from && !to) return undefined;
    return { from: from || to, to: to || from };
  }, [filters.startDate, filters.endDate]);

  const handleFilterDateRangeChange = (range?: DateRange) => {
    setFilters((prev) => ({
      ...prev,
      startDate: range?.from ? toDateKey(range.from) : '',
      endDate: range?.to ? toDateKey(range.to) : range?.from ? toDateKey(range.from) : '',
    }));
  };

  const categoryOptions = useMemo(
    () => Array.from(new Set(categories.map((item) => item.category).filter(Boolean))),
    [categories],
  );

  const subcategoryOptions = useMemo(() => {
    const source = filters.category === 'all'
      ? categories
      : categories.filter((item) => item.category === filters.category);
    return Array.from(new Set(source.map((item) => item.subcategory).filter(Boolean)));
  }, [categories, filters.category]);

  const formSubcategoryOptions = useMemo(() => {
    const source = form.category
      ? categories.filter((item) => item.category === form.category)
      : categories;
    return Array.from(new Set(source.map((item) => item.subcategory).filter(Boolean)));
  }, [categories, form.category]);

  const activeVendorOptions = useMemo(
    () => vendors
      .filter((vendor) => vendor.status === 'active' && vendor.name.trim())
      .sort((left, right) => left.name.localeCompare(right.name)),
    [vendors],
  );

  const activePaymentOptions = useMemo(
    () => payments
      .filter((payment) => payment.status === 'active' && getPaymentSourceLabel(payment))
      .sort((left, right) => getPaymentSourceLabel(left).localeCompare(getPaymentSourceLabel(right))),
    [payments],
  );

  const selectedBranchFallback = useMemo(() => {
    if (!form.branch_id || form.branch_id === 'all') return null;
    if (activeBranches.some((branch) => branch.id === form.branch_id)) return null;
    const branch = branches.find((item) => item.id === form.branch_id);
    return {
      id: form.branch_id,
      label: branch?.name ? `${branch.name} (tersimpan)` : 'Cabang tersimpan',
    };
  }, [activeBranches, branches, form.branch_id]);

  const selectedVendorFallback = useMemo(() => {
    if (!form.vendor_name) return null;
    if (activeVendorOptions.some((vendor) => vendor.name === form.vendor_name)) return null;
    return form.vendor_name;
  }, [activeVendorOptions, form.vendor_name]);

  const selectedPaymentFallback = useMemo(() => {
    if (!form.payment_source) return null;
    if (activePaymentOptions.some((payment) => getPaymentSourceLabel(payment) === form.payment_source)) return null;
    return form.payment_source;
  }, [activePaymentOptions, form.payment_source]);

  const isRecurringForwardForm =
    form.source_type === 'recurring' && /^recurring:[^:]+:\d{4}-\d{2}$/.test(form.source_ref);

  const visibleSelectableRows = useMemo(
    () => rows.filter((row) => row.status === 'active'),
    [rows],
  );

  const selectedRows = useMemo(
    () => visibleSelectableRows.filter((row) => selectedRowIds.has(row.id)),
    [selectedRowIds, visibleSelectableRows],
  );

  const allVisibleSelected = visibleSelectableRows.length > 0 && visibleSelectableRows.every((row) => selectedRowIds.has(row.id));
  const someVisibleSelected = visibleSelectableRows.some((row) => selectedRowIds.has(row.id));

  const branchLookup = useMemo(() => {
    const lookup = new Map<string, { id: string; name: string }>();
    activeBranches.forEach((branch) => {
      lookup.set(normalizeLookupKey(branch.name), { id: branch.id, name: branch.name });
    });
    return lookup;
  }, [activeBranches]);

  const vendorLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    activeVendorOptions.forEach((vendor) => lookup.set(normalizeLookupKey(vendor.name), vendor.name));
    return lookup;
  }, [activeVendorOptions]);

  const paymentLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    activePaymentOptions.forEach((payment) => {
      const label = getPaymentSourceLabel(payment);
      if (label) lookup.set(normalizeLookupKey(label), label);
      if (payment.bankName) lookup.set(normalizeLookupKey(payment.bankName), label);
    });
    return lookup;
  }, [activePaymentOptions]);

  const categoryLookup = useMemo(() => {
    const lookup = new Map<string, OperationalExpenseCategory[]>();
    categories.forEach((item) => {
      const key = normalizeLookupKey(item.category);
      lookup.set(key, [...(lookup.get(key) || []), item]);
    });
    return lookup;
  }, [categories]);

  const bulkEditSubcategoryOptions = useMemo(() => {
    if (bulkEdit.category !== BULK_NO_CHANGE) {
      return Array.from(new Set(categories
        .filter((item) => item.category === bulkEdit.category)
        .map((item) => item.subcategory)
        .filter(Boolean)));
    }
    return subcategoryOptions;
  }, [bulkEdit.category, categories, subcategoryOptions]);

  const bulkInputEditSubcategoryOptions = useMemo(() => {
    if (bulkInputEdit.category !== BULK_NO_CHANGE) {
      return Array.from(new Set(categories
        .filter((item) => item.category === bulkInputEdit.category)
        .map((item) => item.subcategory)
        .filter(Boolean)));
    }
    return subcategoryOptions;
  }, [bulkInputEdit.category, categories, subcategoryOptions]);

  const isBulkInputRowBlank = (row: BulkInputDraftRow) => ![
    row.expense_date,
    row.category,
    row.subcategory,
    row.amount,
    row.vendor_name,
    row.payment_source,
    row.description,
    row.notes,
    row.source_ref,
  ].some((value) => String(value || '').trim()) && row.branch_id === 'all';

  const bulkInputPreview = useMemo<BulkInputPreviewRow[]>(() => {
    const filledRows = bulkInputRows
      .map((row, index) => ({ line: index + 1, row }))
      .filter((item) => !isBulkInputRowBlank(item.row));
    const sourceRefCounts = filledRows.reduce((acc, item) => {
      const key = normalizeLookupKey(item.row.source_ref);
      if (key) acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map<string, number>());

    return filledRows.map((item) => {
      const rawDate = item.row.expense_date;
      const rawCategory = item.row.category;
      const rawSubcategory = item.row.subcategory;
      const rawAmount = item.row.amount;
      const rawVendor = item.row.vendor_name;
      const rawPayment = item.row.payment_source;
      const sourceRefKey = normalizeLookupKey(item.row.source_ref);
      const errors: string[] = [];
      const expenseDate = parseBulkDate(rawDate);
      const categoryItems = categoryLookup.get(normalizeLookupKey(rawCategory)) || [];
      const category = categoryItems[0]?.category || rawCategory.trim();
      const subcategory = categoryItems.find((candidate) => normalizeLookupKey(candidate.subcategory) === normalizeLookupKey(rawSubcategory))?.subcategory || rawSubcategory.trim();
      const amount = parseBulkAmount(rawAmount);
      const branchId = item.row.branch_id === 'all' ? '' : item.row.branch_id;
      const hasInvalidImportedBranch = branchId.startsWith(BULK_INVALID_BRANCH_PREFIX);
      const branch = branchId
        ? activeBranches.find((candidate) => candidate.id === branchId)
        : null;
      const vendorName = rawVendor && rawVendor !== '-'
        ? vendorLookup.get(normalizeLookupKey(rawVendor))
        : '';
      const paymentSource = rawPayment && rawPayment !== '-'
        ? paymentLookup.get(normalizeLookupKey(rawPayment))
        : '';

      if (!expenseDate) errors.push('Tanggal tidak valid');
      if (!rawCategory.trim()) errors.push('Kategori wajib');
      if (!categoryItems.length) errors.push('Kategori tidak ada di master finance aktif');
      if (!rawSubcategory.trim()) errors.push('Sub kategori wajib');
      if (categoryItems.length && !categoryItems.some((candidate) => normalizeLookupKey(candidate.subcategory) === normalizeLookupKey(rawSubcategory))) {
        errors.push('Sub kategori tidak cocok dengan kategori');
      }
      if (!amount || amount <= 0) errors.push('Nominal wajib lebih dari 0');
      if (branchId && (!branch || hasInvalidImportedBranch)) errors.push('Cabang tidak aktif/tidak ditemukan');
      if (rawVendor && rawVendor !== '-' && !vendorName) errors.push('Vendor tidak aktif/tidak ditemukan');
      if (rawPayment && rawPayment !== '-' && !paymentSource) errors.push('Sumber pembayaran tidak aktif/tidak ditemukan');
      if (sourceRefKey && (sourceRefCounts.get(sourceRefKey) || 0) > 1) errors.push('Referensi duplikat di grid');

      return {
        errors,
        line: item.line,
        raw: [
          rawDate,
          rawCategory,
          rawSubcategory,
          rawAmount,
          branch?.name || '',
          rawVendor,
          rawPayment,
        ].filter(Boolean).join(' | '),
        rowId: item.row.id,
        payload: errors.length ? undefined : {
          expense_date: expenseDate,
          branch_id: branch?.id || '',
          category,
          subcategory,
          vendor_name: vendorName || '',
          description: item.row.description.trim(),
          amount,
          payment_source: paymentSource || '',
          source_type: 'import',
          source_ref: item.row.source_ref.trim(),
          notes: item.row.notes.trim(),
        },
      };
    });
  }, [activeBranches, bulkInputRows, categoryLookup, paymentLookup, vendorLookup]);

  const bulkInputValidRows = useMemo(
    () => bulkInputPreview.filter((item) => item.payload && item.errors.length === 0),
    [bulkInputPreview],
  );

  const bulkInputHasErrors = bulkInputPreview.some((item) => item.errors.length > 0);
  const bulkInputErrorCount = bulkInputPreview.filter((item) => item.errors.length > 0).length;
  const selectedBulkInputRows = useMemo(
    () => bulkInputRows.filter((row) => selectedBulkInputRowIds.has(row.id)),
    [bulkInputRows, selectedBulkInputRowIds],
  );
  const allBulkInputRowsSelected = bulkInputRows.length > 0 && bulkInputRows.every((row) => selectedBulkInputRowIds.has(row.id));
  const someBulkInputRowsSelected = bulkInputRows.some((row) => selectedBulkInputRowIds.has(row.id));

  const dashboardRowsTotal = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [rows],
  );

  const categoryBreakdown = useMemo(
    () => buildExpenseBreakdown(rows, (row) => row.category || 'Tanpa kategori', dashboardRowsTotal),
    [dashboardRowsTotal, rows],
  );

  const branchBreakdown = useMemo(
    () => buildExpenseBreakdown(rows, (row) => row.branch_name || 'Umum / tanpa cabang', dashboardRowsTotal, 4),
    [dashboardRowsTotal, rows],
  );

  const vendorBreakdown = useMemo(
    () => buildExpenseBreakdown(rows, (row) => row.vendor_name || 'Tanpa vendor', dashboardRowsTotal, 4),
    [dashboardRowsTotal, rows],
  );

  const dailyTrend = useMemo(() => {
    const grouped = rows.reduce((acc, row) => {
      const label = formatDate(row.expense_date);
      const current = acc.get(row.expense_date) || { dateKey: row.expense_date, label, amount: 0, count: 0 };
      current.amount += Number(row.amount) || 0;
      current.count += 1;
      acc.set(row.expense_date, current);
      return acc;
    }, new Map<string, { dateKey: string; label: string; amount: number; count: number }>());

    return Array.from(grouped.values())
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
      .slice(-7);
  }, [rows]);

  const recentRows = useMemo(
    () => [...rows]
      .sort((left, right) => right.expense_date.localeCompare(left.expense_date) || (right.created_at || '').localeCompare(left.created_at || ''))
      .slice(0, 5),
    [rows],
  );

  const highestExpense = useMemo(
    () => [...rows].sort((left, right) => (Number(right.amount) || 0) - (Number(left.amount) || 0))[0],
    [rows],
  );

  const trendMaxAmount = useMemo(
    () => Math.max(1, ...dailyTrend.map((item) => item.amount)),
    [dailyTrend],
  );

  const isDashboardPartiallyLoaded = Boolean(listMeta?.total && listMeta.total > rows.length);

  const buildParams = (includePaging = true) => {
    const params = new URLSearchParams();
    if (includePaging) {
      params.set('page', '1');
      params.set('limit', '200');
    }
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.branchId !== 'all') params.set('branch_id', filters.branchId);
    if (filters.category !== 'all') params.set('category', filters.category);
    if (filters.subcategory !== 'all') params.set('subcategory', filters.subcategory);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    return params;
  };

  const findExistingForwardedExpense = async (sourceRef: string) => {
    if (!sourceRef.trim()) return null;

    const params = new URLSearchParams({
      page: '1',
      limit: '20',
      q: sourceRef,
      status: 'active',
    });
    const result = await fetchJson<{ data: OperationalExpenseRow[] }>(`${OPERATIONAL_EXPENSES_URL}?${params.toString()}`);
    return (result.data || []).find((row) => row.source_ref === sourceRef) || null;
  };

  const saveOperationalExpensePayload = async (payload: OperationalExpensePayload, id?: string) => {
    return fetchJson(id ? `${OPERATIONAL_EXPENSES_URL}/${id}` : OPERATIONAL_EXPENSES_URL, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
  };

  const refreshData = async () => {
    if (!canView) return;
    setLoading(true);
    const [categoryResult, listResult, summaryResult] = await Promise.allSettled([
      fetchFinanceExpenseCategoryOptions(),
      fetchJson<OperationalExpenseListResponse>(`${OPERATIONAL_EXPENSES_URL}?${buildParams(true)}`),
      fetchJson<Summary>(`${OPERATIONAL_EXPENSES_URL}/summary?${buildParams(false)}`),
    ]);

    if (categoryResult.status === 'fulfilled') {
      setCategories(categoryResult.value);
    } else {
      setCategories(DEFAULT_OPERATIONAL_EXPENSE_ONLY_ACCOUNTS);
    }

    if (listResult.status === 'fulfilled') {
      setRows(listResult.value.data || []);
      setListMeta(listResult.value.meta || null);
    } else {
      setRows([]);
      setListMeta(null);
    }

    if (summaryResult.status === 'fulfilled') {
      const summaryPayload = summaryResult.value;
      setSummary({
        totalAmount: Number(summaryPayload.totalAmount) || 0,
        transactionCount: Number(summaryPayload.transactionCount) || 0,
        averageAmount: Number(summaryPayload.averageAmount) || 0,
        categoryCount: Number(summaryPayload.categoryCount) || 0,
        subcategoryCount: Number(summaryPayload.subcategoryCount) || 0,
      });
    } else {
      setSummary(EMPTY_SUMMARY);
    }

    const failed = [categoryResult, listResult, summaryResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) {
      const message = failed.reason instanceof Error ? failed.reason.message : 'Gagal memuat biaya operasional';
      setLoadError(message);
      if (message !== lastLoadErrorRef.current) {
        toast.error(message);
        lastLoadErrorRef.current = message;
      }
    } else {
      setLoadError(null);
      lastLoadErrorRef.current = '';
    }

    setLoading(false);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(filters.q), 350);
    return () => window.clearTimeout(timeoutId);
  }, [filters.q]);

  useEffect(() => {
    if (!selectionMode) {
      setSelectedRowIds(new Set());
    }
  }, [selectionMode]);

  useEffect(() => {
    if (!bulkInputSelectionMode) {
      setSelectedBulkInputRowIds(new Set());
    }
  }, [bulkInputSelectionMode]);

  useEffect(() => {
    setSelectedRowIds((prev) => {
      const visibleIds = new Set(visibleSelectableRows.map((row) => row.id));
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleSelectableRows]);

  useEffect(() => {
    setSelectedBulkInputRowIds((prev) => {
      const rowIds = new Set(bulkInputRows.map((row) => row.id));
      const next = new Set(Array.from(prev).filter((id) => rowIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [bulkInputRows]);

  useEffect(() => {
    refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, filters.startDate, filters.endDate, filters.branchId, filters.category, filters.subcategory, debouncedSearch]);

  useEffect(() => {
    if (forwardDraftAppliedRef.current || permissionsLoading || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const draftSource = params.get('draft');
    if (draftSource !== 'operational-report' && draftSource !== 'recurring-expense') return;

    forwardDraftAppliedRef.current = true;

    if (!canCreate) {
      toast.error('Akses tambah Biaya Operasional belum aktif untuk akun ini.');
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    const rawDraft = window.localStorage.getItem(OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY);
    if (!rawDraft) {
      toast.error('Draft Biaya Operasional tidak ditemukan.');
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    const applyForwardDraft = async () => {
      let hasReadableDraft = false;

      try {
        const draft = JSON.parse(rawDraft) as OperationalExpenseForwardDraft;
        const draftForm = buildFormFromForwardDraft(draft);
        hasReadableDraft = true;
        setForm(draftForm);

        if (draft.auto_save) {
          setSaving(true);
          const existingForward = draftForm.source_ref
            ? await findExistingForwardedExpense(draftForm.source_ref)
            : null;

          if (existingForward) {
            toast.info('Biaya Operasional dari transaksi ini sudah pernah dibuat.');
            setDialogOpen(false);
          } else {
            await saveOperationalExpensePayload(buildOperationalExpensePayloadFromForm(draftForm));
            toast.success(
              draft.source === 'recurring-expense'
                ? 'Biaya Operasional otomatis dibuat dari Pengeluaran Rutin.'
                : 'Biaya Operasional otomatis dibuat dari transaksi laporan.',
            );
            setDialogOpen(false);
          }

          await refreshData();
          window.localStorage.removeItem(OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY);
          return;
        }

        setDialogOpen(true);
        window.localStorage.removeItem(OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY);
        toast.success(
          draft.source === 'recurring-expense'
            ? 'Draft Biaya Operasional dari Pengeluaran Rutin siap dicek.'
            : 'Draft Biaya Operasional dari transaksi laporan siap dilengkapi.',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Draft Biaya Operasional tidak valid.';
        toast.error(`Forward otomatis gagal: ${message}`);
        setDialogOpen(hasReadableDraft);
        if (!hasReadableDraft) {
          window.localStorage.removeItem(OPERATIONAL_EXPENSE_FORWARD_DRAFT_KEY);
        }
      } finally {
        setSaving(false);
        window.history.replaceState(null, '', window.location.pathname);
      }
    };

    void applyForwardDraft();
  }, [canCreate, permissionsLoading]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, expense_date: today() });
    setDialogOpen(true);
  };

  const openEdit = (row: OperationalExpenseRow) => {
    setForm({
      id: row.id,
      expense_date: row.expense_date,
      branch_id: row.branch_id || 'all',
      category: row.category,
      subcategory: row.subcategory || '',
      vendor_name: row.vendor_name || '',
      description: row.description || '',
      amount: String(row.amount || ''),
      payment_source: row.payment_source || '',
      source_type: row.source_type || 'manual',
      source_ref: row.source_ref || '',
      notes: row.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.expense_date || !form.category || !form.subcategory || !form.amount || Number(form.amount) <= 0) {
      toast.error('Tanggal, kategori, sub kategori, dan nominal wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      await saveOperationalExpensePayload(buildOperationalExpensePayloadFromForm(form), form.id);

      toast.success(form.id ? 'Biaya operasional diperbarui.' : 'Biaya operasional ditambahkan.');
      setDialogOpen(false);
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal menyimpan biaya operasional';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!voidRow) return;

    setSaving(true);
    try {
      await fetchJson(`${OPERATIONAL_EXPENSES_URL}/${voidRow.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: voidReason }),
      });
      toast.success('Biaya operasional di-void.');
      setVoidRow(null);
      setVoidReason('');
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal void biaya operasional';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleRowSelection = (id: string, checked: boolean) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisibleRows = (checked: boolean) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      visibleSelectableRows.forEach((row) => {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      });
      return next;
    });
  };

  const toggleBulkInputRowSelection = (id: string, checked: boolean) => {
    setSelectedBulkInputRowIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllBulkInputRows = (checked: boolean) => {
    setSelectedBulkInputRowIds((prev) => {
      const next = new Set(prev);
      bulkInputRows.forEach((row) => {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      });
      return next;
    });
  };

  const resetBulkEdit = () => {
    setBulkEdit(EMPTY_BULK_EDIT);
  };

  const resetBulkInputEdit = () => {
    setBulkInputEdit(EMPTY_BULK_EDIT);
  };

  const hasBulkEditStateChanges = (source: BulkEditState) => (
    Boolean(source.expense_date)
    || source.branch_id !== BULK_NO_CHANGE
    || source.category !== BULK_NO_CHANGE
    || source.subcategory !== BULK_NO_CHANGE
    || source.vendor_name !== BULK_NO_CHANGE
    || source.payment_source !== BULK_NO_CHANGE
    || Boolean(source.amount)
    || Boolean(source.description.trim())
    || Boolean(source.source_ref.trim())
    || Boolean(source.notes.trim())
  );

  const buildBulkEditedPayload = (row: OperationalExpenseRow) => {
    const payload = buildOperationalExpensePayloadFromRow(row);
    if (bulkEdit.expense_date) payload.expense_date = bulkEdit.expense_date;
    if (bulkEdit.branch_id !== BULK_NO_CHANGE) payload.branch_id = bulkEdit.branch_id === BULK_CLEAR_VALUE ? '' : bulkEdit.branch_id;
    if (bulkEdit.category !== BULK_NO_CHANGE) payload.category = bulkEdit.category;
    if (bulkEdit.subcategory !== BULK_NO_CHANGE) payload.subcategory = bulkEdit.subcategory;
    if (bulkEdit.vendor_name !== BULK_NO_CHANGE) payload.vendor_name = bulkEdit.vendor_name === BULK_CLEAR_VALUE ? '' : bulkEdit.vendor_name;
    if (bulkEdit.payment_source !== BULK_NO_CHANGE) payload.payment_source = bulkEdit.payment_source === BULK_CLEAR_VALUE ? '' : bulkEdit.payment_source;
    if (bulkEdit.amount) payload.amount = Number(bulkEdit.amount);
    if (bulkEdit.description.trim()) payload.description = bulkEdit.description.trim();
    if (bulkEdit.source_ref.trim()) payload.source_ref = bulkEdit.source_ref.trim();
    if (bulkEdit.notes.trim()) payload.notes = bulkEdit.notes.trim();
    return payload;
  };

  const hasBulkEditChanges = () => hasBulkEditStateChanges(bulkEdit);

  const handleBulkEdit = async () => {
    if (bulkSavingRef.current) return;
    if (!selectedRows.length) {
      toast.error('Pilih minimal satu baris.');
      return;
    }
    if (!hasBulkEditChanges()) {
      toast.error('Isi minimal satu field untuk diubah.');
      return;
    }
    if (bulkEdit.category !== BULK_NO_CHANGE && bulkEdit.subcategory === BULK_NO_CHANGE) {
      toast.error('Jika kategori diubah, sub kategori juga wajib dipilih.');
      return;
    }
    if (bulkEdit.amount && Number(bulkEdit.amount) <= 0) {
      toast.error('Nominal massal harus lebih dari 0.');
      return;
    }

    bulkSavingRef.current = true;
    setBulkSaving(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (const row of selectedRows) {
        try {
          await saveOperationalExpensePayload(buildBulkEditedPayload(row), row.id);
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (successCount) toast.success(`${successCount} biaya operasional diperbarui.`);
      if (failedCount) toast.error(`${failedCount} data gagal diperbarui.`);
      setBulkEditOpen(false);
      resetBulkEdit();
      setSelectedRowIds(new Set());
      await refreshData();
    } finally {
      bulkSavingRef.current = false;
      setBulkSaving(false);
    }
  };

  const handleBulkInputEdit = () => {
    if (!selectedBulkInputRows.length) {
      toast.error('Pilih minimal satu baris bulk input.');
      return;
    }
    if (!hasBulkEditStateChanges(bulkInputEdit)) {
      toast.error('Isi minimal satu field untuk diubah.');
      return;
    }
    if (bulkInputEdit.category !== BULK_NO_CHANGE && bulkInputEdit.subcategory === BULK_NO_CHANGE) {
      toast.error('Jika kategori diubah, sub kategori juga wajib dipilih.');
      return;
    }
    if (bulkInputEdit.amount && Number(bulkInputEdit.amount) <= 0) {
      toast.error('Nominal massal harus lebih dari 0.');
      return;
    }

    setBulkInputRows((prev) => prev.map((row) => {
      if (!selectedBulkInputRowIds.has(row.id)) return row;

      const next: BulkInputDraftRow = { ...row };
      if (bulkInputEdit.expense_date) next.expense_date = bulkInputEdit.expense_date;
      if (bulkInputEdit.branch_id !== BULK_NO_CHANGE) next.branch_id = bulkInputEdit.branch_id === BULK_CLEAR_VALUE ? 'all' : bulkInputEdit.branch_id;
      if (bulkInputEdit.category !== BULK_NO_CHANGE) next.category = bulkInputEdit.category;
      if (bulkInputEdit.subcategory !== BULK_NO_CHANGE) next.subcategory = bulkInputEdit.subcategory;
      if (bulkInputEdit.vendor_name !== BULK_NO_CHANGE) next.vendor_name = bulkInputEdit.vendor_name === BULK_CLEAR_VALUE ? '' : bulkInputEdit.vendor_name;
      if (bulkInputEdit.payment_source !== BULK_NO_CHANGE) next.payment_source = bulkInputEdit.payment_source === BULK_CLEAR_VALUE ? '' : bulkInputEdit.payment_source;
      if (bulkInputEdit.amount) next.amount = bulkInputEdit.amount;
      if (bulkInputEdit.description.trim()) next.description = bulkInputEdit.description.trim();
      if (bulkInputEdit.source_ref.trim()) next.source_ref = bulkInputEdit.source_ref.trim();
      if (bulkInputEdit.notes.trim()) next.notes = bulkInputEdit.notes.trim();
      return next;
    }));

    toast.success(`${selectedBulkInputRows.length.toLocaleString('id-ID')} baris bulk input diperbarui.`);
    setBulkInputEditOpen(false);
    resetBulkInputEdit();
  };

  const handleBulkVoid = async () => {
    if (bulkSavingRef.current) return;
    if (!selectedRows.length) {
      toast.error('Pilih minimal satu baris.');
      return;
    }

    bulkSavingRef.current = true;
    setBulkSaving(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (const row of selectedRows) {
        try {
          await fetchJson(`${OPERATIONAL_EXPENSES_URL}/${row.id}`, {
            method: 'DELETE',
            body: JSON.stringify({ reason: bulkVoidReason || 'Void massal dari Biaya Operasional' }),
          });
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (successCount) toast.success(`${successCount} biaya operasional dihapus/void.`);
      if (failedCount) toast.error(`${failedCount} data gagal dihapus.`);
      setBulkVoidOpen(false);
      setBulkVoidReason('');
      setSelectedRowIds(new Set());
      await refreshData();
    } finally {
      bulkSavingRef.current = false;
      setBulkSaving(false);
    }
  };

  const handleBulkInputSave = async () => {
    if (bulkSavingRef.current) return;
    if (!bulkInputPreview.length) {
      toast.error('Isi minimal satu baris bulk input.');
      return;
    }
    if (bulkInputHasErrors) {
      toast.error('Perbaiki baris yang masih invalid sebelum simpan.');
      return;
    }

    bulkSavingRef.current = true;
    setBulkSaving(true);
    let successCount = 0;
    let failedCount = 0;
    let firstFailedReason = '';
    const failedRowIds = new Set<string>();
    try {
      for (const item of bulkInputValidRows) {
        if (!item.payload) continue;
        try {
          await saveOperationalExpensePayload(item.payload);
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          failedRowIds.add(item.rowId);
          if (!firstFailedReason) {
            firstFailedReason = error instanceof Error ? error.message : 'Server menolak data.';
          }
        }
      }

      if (successCount) toast.success(`${successCount} biaya operasional berhasil diinput.`);
      if (failedCount) toast.error(`${failedCount} data gagal disimpan.${firstFailedReason ? ` ${firstFailedReason}` : ''}`);
      if (successCount) await refreshData();
      if (!failedCount) {
        setBulkInputOpen(false);
        setBulkInputRows(createBulkInputDraftRows());
      } else {
        setBulkInputRows((prev) => prev.filter((row) => failedRowIds.has(row.id)));
      }
    } finally {
      bulkSavingRef.current = false;
      setBulkSaving(false);
    }
  };

  const updateBulkInputRow = (rowId: string, patch: Partial<BulkInputDraftRow>) => {
    setBulkInputRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const addBulkInputRows = (count = 1) => {
    setBulkInputRows((prev) => [...prev, ...createBulkInputDraftRows(count)]);
  };

  const removeBulkInputRow = (rowId: string) => {
    setBulkInputRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== rowId)));
  };

  const handleBulkGridWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!bulkInputBodyRef.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    event.stopPropagation();
    bulkInputBodyRef.current.scrollTop += event.deltaY;
  };

  const stringifyBulkImportCell = (value: unknown) => {
    if (value instanceof Date) return toDateKey(value);
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };

  const buildBulkInputDraftRowFromValues = (values: unknown[]): BulkInputDraftRow => {
    const [
      rawDate = '',
      rawCategory = '',
      rawSubcategory = '',
      rawAmount = '',
      rawBranch = '',
      rawVendor = '',
      rawPayment = '',
      rawDescription = '',
      rawNotes = '',
      rawReference = '',
    ] = values.map(stringifyBulkImportCell);
    const branch = rawBranch && !['-', 'umum', 'tanpa cabang'].includes(normalizeLookupKey(rawBranch))
      ? branchLookup.get(normalizeLookupKey(rawBranch))
      : null;
    const vendorName = rawVendor && rawVendor !== '-'
      ? vendorLookup.get(normalizeLookupKey(rawVendor)) || rawVendor
      : '';
    const paymentSource = rawPayment && rawPayment !== '-'
      ? paymentLookup.get(normalizeLookupKey(rawPayment)) || rawPayment
      : '';
    const categoryItems = categoryLookup.get(normalizeLookupKey(rawCategory)) || [];
    const category = categoryItems[0]?.category || rawCategory;
    const subcategory = categoryItems.find((candidate) => normalizeLookupKey(candidate.subcategory) === normalizeLookupKey(rawSubcategory))?.subcategory || rawSubcategory;

    return createBulkInputDraftRow({
      expense_date: parseBulkDate(rawDate),
      category: category.trim(),
      subcategory: subcategory.trim(),
      amount: parseBulkAmount(rawAmount) ? String(parseBulkAmount(rawAmount)) : '',
      branch_id: branch?.id || (rawBranch && !['-', 'umum', 'tanpa cabang'].includes(normalizeLookupKey(rawBranch)) ? `${BULK_INVALID_BRANCH_PREFIX}${rawBranch}` : 'all'),
      vendor_name: vendorName.trim(),
      payment_source: paymentSource.trim(),
      description: rawDescription.trim(),
      notes: rawNotes.trim(),
      source_ref: rawReference.trim(),
    });
  };

  const buildBulkInputDraftRowFromRecord = (record: Partial<Record<BulkImportField, unknown>>): BulkInputDraftRow => {
    return buildBulkInputDraftRowFromValues([
      record.expense_date,
      record.category,
      record.subcategory,
      record.amount,
      record.branch_id,
      record.vendor_name,
      record.payment_source,
      record.description,
      record.notes,
      record.source_ref,
    ]);
  };

  const buildBulkInputRowsFromMatrix = (matrix: unknown[][]) => {
    const normalizedRows = matrix
      .map((row) => row.map(stringifyBulkImportCell))
      .filter((row) => row.some((cell) => cell.trim()));

    if (!normalizedRows.length) return [];

    const headerFields = normalizedRows[0].map((header) => BULK_IMPORT_FIELD_BY_HEADER.get(normalizeBulkImportHeader(header)));
    const hasHeader = headerFields.filter(Boolean).length >= 2;

    if (!hasHeader) {
      return normalizedRows.map((row) => buildBulkInputDraftRowFromValues(row));
    }

    return normalizedRows.slice(1).map((row) => {
      const record: Partial<Record<BulkImportField, unknown>> = {};
      headerFields.forEach((field, index) => {
        if (field) record[field] = row[index] || '';
      });
      return buildBulkInputDraftRowFromRecord(record);
    });
  };

  const downloadBulkInputTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet(BULK_INPUT_TEMPLATE_ROWS);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bulk Input');
    XLSX.writeFile(workbook, `template-biaya-operasional-${today()}.xlsx`);
  };

  const handleBulkInputFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'txt', 'tsv', 'xlsx', 'xls'].includes(extension || '')) {
      toast.error('Saat ini bulk input mendukung file Excel, CSV, TSV, atau TXT.');
      return;
    }

    try {
      let importedRows: BulkInputDraftRow[] = [];

      if (['xlsx', 'xls'].includes(extension || '')) {
        validateSpreadsheetUploadFile(file, { label: 'File Excel biaya operasional' });
        const workbook = XLSX.read(await file.arrayBuffer(), {
          type: 'array',
          cellDates: true,
          sheetRows: getSpreadsheetReadRowLimit(),
        });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true }) : [];
        assertSpreadsheetRowLimit(rows, { label: 'Import biaya operasional' });
        importedRows = buildBulkInputRowsFromMatrix(rows);
      } else {
        const parsed = Papa.parse<string[]>(await file.text(), {
          delimitersToGuess: [',', '\t', '|', ';'],
          skipEmptyLines: 'greedy',
        });
        if (parsed.errors.length) {
          throw new Error(parsed.errors[0]?.message || 'File tidak bisa dibaca.');
        }
        importedRows = buildBulkInputRowsFromMatrix(parsed.data);
      }

      setBulkInputRows(importedRows.length ? importedRows : createBulkInputDraftRows());
      requestAnimationFrame(() => {
        if (bulkInputBodyRef.current) bulkInputBodyRef.current.scrollTop = 0;
      });

      if (!importedRows.length) {
        toast.warning('Tidak ada data yang bisa dibaca. Pastikan file memakai template bulk input.');
        return;
      }

      toast.success(`${importedRows.length.toLocaleString('id-ID')} baris dimuat ke validator bulk input.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal membaca file import.';
      toast.error(message);
    }
  };

  if (!canView) {
    return (
      <OperationalPageShell>
        <OperationalEmptyState
          icon={Lock}
          title="Akses Dibatasi"
          description="Anda tidak memiliki izin untuk membuka Biaya Operasional."
          className="min-h-[70vh]"
        />
      </OperationalPageShell>
    );
  }

  return (
    <OperationalPageShell className="pb-20">
      <OperationalPageHeader
        eyebrow="Keuangan"
        icon={WalletCards}
        title="Biaya Operasional"
        subtitle={filters.startDate || filters.endDate ? `Periode ${formatDate(filters.startDate)} sampai ${formatDate(filters.endDate)}` : 'Semua periode biaya operasional'}
        onRefresh={refreshData}
        isRefreshing={loading}
        actions={
          <>
            <Button variant="outline" onClick={() => setBulkInputOpen(true)} disabled={!canCreate}>
              <Upload className="h-4 w-4" />
              Bulk Input
            </Button>
            <Button onClick={openCreate} disabled={!canCreate}>
              <Plus className="h-4 w-4" />
              Tambah Biaya
            </Button>
          </>
        }
      />

      {loadError && (
        <div className="surfacePanel flex gap-3 border-amber-200 bg-amber-50 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Data belum bisa dimuat dari server.</div>
            <div className="mt-0.5 text-amber-700 dark:text-amber-300">{loadError}</div>
          </div>
        </div>
      )}

      <Tabs value={activeView} onValueChange={setActiveView} className="kasTabsShell">
        <TabsViewport>
          <TabsRail className="masterDataTabs kasTabs min-w-max">
            <TabsTrigger value="dashboard" className="masterDataTab kasTab">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="data" className="masterDataTab kasTab">
              <ListChecks className="h-4 w-4" />
              Data Biaya
            </TabsTrigger>
          </TabsRail>
        </TabsViewport>

        <OperationalFilterPanel className="kasFilterPanel">
          <div className="responsiveFilterGrid kasFilterGrid">
            <PeriodFilterPicker date={filterDateRange} setDate={handleFilterDateRangeChange} />
            <Select value={filters.branchId} onValueChange={(value) => setFilters((prev) => ({ ...prev, branchId: value }))}>
              <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Semua Cabang" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Cabang</SelectItem>
                {activeBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.category} onValueChange={(value) => setFilters((prev) => ({ ...prev, category: value, subcategory: 'all' }))}>
              <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Semua Kategori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.subcategory} onValueChange={(value) => setFilters((prev) => ({ ...prev, subcategory: value }))}>
              <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Semua Sub Kategori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Sub Kategori</SelectItem>
                {subcategoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="kasFilterSearch">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="uiInput pl-9" placeholder="Cari biaya, vendor, atau catatan..." value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} />
              </div>
            </div>
          </div>
        </OperationalFilterPanel>

        <TabsContent value="dashboard" className="kasTabContent">
          <OperationalKpiGrid>
            <OperationalKpiCard label="Total Biaya" value={formatCurrency(summary.totalAmount)} icon={ReceiptText} tone="rose" />
            <OperationalKpiCard label="Transaksi" value={summary.transactionCount.toLocaleString('id-ID')} icon={ClipboardList} tone="blue" />
            <OperationalKpiCard label="Rata-rata" value={formatCurrency(summary.averageAmount)} icon={BarChart3} tone="emerald" />
            <OperationalKpiCard label="Kategori" value={summary.categoryCount.toLocaleString('id-ID')} icon={Building2} tone="violet" />
          </OperationalKpiGrid>

          {isDashboardPartiallyLoaded && (
            <div className="kasDashboardNotice">
              Dashboard menganalisis {rows.length.toLocaleString('id-ID')} transaksi terbaru dari {listMeta?.total.toLocaleString('id-ID')} data pada filter aktif. Summary total tetap mengikuti seluruh periode.
            </div>
          )}

          {loading ? (
            <div className="kasDashboardLoading">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : rows.length === 0 ? (
            <OperationalTableCard>
              <OperationalEmptyState
                icon={ReceiptText}
                title="Belum ada data dashboard"
                description="Dashboard akan muncul setelah ada biaya operasional pada filter yang dipilih."
              />
            </OperationalTableCard>
          ) : (
            <div className="kasDashboardGrid">
              <section className="kasDashboardPanel kasDashboardPanelWide">
                <div className="kasDashboardPanelHeader">
                  <div>
                    <h3>Distribusi Kategori</h3>
                    <p>Komposisi biaya terbesar pada periode aktif.</p>
                  </div>
                  <span>{categoryBreakdown.length} kategori</span>
                </div>
                <div className="kasBreakdownList">
                  {categoryBreakdown.map((item) => (
                    <div key={item.label} className="kasBreakdownItem">
                      <div className="kasBreakdownMeta">
                        <span>{item.label}</span>
                        <small>{item.count} transaksi</small>
                      </div>
                      <div className="kasBreakdownValue">
                        <span>{formatCurrency(item.amount)}</span>
                        <small>{item.percent}%</small>
                      </div>
                      <div className="kasBreakdownTrack">
                        <div style={{ width: `${Math.max(6, item.percent)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="kasDashboardPanel">
                <div className="kasDashboardPanelHeader">
                  <div>
                    <h3>Tren Terakhir</h3>
                    <p>Akumulasi per tanggal.</p>
                  </div>
                </div>
                <div className="kasMiniTrend">
                  {dailyTrend.map((item) => (
                    <div key={item.dateKey} className="kasMiniTrendItem">
                      <div className="kasMiniTrendBar" style={{ height: `${Math.max(12, (item.amount / trendMaxAmount) * 100)}%` }} />
                      <span>{item.label.replace(/ 2026$/, '')}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="kasDashboardPanel">
                <div className="kasDashboardPanelHeader">
                  <div>
                    <h3>Cabang</h3>
                    <p>Biaya terbesar per cabang.</p>
                  </div>
                </div>
                <div className="kasCompactList">
                  {branchBreakdown.map((item) => (
                    <div key={item.label} className="kasCompactRow">
                      <span>{item.label}</span>
                      <strong>{formatCurrency(item.amount)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="kasDashboardPanel">
                <div className="kasDashboardPanelHeader">
                  <div>
                    <h3>Vendor</h3>
                    <p>Penerima biaya terbesar.</p>
                  </div>
                </div>
                <div className="kasCompactList">
                  {vendorBreakdown.map((item) => (
                    <div key={item.label} className="kasCompactRow">
                      <span>{item.label}</span>
                      <strong>{formatCurrency(item.amount)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="kasDashboardPanel">
                <div className="kasDashboardPanelHeader">
                  <div>
                    <h3>Biaya Terbesar</h3>
                    <p>Transaksi paling dominan.</p>
                  </div>
                </div>
                {highestExpense ? (
                  <div className="kasHighlightExpense">
                    <strong>{formatCurrency(highestExpense.amount)}</strong>
                    <span>{highestExpense.category}</span>
                    <small>{highestExpense.subcategory || '-'} · {formatDate(highestExpense.expense_date)}</small>
                  </div>
                ) : null}
              </section>

              <section className="kasDashboardPanel kasDashboardPanelWide">
                <div className="kasDashboardPanelHeader">
                  <div>
                    <h3>Transaksi Terbaru</h3>
                    <p>Aktivitas biaya terakhir dari filter aktif.</p>
                  </div>
                </div>
                <div className="kasRecentList">
                  {recentRows.map((row) => (
                    <button type="button" key={row.id} className="kasRecentRow" onClick={() => setDetailRow(row)}>
                      <span>
                        <strong>{row.category}</strong>
                        <small>{row.subcategory || '-'} · {formatDate(row.expense_date)}</small>
                      </span>
                      <em>{formatCurrency(row.amount)}</em>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="data" className="kasTabContent">
          <OperationalTableCard>
            <div className={`kasBulkToolbar ${selectionMode ? 'isActive' : ''}`}>
              <div>
                <strong>{selectionMode ? `${selectedRows.length.toLocaleString('id-ID')} dipilih` : 'Pilih massal'}</strong>
                <span>
                  {selectionMode
                    ? `${visibleSelectableRows.length.toLocaleString('id-ID')} data aktif di halaman ini`
                    : 'Aktifkan checkbox untuk edit atau hapus beberapa baris.'}
                </span>
              </div>
              <div className="kasBulkToolbarActions">
                {selectionMode && (
                  <>
                  <Button variant="outline" size="sm" onClick={() => toggleAllVisibleRows(!allVisibleSelected)} disabled={!visibleSelectableRows.length}>
                    {allVisibleSelected ? 'Batal pilih semua' : 'Pilih semua'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedRowIds(new Set())} disabled={!selectedRows.length}>
                    Bersihkan
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(true)} disabled={!canEdit || !selectedRows.length}>
                    <Edit className="h-4 w-4" />
                    Edit Massal
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setBulkVoidOpen(true)} disabled={!canDelete || !selectedRows.length}>
                    <Trash2 className="h-4 w-4" />
                    Hapus Massal
                  </Button>
                  </>
                )}
                <label className="kasBulkSwitch">
                  <Switch checked={selectionMode} onCheckedChange={setSelectionMode} />
                  <span>{selectionMode ? 'Mode pilih aktif' : 'Pilih baris'}</span>
                </label>
              </div>
            </div>
            <DataTable
              className="kasExpenseDataTable"
              columns={createDataTableColumns([
                selectionMode && 'checkbox',
                'number',
                'date',
                'name',
                'text',
                'description',
                'text',
                'money',
                'action',
              ])}
              rowMinHeight={72}
              cellX={18}
              cellY={14}
              textMax="100%"
              actionWidth={76}
            >
            <table>
              <TableHeader>
                <TableRow>
                  {selectionMode && (
                    <TableHead className="kasExpenseSelectCell text-center">
                      <Checkbox
                        checked={allVisibleSelected || (someVisibleSelected ? 'indeterminate' : false)}
                        onCheckedChange={(checked) => toggleAllVisibleRows(Boolean(checked))}
                        aria-label="Pilih semua baris"
                      />
                    </TableHead>
                  )}
                  <TableHead className="text-center">No</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Cabang</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="kasExpenseAmountHeader text-right">Nominal</TableHead>
                  <TableActionHeader />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={selectionMode ? 9 : 8} className="h-32 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={selectionMode ? 9 : 8}>
                      <OperationalEmptyState
                        icon={loadError ? AlertCircle : ReceiptText}
                        title={loadError ? 'Server belum siap' : 'Belum ada biaya operasional'}
                        description={loadError ? 'Setelah migration dan function terbaru aktif, data akan tampil di sini.' : 'Tidak ada data pada filter yang sedang dipilih.'}
                      />
                    </TableCell>
                  </TableRow>
                ) : rows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    className="kasExpenseClickableRow"
                    tabIndex={0}
                    onClick={() => setDetailRow(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDetailRow(row);
                      }
                    }}
                  >
                    {selectionMode && (
                      <TableCell
                        className="kasExpenseSelectCell text-center"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedRowIds.has(row.id)}
                          onCheckedChange={(checked) => toggleRowSelection(row.id, Boolean(checked))}
                          aria-label={`Pilih ${row.description || row.category}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="monoCell text-center">{index + 1}</TableCell>
                    <TableCell>
                      <TableText primary={formatDate(row.expense_date)} />
                    </TableCell>
                    <TableCell>
                      <TableText
                        primary={row.category}
                        secondary={row.subcategory || '-'}
                        title={`${row.category} - ${row.subcategory || '-'}`}
                      />
                    </TableCell>
                    <TableCell>
                      <TableText primary={row.branch_name || '-'} />
                    </TableCell>
                    <TableCell>
                      <TableText
                        primary={row.description || '-'}
                        secondary={row.source_type === 'recurring' ? 'Dari Pengeluaran Rutin' : row.source_ref ? `Ref ${row.source_ref}` : undefined}
                        title={row.description || undefined}
                      />
                    </TableCell>
                    <TableCell>
                      <TableText
                        primary={row.vendor_name || '-'}
                        secondary={row.payment_source || undefined}
                        title={[row.vendor_name, row.payment_source].filter(Boolean).join(' - ')}
                      />
                    </TableCell>
                    <TableCell className="kasExpenseAmountCell text-right">{formatCurrency(row.amount)}</TableCell>
                    <TableActionCell onClick={(event) => event.stopPropagation()}>
                      <TableActionMenu>
                        <TableActionMenuItem icon={Eye} onSelect={() => setDetailRow(row)}>
                          Detail
                        </TableActionMenuItem>
                        <TableActionMenuItem icon={Edit} onSelect={() => openEdit(row)} disabled={!canEdit}>
                          Edit
                        </TableActionMenuItem>
                        <TableActionMenuItem icon={Trash2} danger onSelect={() => setVoidRow(row)} disabled={!canDelete}>
                          Hapus
                        </TableActionMenuItem>
                      </TableActionMenu>
                    </TableActionCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
            </DataTable>
          </OperationalTableCard>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <MasterDataFormDialogContent size="wide" className="kasExpenseFormDialog kasModuleFormDialog">
          <MasterDataFormHeader
            icon={ReceiptText}
            title={form.id ? 'Edit Biaya Operasional' : 'Tambah Biaya Operasional'}
            description="Isi kategori dan subkategori dengan rapi supaya laporan mudah dibaca."
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleSave();
            }}
          >
          <MasterDataDialogBody>
          <MasterDataFormGrid>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel required>Tanggal</MasterDataFieldLabel>
              <Input className="uiInput" type="date" value={form.expense_date} onChange={(event) => setForm((prev) => ({ ...prev, expense_date: event.target.value }))} />
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel required>Kategori</MasterDataFieldLabel>
              <Select value={form.category} onValueChange={(value) => setForm((prev) => ({ ...prev, category: value, subcategory: '' }))}>
                <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel required>Sub Kategori</MasterDataFieldLabel>
              <Select value={form.subcategory} onValueChange={(value) => setForm((prev) => ({ ...prev, subcategory: value }))} disabled={!form.category}>
                <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder={form.category ? 'Pilih sub kategori' : 'Pilih kategori dulu'} /></SelectTrigger>
                <SelectContent>
                  {formSubcategoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel optional>Cabang</MasterDataFieldLabel>
              <Select value={form.branch_id} onValueChange={(value) => setForm((prev) => ({ ...prev, branch_id: value }))}>
                <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Umum / tanpa cabang" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Umum / tanpa cabang</SelectItem>
                  {selectedBranchFallback ? <SelectItem value={selectedBranchFallback.id}>{selectedBranchFallback.label}</SelectItem> : null}
                  {activeBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel optional>Vendor / Penerima</MasterDataFieldLabel>
              <Select
                value={form.vendor_name || OPTIONAL_SELECT_NONE}
                onValueChange={(value) => setForm((prev) => ({ ...prev, vendor_name: value === OPTIONAL_SELECT_NONE ? '' : value }))}
              >
                <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Pilih vendor / penerima" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={OPTIONAL_SELECT_NONE}>Tanpa vendor</SelectItem>
                  {selectedVendorFallback ? <SelectItem value={selectedVendorFallback}>{selectedVendorFallback} (tersimpan)</SelectItem> : null}
                  {activeVendorOptions.map((vendor) => <SelectItem key={vendor.id} value={vendor.name}>{vendor.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel optional>Sumber Pembayaran</MasterDataFieldLabel>
              <Select
                value={form.payment_source || OPTIONAL_SELECT_NONE}
                onValueChange={(value) => setForm((prev) => ({ ...prev, payment_source: value === OPTIONAL_SELECT_NONE ? '' : value }))}
              >
                <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Pilih bank / sumber dana" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={OPTIONAL_SELECT_NONE}>Tanpa sumber pembayaran</SelectItem>
                  {selectedPaymentFallback ? <SelectItem value={selectedPaymentFallback}>{selectedPaymentFallback} (tersimpan)</SelectItem> : null}
                  {activePaymentOptions.map((payment) => {
                    const label = getPaymentSourceLabel(payment);
                    return <SelectItem key={payment.id} value={label}>{label}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel required>Nominal</MasterDataFieldLabel>
              <MasterDataCurrencyInput value={form.amount} onValueChange={(amount) => setForm((prev) => ({ ...prev, amount }))} />
            </MasterDataFormField>
            <MasterDataFormField span="half">
              <MasterDataFieldLabel optional>Referensi</MasterDataFieldLabel>
              {isRecurringForwardForm ? (
                <div className="kasLockedSourceRef">
                  <span>Pengeluaran Rutin</span>
                  <strong>{form.source_ref}</strong>
                </div>
              ) : (
                <Input className="uiInput" placeholder="No bukti / invoice" value={form.source_ref} onChange={(event) => setForm((prev) => ({ ...prev, source_ref: event.target.value }))} />
              )}
            </MasterDataFormField>
            <MasterDataFormField span="full">
              <MasterDataFieldLabel optional>Keterangan</MasterDataFieldLabel>
              <Input className="uiInput" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </MasterDataFormField>
            <MasterDataFormField span="full">
              <MasterDataFieldLabel optional>Catatan</MasterDataFieldLabel>
              <Textarea className="min-h-[96px]" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </MasterDataFormField>
          </MasterDataFormGrid>
          </MasterDataDialogBody>
          <MasterDataFormActions
            isSubmitting={saving}
            onCancel={() => setDialogOpen(false)}
            saveLabel={form.id ? 'Simpan Perubahan' : 'Simpan Biaya'}
            submitDisabled={form.id ? !canEdit : !canCreate}
          />
          </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={(open) => {
        setBulkEditOpen(open);
        if (!open) resetBulkEdit();
      }}>
        <MasterDataFormDialogContent size="wide" className="kasModuleFormDialog">
          <MasterDataFormHeader
            icon={Edit}
            title="Edit Massal Biaya Operasional"
            description={`${selectedRows.length.toLocaleString('id-ID')} data terpilih. Field yang dibiarkan "Tidak diubah" akan tetap memakai nilai lama.`}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleBulkEdit();
            }}
          >
            <MasterDataDialogBody>
              <MasterDataFormGrid>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Tanggal</MasterDataFieldLabel>
                  <BulkDatePicker
                    value={bulkEdit.expense_date}
                    onValueChange={(expense_date) => setBulkEdit((prev) => ({ ...prev, expense_date }))}
                    placeholder="Tidak diubah"
                    allowClear
                  />
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Nominal</MasterDataFieldLabel>
                  <MasterDataCurrencyInput value={bulkEdit.amount} onValueChange={(amount) => setBulkEdit((prev) => ({ ...prev, amount }))} placeholder="Tidak diubah" />
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Kategori</MasterDataFieldLabel>
                  <Select value={bulkEdit.category} onValueChange={(value) => setBulkEdit((prev) => ({ ...prev, category: value, subcategory: BULK_NO_CHANGE }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      {categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Sub Kategori</MasterDataFieldLabel>
                  <Select value={bulkEdit.subcategory} onValueChange={(value) => setBulkEdit((prev) => ({ ...prev, subcategory: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      {bulkEditSubcategoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Cabang</MasterDataFieldLabel>
                  <Select value={bulkEdit.branch_id} onValueChange={(value) => setBulkEdit((prev) => ({ ...prev, branch_id: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      <SelectItem value={BULK_CLEAR_VALUE}>Umum / tanpa cabang</SelectItem>
                      {activeBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Vendor / Penerima</MasterDataFieldLabel>
                  <Select value={bulkEdit.vendor_name} onValueChange={(value) => setBulkEdit((prev) => ({ ...prev, vendor_name: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      <SelectItem value={BULK_CLEAR_VALUE}>Kosongkan vendor</SelectItem>
                      {activeVendorOptions.map((vendor) => <SelectItem key={vendor.id} value={vendor.name}>{vendor.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Sumber Pembayaran</MasterDataFieldLabel>
                  <Select value={bulkEdit.payment_source} onValueChange={(value) => setBulkEdit((prev) => ({ ...prev, payment_source: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      <SelectItem value={BULK_CLEAR_VALUE}>Kosongkan sumber pembayaran</SelectItem>
                      {activePaymentOptions.map((payment) => {
                        const label = getPaymentSourceLabel(payment);
                        return <SelectItem key={payment.id} value={label}>{label}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Referensi</MasterDataFieldLabel>
                  <Input className="uiInput" placeholder="Tidak diubah" value={bulkEdit.source_ref} onChange={(event) => setBulkEdit((prev) => ({ ...prev, source_ref: event.target.value }))} />
                </MasterDataFormField>
                <MasterDataFormField span="full">
                  <MasterDataFieldLabel optional>Keterangan</MasterDataFieldLabel>
                  <Input className="uiInput" placeholder="Tidak diubah" value={bulkEdit.description} onChange={(event) => setBulkEdit((prev) => ({ ...prev, description: event.target.value }))} />
                </MasterDataFormField>
                <MasterDataFormField span="full">
                  <MasterDataFieldLabel optional>Catatan</MasterDataFieldLabel>
                  <Textarea className="min-h-[96px]" placeholder="Tidak diubah" value={bulkEdit.notes} onChange={(event) => setBulkEdit((prev) => ({ ...prev, notes: event.target.value }))} />
                </MasterDataFormField>
              </MasterDataFormGrid>
            </MasterDataDialogBody>
            <MasterDataFormActions
              isSubmitting={bulkSaving}
              onCancel={() => setBulkEditOpen(false)}
              saveLabel="Simpan Massal"
              submitDisabled={!canEdit || !selectedRows.length}
            />
          </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={bulkInputEditOpen} onOpenChange={(open) => {
        setBulkInputEditOpen(open);
        if (!open) resetBulkInputEdit();
      }}>
        <MasterDataFormDialogContent size="wide" className="kasModuleFormDialog">
          <MasterDataFormHeader
            icon={Edit}
            title="Edit Massal Grid Bulk Input"
            description={`${selectedBulkInputRows.length.toLocaleString('id-ID')} baris validator terpilih. Perubahan diterapkan ke grid dulu sebelum disimpan.`}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleBulkInputEdit();
            }}
          >
            <MasterDataDialogBody>
              <MasterDataFormGrid>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Tanggal</MasterDataFieldLabel>
                  <BulkDatePicker
                    value={bulkInputEdit.expense_date}
                    onValueChange={(expense_date) => setBulkInputEdit((prev) => ({ ...prev, expense_date }))}
                    placeholder="Tidak diubah"
                    allowClear
                  />
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Nominal</MasterDataFieldLabel>
                  <MasterDataCurrencyInput value={bulkInputEdit.amount} onValueChange={(amount) => setBulkInputEdit((prev) => ({ ...prev, amount }))} placeholder="Tidak diubah" />
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Kategori</MasterDataFieldLabel>
                  <Select value={bulkInputEdit.category} onValueChange={(value) => setBulkInputEdit((prev) => ({ ...prev, category: value, subcategory: BULK_NO_CHANGE }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      {categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Sub Kategori</MasterDataFieldLabel>
                  <Select value={bulkInputEdit.subcategory} onValueChange={(value) => setBulkInputEdit((prev) => ({ ...prev, subcategory: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      {bulkInputEditSubcategoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Cabang</MasterDataFieldLabel>
                  <Select value={bulkInputEdit.branch_id} onValueChange={(value) => setBulkInputEdit((prev) => ({ ...prev, branch_id: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      <SelectItem value={BULK_CLEAR_VALUE}>Umum / tanpa cabang</SelectItem>
                      {activeBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Vendor / Penerima</MasterDataFieldLabel>
                  <Select value={bulkInputEdit.vendor_name} onValueChange={(value) => setBulkInputEdit((prev) => ({ ...prev, vendor_name: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      <SelectItem value={BULK_CLEAR_VALUE}>Kosongkan vendor</SelectItem>
                      {activeVendorOptions.map((vendor) => <SelectItem key={vendor.id} value={vendor.name}>{vendor.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Sumber Pembayaran</MasterDataFieldLabel>
                  <Select value={bulkInputEdit.payment_source} onValueChange={(value) => setBulkInputEdit((prev) => ({ ...prev, payment_source: value }))}>
                    <SelectTrigger className="uiSelectTrigger"><SelectValue placeholder="Tidak diubah" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BULK_NO_CHANGE}>Tidak diubah</SelectItem>
                      <SelectItem value={BULK_CLEAR_VALUE}>Kosongkan sumber pembayaran</SelectItem>
                      {activePaymentOptions.map((payment) => {
                        const label = getPaymentSourceLabel(payment);
                        return <SelectItem key={payment.id} value={label}>{label}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>
                <MasterDataFormField span="half">
                  <MasterDataFieldLabel optional>Referensi</MasterDataFieldLabel>
                  <Input className="uiInput" placeholder="Tidak diubah" value={bulkInputEdit.source_ref} onChange={(event) => setBulkInputEdit((prev) => ({ ...prev, source_ref: event.target.value }))} />
                </MasterDataFormField>
                <MasterDataFormField span="full">
                  <MasterDataFieldLabel optional>Keterangan</MasterDataFieldLabel>
                  <Input className="uiInput" placeholder="Tidak diubah" value={bulkInputEdit.description} onChange={(event) => setBulkInputEdit((prev) => ({ ...prev, description: event.target.value }))} />
                </MasterDataFormField>
                <MasterDataFormField span="full">
                  <MasterDataFieldLabel optional>Catatan</MasterDataFieldLabel>
                  <Textarea className="min-h-[96px]" placeholder="Tidak diubah" value={bulkInputEdit.notes} onChange={(event) => setBulkInputEdit((prev) => ({ ...prev, notes: event.target.value }))} />
                </MasterDataFormField>
              </MasterDataFormGrid>
            </MasterDataDialogBody>
            <MasterDataFormActions
              isSubmitting={false}
              onCancel={() => setBulkInputEditOpen(false)}
              saveLabel="Terapkan ke Grid"
              submitDisabled={!selectedBulkInputRows.length}
            />
          </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={bulkInputOpen} onOpenChange={(open) => {
        setBulkInputOpen(open);
        if (open) {
          requestAnimationFrame(() => {
            if (bulkInputBodyRef.current) bulkInputBodyRef.current.scrollTop = 0;
          });
        } else {
          setBulkInputRows(createBulkInputDraftRows());
          setBulkInputSelectionMode(false);
          setSelectedBulkInputRowIds(new Set());
          setBulkInputEditOpen(false);
          resetBulkInputEdit();
        }
      }}>
        <MasterDataFormDialogContent size="wide" className="kasBulkInputDialog">
          <MasterDataFormHeader
            icon={ClipboardCheck}
            title="Bulk Input Biaya Operasional"
            description="Input banyak biaya sekaligus langsung di grid, lalu simpan semua baris valid dalam satu proses."
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleBulkInputSave();
            }}
          >
          <MasterDataDialogBody ref={bulkInputBodyRef} className="kasBulkInputBody">
            <section className="kasBulkInputDropPanel">
              <div>
                <strong>Input Massal</strong>
                <span>{bulkInputRows.length.toLocaleString('id-ID')} baris siap diisi. File Excel/CSV/TSV/TXT tetap bisa diimpor ke grid ini.</span>
              </div>
              <div className="kasBulkInputDropActions">
                <Button type="button" variant="outline" onClick={() => addBulkInputRows(10)}>
                  <Plus className="h-4 w-4" />
                  Tambah 10 Baris
                </Button>
                <Button type="button" variant="outline" onClick={downloadBulkInputTemplate}>
                  <Download className="h-4 w-4" />
                  Template
                </Button>
                <Button type="button" onClick={() => bulkFileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  Pilih File
                </Button>
                <input
                  ref={bulkFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/tab-separated-values,text/plain"
                  className="hidden"
                  onChange={handleBulkInputFile}
                />
              </div>
            </section>

            <div className={`kasBulkInputSelectToolbar ${bulkInputSelectionMode ? 'isActive' : ''}`}>
              <div>
                <strong>{bulkInputSelectionMode ? `${selectedBulkInputRows.length.toLocaleString('id-ID')} baris dipilih` : 'Edit massal grid'}</strong>
                <span>
                  {bulkInputSelectionMode
                    ? `${bulkInputRows.length.toLocaleString('id-ID')} baris tersedia di validator`
                    : 'Aktifkan checkbox untuk ubah beberapa baris bulk sekaligus.'}
                </span>
              </div>
              <div className="kasBulkToolbarActions">
                {bulkInputSelectionMode && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => toggleAllBulkInputRows(!allBulkInputRowsSelected)} disabled={!bulkInputRows.length}>
                      {allBulkInputRowsSelected ? 'Batal pilih semua' : 'Pilih semua'}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedBulkInputRowIds(new Set())} disabled={!selectedBulkInputRows.length}>
                      Bersihkan
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setBulkInputEditOpen(true)} disabled={!selectedBulkInputRows.length}>
                      <Edit className="h-4 w-4" />
                      Edit Massal
                    </Button>
                  </>
                )}
                <label className="kasBulkSwitch">
                  <Switch checked={bulkInputSelectionMode} onCheckedChange={setBulkInputSelectionMode} />
                  <span>{bulkInputSelectionMode ? 'Checkbox aktif' : 'Tampilkan checkbox'}</span>
                </label>
              </div>
            </div>

            <section className="kasBulkGridPanel">
              <div className="kasBulkGridPanelHeader">
                <div>
                  <strong>Grid Biaya Operasional</strong>
                  <span>Semua cell bisa diedit langsung. Kolom wajib: tanggal, kategori, sub kategori, nominal.</span>
                </div>
                <p className="kasBulkGridMetaText">
                  {bulkInputPreview.length.toLocaleString('id-ID')} terisi
                  <span aria-hidden="true">•</span>
                  <strong>{bulkInputValidRows.length.toLocaleString('id-ID')} valid</strong>
                  <span aria-hidden="true">•</span>
                  <em className={bulkInputErrorCount ? 'isError' : undefined}>{bulkInputErrorCount.toLocaleString('id-ID')} error</em>
                </p>
              </div>

              <HorizontalDragScrollArea className="kasBulkGridScroller" onWheel={handleBulkGridWheel}>
                <table className={`kasBulkGridTable ${bulkInputSelectionMode ? 'hasSelection' : ''}`}>
                  <colgroup>
                    {bulkInputSelectionMode && <col className="kasBulkInputSelectCol" />}
                    <col className="kasBulkGridIndexCol" />
                    <col className="kasBulkGridDateCol" />
                    <col className="kasBulkGridCategoryCol" />
                    <col className="kasBulkGridSubcategoryCol" />
                    <col className="kasBulkGridAmountCol" />
                    <col className="kasBulkGridBranchCol" />
                    <col className="kasBulkGridVendorCol" />
                    <col className="kasBulkGridPaymentCol" />
                    <col className="kasBulkGridDescriptionCol" />
                    <col className="kasBulkGridNotesCol" />
                    <col className="kasBulkGridReferenceCol" />
                    <col className="kasBulkGridStatusCol" />
                    <col className="kasBulkGridActionCol" />
                  </colgroup>
                  <thead>
                    <tr>
                      {bulkInputSelectionMode && (
                        <th className="kasBulkInputSelectCell">
                          <Checkbox
                            className="dataTableSoftCheckbox"
                            checked={allBulkInputRowsSelected || (someBulkInputRowsSelected ? 'indeterminate' : false)}
                            onCheckedChange={(checked) => toggleAllBulkInputRows(Boolean(checked))}
                            aria-label="Pilih semua baris bulk input"
                          />
                        </th>
                      )}
                      <th>Baris</th>
                      <th>Tanggal</th>
                      <th>Kategori</th>
                      <th>Sub Kategori</th>
                      <th>Nominal</th>
                      <th>Cabang</th>
                      <th>Vendor</th>
                      <th>Sumber</th>
                      <th>Keterangan</th>
                      <th>Catatan</th>
                      <th>Referensi</th>
                      <th>Status</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkInputRows.map((row, index) => {
                      const preview = bulkInputPreview.find((item) => item.rowId === row.id);
                      const errors = preview?.errors || [];
                      const rowSubcategoryOptions = row.category
                        ? Array.from(new Set(categories
                          .filter((item) => item.category === row.category)
                          .map((item) => item.subcategory)
                          .filter(Boolean)))
                        : [];
                      const rowState = preview ? (errors.length ? 'isInvalid' : 'isValid') : 'isEmpty';
                      const invalidBranchLabel = row.branch_id.startsWith(BULK_INVALID_BRANCH_PREFIX)
                        ? row.branch_id.replace(BULK_INVALID_BRANCH_PREFIX, '')
                        : '';
                      const hasVendorFallback = row.vendor_name && !activeVendorOptions.some((vendor) => vendor.name === row.vendor_name);
                      const hasPaymentFallback = row.payment_source && !activePaymentOptions.some((payment) => getPaymentSourceLabel(payment) === row.payment_source);

                      return (
                        <tr key={row.id} className={`${rowState} ${selectedBulkInputRowIds.has(row.id) ? 'isSelected' : ''}`}>
                          {bulkInputSelectionMode && (
                            <td className="kasBulkInputSelectCell">
                              <Checkbox
                                className="dataTableSoftCheckbox"
                                checked={selectedBulkInputRowIds.has(row.id)}
                                onCheckedChange={(checked) => toggleBulkInputRowSelection(row.id, Boolean(checked))}
                                aria-label={`Pilih baris ${index + 1}`}
                              />
                            </td>
                          )}
                          <td className="kasBulkGridIndex">{index + 1}</td>
                          <td>
                            <BulkDatePicker
                              value={row.expense_date}
                              onValueChange={(expense_date) => updateBulkInputRow(row.id, { expense_date })}
                              placeholder="Pilih tanggal"
                            />
                          </td>
                          <td>
                            <Select
                              value={row.category || BULK_CLEAR_VALUE}
                              onValueChange={(value) => updateBulkInputRow(row.id, {
                                category: value === BULK_CLEAR_VALUE ? '' : value,
                                subcategory: '',
                              })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih kategori" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={BULK_CLEAR_VALUE}>Pilih kategori</SelectItem>
                                {categoryOptions.map((category) => (
                                  <SelectItem key={category} value={category}>{category}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Select
                              value={row.subcategory || BULK_CLEAR_VALUE}
                              onValueChange={(value) => updateBulkInputRow(row.id, { subcategory: value === BULK_CLEAR_VALUE ? '' : value })}
                              disabled={!row.category}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih sub kategori" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={BULK_CLEAR_VALUE}>Pilih sub kategori</SelectItem>
                                {rowSubcategoryOptions.map((subcategory) => (
                                  <SelectItem key={subcategory} value={subcategory}>{subcategory}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <MasterDataCurrencyInput
                              value={row.amount}
                              onValueChange={(amount) => updateBulkInputRow(row.id, { amount })}
                            />
                          </td>
                          <td>
                            <Select value={row.branch_id || 'all'} onValueChange={(branch_id) => updateBulkInputRow(row.id, { branch_id })}>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih cabang" />
                              </SelectTrigger>
                              <SelectContent>
                                {invalidBranchLabel ? (
                                  <SelectItem value={row.branch_id}>{invalidBranchLabel} (tidak aktif)</SelectItem>
                                ) : null}
                                <SelectItem value="all">Umum / tanpa cabang</SelectItem>
                                {activeBranches.map((branch) => (
                                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Select
                              value={row.vendor_name || OPTIONAL_SELECT_NONE}
                              onValueChange={(value) => updateBulkInputRow(row.id, { vendor_name: value === OPTIONAL_SELECT_NONE ? '' : value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Vendor" />
                              </SelectTrigger>
                              <SelectContent>
                                {hasVendorFallback ? (
                                  <SelectItem value={row.vendor_name}>{row.vendor_name} (tidak aktif)</SelectItem>
                                ) : null}
                                <SelectItem value={OPTIONAL_SELECT_NONE}>Tanpa vendor</SelectItem>
                                {activeVendorOptions.map((vendor) => (
                                  <SelectItem key={vendor.id} value={vendor.name}>{vendor.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Select
                              value={row.payment_source || OPTIONAL_SELECT_NONE}
                              onValueChange={(value) => updateBulkInputRow(row.id, { payment_source: value === OPTIONAL_SELECT_NONE ? '' : value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Sumber" />
                              </SelectTrigger>
                              <SelectContent>
                                {hasPaymentFallback ? (
                                  <SelectItem value={row.payment_source}>{row.payment_source} (tidak aktif)</SelectItem>
                                ) : null}
                                <SelectItem value={OPTIONAL_SELECT_NONE}>Tanpa sumber</SelectItem>
                                {activePaymentOptions.map((payment) => {
                                  const label = getPaymentSourceLabel(payment);
                                  return <SelectItem key={payment.id} value={label}>{label}</SelectItem>;
                                })}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Input
                              value={row.description}
                              placeholder="Keterangan"
                              onChange={(event) => updateBulkInputRow(row.id, { description: event.target.value })}
                            />
                          </td>
                          <td>
                            <Input
                              value={row.notes}
                              placeholder="Catatan"
                              onChange={(event) => updateBulkInputRow(row.id, { notes: event.target.value })}
                            />
                          </td>
                          <td>
                            <Input
                              value={row.source_ref}
                              placeholder="INV-001"
                              onChange={(event) => updateBulkInputRow(row.id, { source_ref: event.target.value })}
                            />
                          </td>
                          <td>
                            <span className={`kasBulkGridStatus ${rowState}`}>
                              {preview ? (errors.length ? 'Error' : 'Valid') : 'Kosong'}
                            </span>
                            {errors.length ? <em className="kasBulkGridError">{errors.join(', ')}</em> : null}
                          </td>
                          <td>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="kasBulkGridDelete"
                              onClick={() => removeBulkInputRow(row.id)}
                              disabled={bulkInputRows.length <= 1}
                              aria-label={`Hapus baris ${index + 1}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </HorizontalDragScrollArea>
              <p className="kasBulkInputHelp">
                File CSV/TSV/TXT masih bisa diimpor. Header fleksibel, lalu data akan dipindahkan ke grid untuk dicek sebelum simpan.
              </p>
            </section>

          </MasterDataDialogBody>
          <MasterDataFormActions
            isSubmitting={bulkSaving}
            onCancel={() => setBulkInputOpen(false)}
            saveLabel={`Simpan ${bulkInputValidRows.length.toLocaleString('id-ID')} Data`}
            submitDisabled={!canCreate || bulkInputHasErrors || bulkInputValidRows.length === 0}
          />
          </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={Boolean(detailRow)} onOpenChange={(open) => !open && setDetailRow(null)}>
        <MasterDataFormDialogContent>
          <MasterDataFormHeader
            icon={Eye}
            title="Detail Biaya Operasional"
            description="Ringkasan transaksi biaya operasional yang tercatat."
          />
          {detailRow && (
            <MasterDataDialogBody compact>
              <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <span className="text-sm font-medium text-slate-500">Status</span>
                  <Badge
                    variant="outline"
                    className={`kasDetailStatusPill ${detailRow.status === 'active' ? 'isActive' : 'isVoid'}`}
                  >
                    <span aria-hidden="true" />
                    {detailRow.status === 'active' ? 'Aktif' : 'Void'}
                  </Badge>
                </div>
                {[
                  ['Tanggal', formatDate(detailRow.expense_date)],
                  ['Kategori', detailRow.category],
                  ['Sub Kategori', detailRow.subcategory || '-'],
                  ['Cabang', detailRow.branch_name || '-'],
                  ['Vendor / Penerima', detailRow.vendor_name || '-'],
                  ['Sumber Pembayaran', detailRow.payment_source || '-'],
                  ['Referensi', detailRow.source_ref || '-'],
                  ['Nominal', formatCurrency(detailRow.amount)],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 dark:border-slate-800">
                    <span className="font-medium text-slate-500">{label}</span>
                    <span className="min-w-0 text-slate-900 dark:text-slate-100">{value}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-slate-500">Keterangan</div>
                  <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{detailRow.description || '-'}</p>
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-500">Catatan</div>
                  <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{detailRow.notes || '-'}</p>
                </div>
              </div>
            </MasterDataDialogBody>
          )}
        </MasterDataFormDialogContent>
      </Dialog>

      <AlertDialog open={bulkVoidOpen} onOpenChange={(open) => !open && setBulkVoidOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selectedRows.length.toLocaleString('id-ID')} biaya operasional?</AlertDialogTitle>
            <AlertDialogDescription>
              Data tidak dihapus permanen, tetapi diubah menjadi void dan tidak masuk summary aktif.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <MasterDataFieldLabel optional>Alasan</MasterDataFieldLabel>
            <Textarea
              className="mt-2 min-h-[92px]"
              placeholder="Contoh: Salah input massal"
              value={bulkVoidReason}
              onChange={(event) => setBulkVoidReason(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkSaving}>Batal</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="danger" onClick={handleBulkVoid} disabled={bulkSaving || !selectedRows.length}>
                {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Hapus Massal
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(voidRow)} onOpenChange={(open) => !open && setVoidRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void biaya operasional?</AlertDialogTitle>
            <AlertDialogDescription>Data tidak dihapus permanen, tetapi statusnya berubah menjadi void dan tidak masuk summary aktif.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea className="min-h-[96px] rounded-2xl" placeholder="Alasan void" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleVoid} disabled={saving} className="bg-red-600 hover:bg-red-700">
              {saving ? 'Memproses...' : 'Void'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OperationalPageShell>
  );
}
