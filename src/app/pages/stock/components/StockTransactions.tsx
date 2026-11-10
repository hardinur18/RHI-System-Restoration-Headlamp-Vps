import React, { useEffect, useMemo, useState } from 'react';
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Plus, Search, RefreshCcw, Loader2, Trash2, ClipboardList, Edit } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { format, isValid } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/app/components/ui/alert-dialog";
import { DatePickerWithRange } from "@/app/components/ui/date-range-picker";
import { usePermissions } from "@/app/hooks/usePermissions";
import { useMasterData } from "@/app/pages/master-data/context";
import { logActivity } from "@/app/services/auditService";
import { STOCK_UPDATED_EVENT, computeLedgerState, emitStockUpdated, groupTransactionsByProduct, reconcileProductStock, roundCurrencyValue, roundStockQuantity, sortStockTransactions, toStockNumber, type StockTransactionLike } from "../utils/stockLedger";
import { isMissingStockTransactionScopeColumnError, omitStockTransactionScope, retryWithoutInvalidStockScope, type StockScopeField } from "../utils/stockTransactionScope";
import { isTechnicianRole } from "@/app/data/roleHelpers";
import { createDataTableColumns, DataTable, TableActionCell, TableActionHeader, TableActionMenu, TableActionMenuItem, TableText } from "@/app/components/ui/data-table";
import { MasterDataDialogBody, MasterDataFieldLabel, MasterDataFormActions, MasterDataFormDialogContent } from "@/app/components/ui/master-data-ui";
import { MasterDataTableTitle } from "@/app/components/ui/master-data-table-title";
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalTableCard,
} from "@/app/components/ui/operational-page";
import { InventoryTablePagination, useInventoryTablePagination } from "./InventoryTablePagination";

interface Transaction {
  id: string;
  product_id: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  unit_price: number;
  total_value: number;
  notes: string;
  date: string;
  created_at: string;
  branch_id?: string | null;
  technician_id?: string | null;
  products?: {
      name: string;
      unit: string;
      branch_id?: string | null;
      technician_id?: string | null;
  }
}

interface Product {
  id: string;
  name: string;
  unit: string;
  current_qty: number;
  average_cost: number;
  branch_id?: string | null;
  technician_id?: string | null;
  recorded_qty?: number;
  recorded_average_cost?: number;
  stock_needs_review?: boolean;
}

interface ProductScopePayload extends Record<string, unknown> {
  current_qty: number;
  average_cost: number;
  branch_id: string | null;
  technician_id: string | null;
  updated_at: string;
}

interface TransactionState {
  qty: number;
  averageCost: number;
}

interface TransactionCalculationResult {
  nextState: TransactionState;
  unitPrice: number;
  totalValue: number;
}

interface BatchTransactionItem {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
}

const UNASSIGNED_SCOPE_FILTER = "__unassigned__";

const formatStockCurrency = (value: number | string | null | undefined) => {
  const numeric = toStockNumber(value);
  if (!numeric) return 'Rp 0';

  return `Rp ${Math.round(numeric).toLocaleString('id-ID', {
    maximumFractionDigits: 0,
  })}`;
};

const formatStockDateLabel = (value: string | null | undefined) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (!isValid(parsed)) return '-';

  return format(parsed, 'dd MMM yyyy', { locale: idLocale });
};

const createBatchItemId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function StockTransactions() {
  const { hasPermission } = usePermissions();
  const { currentUser, activeBranches, branches, users } = useMasterData();
  const canCreateTransaction = hasPermission('stock.transaction.create');
  const canEditTransaction = hasPermission('inventory.edit');
  const canCancelTransaction = hasPermission('stock.transaction.cancel');
  const hasTransactionActions = canEditTransaction || canCancelTransaction;
  const activeTechnicians = users.filter((user) => isTechnicianRole(user.role) && user.status === 'active');
  const buildDefaultFormData = () => ({
    productId: "",
    type: "IN",
    quantity: "",
    unitPrice: "",
    branchId: currentUser?.branchId || "",
    technicianId: isTechnicianRole(currentUser?.role) ? currentUser.id : "",
    notes: "",
    date: new Date().toISOString().split('T')[0]
  });
  const buildDefaultBatchItem = (): BatchTransactionItem => ({
    id: createBatchItemId(),
    productId: "",
    quantity: "",
    unitPrice: "",
  });

  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [historyScopeAvailable, setHistoryScopeAvailable] = useState<boolean | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);

  // Dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isScopeInfoDialogOpen, setIsScopeInfoDialogOpen] = useState(false);
  const [formData, setFormData] = useState(buildDefaultFormData);
  const [batchItems, setBatchItems] = useState<BatchTransactionItem[]>(() => [buildDefaultBatchItem()]);

  const branchNameMap = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches]
  );
  const userNameMap = useMemo(
    () => new Map(users.map((user) => [user.id, user.name])),
    [users]
  );

  const getTransactionBranchId = (transaction: Transaction) =>
    transaction.branch_id ?? null;

  const getTransactionTechnicianId = (transaction: Transaction) =>
    transaction.technician_id ?? null;

  const getBranchName = (branchId?: string | null) => {
    if (!branchId) return '-';
    return branchNameMap.get(branchId) || branchId;
  };

  const getUserName = (userId?: string | null) => {
    if (!userId) return '-';
    return userNameMap.get(userId) || userId;
  };

  useEffect(() => {
    fetchData();

    const handleStockUpdate = () => {
      fetchData();
    };

    window.addEventListener(STOCK_UPDATED_EVENT, handleStockUpdate);
    return () => window.removeEventListener(STOCK_UPDATED_EVENT, handleStockUpdate);
  }, []);

  const latestCancelableTransactionIds = new Set<string>();
  const latestProductIds = new Set<string>();
  for (const trx of transactions) {
    if (!latestProductIds.has(trx.product_id)) {
      latestProductIds.add(trx.product_id);
      latestCancelableTransactionIds.add(trx.id);
    }
  }

  const fetchData = async () => {
    setLoading(true);
    try {
      const [trxRes, prodRes, historyScopeProbe] = await Promise.all([
        supabase
            .from('stock_transactions')
            .select('*, products(name, unit, branch_id, technician_id)')
            .order('date', { ascending: false })
            .order('created_at', { ascending: false }),
        supabase
            .from('products')
            .select('id, name, unit, current_qty, average_cost, branch_id, technician_id')
            .order('name'),
        supabase
            .from('stock_transactions')
            .select('branch_id, technician_id')
            .limit(1),
      ]);

      if (trxRes.error) throw trxRes.error;
      if (prodRes.error) throw prodRes.error;

      if (historyScopeProbe.error) {
        if (isMissingStockTransactionScopeColumnError(historyScopeProbe.error)) {
          setHistoryScopeAvailable(false);
        } else {
          console.warn("[Stock] Gagal memeriksa ketersediaan scope histori transaksi:", historyScopeProbe.error);
          setHistoryScopeAvailable(null);
        }
      } else {
        setHistoryScopeAvailable(true);
      }

      setTransactions(trxRes.data || []);
      const transactionsByProduct = groupTransactionsByProduct((trxRes.data || []) as StockTransactionLike[]);
      const nextProducts = (prodRes.data || []).map((product) => {
        const stockState = reconcileProductStock(product, transactionsByProduct.get(product.id) || []);
        return {
          ...product,
          current_qty: stockState.effectiveQty,
          average_cost: stockState.effectiveAverageCost,
          recorded_qty: stockState.recordedQty,
          recorded_average_cost: stockState.recordedAverageCost,
          stock_needs_review: stockState.hasMismatch,
        } as Product;
      });

      setProducts(nextProducts);
      
    } catch (error) {
      console.error("Error fetching transactions:", error);
      toast.error("Gagal memuat data transaksi");
    } finally {
      setLoading(false);
    }
  };

  const loadProductSnapshot = async (productId: string) => {
    const [productRes, trxResWithScope] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, unit, current_qty, average_cost, branch_id, technician_id')
        .eq('id', productId)
        .single(),
      supabase
        .from('stock_transactions')
        .select('id, product_id, type, quantity, unit_price, total_value, notes, date, created_at, branch_id, technician_id')
        .eq('product_id', productId)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    let trxRes = trxResWithScope as {
      data: StockTransactionLike[] | null;
      error: unknown;
    };
    let scopeColumnsAvailable = true;

    if (trxRes.error && isMissingStockTransactionScopeColumnError(trxRes.error)) {
      scopeColumnsAvailable = false;
      setHistoryScopeAvailable(false);
      console.warn("[Stock] Kolom snapshot branch/technician belum ada di stock_transactions. Aplikasi memakai fallback kompatibilitas.");
      trxRes = await supabase
        .from('stock_transactions')
        .select('id, product_id, type, quantity, unit_price, total_value, notes, date, created_at')
        .eq('product_id', productId)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }) as {
          data: StockTransactionLike[] | null;
          error: unknown;
        };
    }

    if (productRes.error || !productRes.data) throw new Error("Produk tidak ditemukan");
    if (trxRes.error) throw trxRes.error;
    if (scopeColumnsAvailable) {
      setHistoryScopeAvailable(true);
    }

    const productTransactions = (trxRes.data || []) as StockTransactionLike[];
    const stockState = reconcileProductStock(productRes.data, productTransactions);

    return {
      product: productRes.data,
      productTransactions,
      stockState,
      scopeColumnsAvailable,
    };
  };

  const openNewDialog = () => {
    if (!canCreateTransaction) {
      toast.error("Anda tidak memiliki izin untuk membuat transaksi stok");
      return;
    }

    setEditingTransaction(null);
    setFormData(buildDefaultFormData());
    setBatchItems([buildDefaultBatchItem()]);
    setIsDialogOpen(true);
  };

  const openEditDialog = (transaction: Transaction) => {
    if (!canEditTransaction) {
      toast.error("Anda tidak memiliki izin untuk mengubah transaksi stok");
      return;
    }

    setEditingTransaction(transaction);
    setFormData({
      productId: transaction.product_id,
      type: transaction.type,
      quantity: String(transaction.quantity ?? ''),
      unitPrice: transaction.type === 'IN' && transaction.unit_price != null ? String(transaction.unit_price) : '',
      branchId: getTransactionBranchId(transaction) || "",
      technicianId: getTransactionTechnicianId(transaction) || "",
      notes: transaction.notes || "",
      date: transaction.date || transaction.created_at?.slice(0, 10) || new Date().toISOString().split('T')[0]
    });
    setIsDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingTransaction(null);
      setFormData(buildDefaultFormData());
      setBatchItems([buildDefaultBatchItem()]);
    }
  };

  const handleProductChange = (productId: string) => {
    const product = products.find((item) => item.id === productId);

    setFormData((prev) => ({
      ...prev,
      productId,
      branchId: product?.branch_id || prev.branchId || currentUser?.branchId || "",
      technicianId: product?.technician_id || prev.technicianId || (isTechnicianRole(currentUser?.role) ? currentUser.id : ""),
    }));
  };

  const handleTechnicianChange = (technicianId: string) => {
    if (technicianId === '_none_') {
      setFormData((prev) => ({ ...prev, technicianId: '' }));
      return;
    }

    const technician = activeTechnicians.find((item) => item.id === technicianId);

    setFormData((prev) => ({
      ...prev,
      technicianId,
      branchId: technician?.branchId || prev.branchId || "",
    }));
  };

  const updateBatchItem = (itemId: string, updates: Partial<BatchTransactionItem>) => {
    setBatchItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...updates } : item))
    );
  };

  const handleBatchProductChange = (itemId: string, productId: string) => {
    const product = products.find((item) => item.id === productId);
    updateBatchItem(itemId, { productId });

    if (product) {
      setFormData((prev) => ({
        ...prev,
        branchId: prev.branchId || product.branch_id || currentUser?.branchId || "",
        technicianId:
          prev.technicianId ||
          product.technician_id ||
          (isTechnicianRole(currentUser?.role) ? currentUser.id : ""),
      }));
    }
  };

  const addBatchItem = () => {
    setBatchItems((current) => [...current, buildDefaultBatchItem()]);
  };

  const removeBatchItem = (itemId: string) => {
    setBatchItems((current) =>
      current.length === 1 ? current : current.filter((item) => item.id !== itemId)
    );
  };

  const getScopeCompatibilityMessages = (fields: StockScopeField[], target: 'product' | 'history') => {
    const messages: string[] = [];

    if (fields.includes('branch_id')) {
      messages.push(
        target === 'product'
          ? "Cabang mutasi belum ikut tersimpan ke owner aktif produk karena schema `products.branch_id` masih format lama."
          : "Cabang mutasi belum ikut tersimpan ke histori transaksi karena schema `stock_transactions.branch_id` masih format lama."
      );
    }

    if (fields.includes('technician_id')) {
      messages.push(
        target === 'product'
          ? "Teknisi mutasi belum ikut tersimpan ke owner aktif produk karena schema `products.technician_id` masih format lama."
          : "Teknisi mutasi belum ikut tersimpan ke histori transaksi karena schema `stock_transactions.technician_id` masih format lama."
      );
    }

    return messages;
  };

  const updateProductWithScopeCompatibility = async (
    productId: string,
    payload: ProductScopePayload,
  ) => {
    const result = await retryWithoutInvalidStockScope(payload, async (nextPayload) =>
      await supabase
        .from('products')
        .update(nextPayload)
        .eq('id', productId)
        .select()
        .single()
    );

    if (result.error) throw result.error;

    if (result.omittedScopeFields.length > 0) {
      console.warn(
        `[Stock] Update products memakai fallback kompatibilitas tanpa scope: ${result.omittedScopeFields.join(', ')}`
      );
    }

    return result.omittedScopeFields;
  };

  const reverseTransactionFromState = (
    state: TransactionState,
    transaction: Pick<Transaction, 'type' | 'quantity' | 'total_value'>,
  ): TransactionState => {
    const quantity = toStockNumber(transaction.quantity);
    const totalValue = toStockNumber(transaction.total_value);

    if (transaction.type === 'IN') {
      const nextQty = roundStockQuantity(state.qty - quantity);
      if (nextQty < 0) {
        throw new Error("Tidak dapat memutar balik transaksi masuk karena stok saat ini lebih kecil dari qty transaksi");
      }

      if (nextQty === 0) {
        return { qty: 0, averageCost: 0 };
      }

      const currentTotal = state.qty * state.averageCost;
      const nextAverageCost = roundCurrencyValue((currentTotal - totalValue) / nextQty);
      return {
        qty: nextQty,
        averageCost: nextAverageCost < 0 ? 0 : nextAverageCost,
      };
    }

    if (transaction.type === 'OUT') {
      const restoredTotal = state.qty * state.averageCost + totalValue;
      const nextQty = roundStockQuantity(state.qty + quantity);
      return {
        qty: nextQty,
        averageCost: nextQty > 0 ? roundCurrencyValue(restoredTotal / nextQty) : 0,
      };
    }

    const nextQty = roundStockQuantity(state.qty - quantity);
    if (nextQty < 0) {
      throw new Error("Tidak dapat memutar balik adjustment karena hasil stok akan negatif");
    }

    return {
      qty: nextQty,
      averageCost: state.averageCost,
    };
  };

  const applyTransactionDraftToState = (
    state: TransactionState,
    draft: {
      type: Transaction['type'];
      quantity: number;
      unitPrice?: number | null;
    },
    unitLabel?: string,
  ): TransactionCalculationResult => {
    const nextState: TransactionState = {
      qty: state.qty,
      averageCost: state.averageCost,
    };

    if (draft.type === 'IN') {
      const inputPrice = Number(draft.unitPrice);
      if (!Number.isFinite(inputPrice) || inputPrice <= 0) {
        throw new Error("Harga beli harus diisi");
      }

      const oldTotalVal = nextState.qty * nextState.averageCost;
      const newIncomingVal = draft.quantity * inputPrice;
      nextState.qty = roundStockQuantity(nextState.qty + draft.quantity);
      nextState.averageCost = nextState.qty > 0
        ? roundCurrencyValue((oldTotalVal + newIncomingVal) / nextState.qty)
        : 0;

      return {
        nextState,
        unitPrice: inputPrice,
        totalValue: roundCurrencyValue(newIncomingVal),
      };
    }

    if (draft.type === 'OUT') {
      if (draft.quantity > nextState.qty) {
        throw new Error(`Stok tidak cukup! Sisa: ${nextState.qty} ${unitLabel || ''}`.trim());
      }

      nextState.qty = roundStockQuantity(nextState.qty - draft.quantity);
      const unitPrice = roundCurrencyValue(nextState.averageCost);

      return {
        nextState,
        unitPrice,
        totalValue: roundCurrencyValue(draft.quantity * unitPrice),
      };
    }

    const afterAdjustment = nextState.qty + draft.quantity;
    if (afterAdjustment < 0) {
      throw new Error(`Stok tidak cukup untuk adjustment! Stok: ${nextState.qty}, Adjustment: ${draft.quantity}`);
    }

    nextState.qty = roundStockQuantity(afterAdjustment);
    const unitPrice = roundCurrencyValue(nextState.averageCost);

    return {
      nextState,
      unitPrice,
      totalValue: roundCurrencyValue(draft.quantity * unitPrice),
    };
  };

  const saveTransactionHistoryWithScopeCompatibility = async (
    payload: Record<string, unknown>,
    options?: {
      transactionId?: string;
      scopeColumnsAvailable?: boolean;
    },
  ) => {
    const scopeColumnsAvailable = options?.scopeColumnsAvailable ?? true;
    const preparedPayload = scopeColumnsAvailable ? payload : omitStockTransactionScope(payload);
    let missingHistoryScope = !scopeColumnsAvailable;

    const runMutation = async (nextPayload: Partial<typeof payload>) => {
      if (options?.transactionId) {
        return await supabase
          .from('stock_transactions')
          .update(nextPayload)
          .eq('id', options.transactionId);
      }

      return await supabase
        .from('stock_transactions')
        .insert([nextPayload])
        .select('id')
        .single();
    };

    const result = await retryWithoutInvalidStockScope(preparedPayload, runMutation);
    let error = result.error;
    let omittedScopeFields = [...result.omittedScopeFields];

    if (error && isMissingStockTransactionScopeColumnError(error)) {
      console.warn("[Stock] Kolom snapshot branch/technician belum ada di stock_transactions. Mutasi tetap diproses tanpa scope histori.");
      const retry = await runMutation(omitStockTransactionScope(payload));
      error = retry.error;
      missingHistoryScope = true;
      setHistoryScopeAvailable(false);
    } else if (!error && !missingHistoryScope) {
      setHistoryScopeAvailable(true);
    }

    if (error) throw error;

    return {
      data: 'data' in result ? result.data : null,
      omittedScopeFields,
      missingHistoryScope,
    };
  };

  const handleCreateTransaction = async () => {
    if (!canCreateTransaction) {
        toast.error("Anda tidak memiliki izin untuk membuat transaksi stok");
        return;
    }

    if (!formData.type) {
        toast.error("Tipe transaksi wajib dipilih");
        return;
    }

    let preparedItems: Array<{
      rowNumber: number;
      product: Product;
      productId: string;
      quantity: number;
      unitPrice: number | null;
    }>;

    try {
      preparedItems = batchItems.map((item, index) => {
        const product = products.find((productItem) => productItem.id === item.productId);
        const inputQty = Number(item.quantity);
        const inputUnitPrice = formData.type === 'IN' ? Number(item.unitPrice) : null;
        const rowNumber = index + 1;

        if (!item.productId || !product) {
          throw new Error(`Baris ${rowNumber}: barang wajib dipilih`);
        }

        if (!item.quantity || Number.isNaN(inputQty) || inputQty === 0) {
          throw new Error(`Baris ${rowNumber}: qty tidak boleh 0`);
        }

        if (formData.type !== 'ADJUST' && inputQty < 0) {
          throw new Error(`Baris ${rowNumber}: qty harus positif untuk tipe Masuk/Keluar`);
        }

        if (
          formData.type === 'IN' &&
          (!Number.isFinite(inputUnitPrice as number) || (inputUnitPrice as number) <= 0)
        ) {
          throw new Error(`Baris ${rowNumber}: harga beli wajib diisi`);
        }

        return {
          rowNumber,
          product,
          productId: item.productId,
          quantity: inputQty,
          unitPrice: inputUnitPrice,
        };
      });
    } catch (error: any) {
      toast.error(error.message);
      return;
    }

    if (preparedItems.length === 0) {
      toast.error("Minimal satu barang harus diisi");
      return;
    }

    try {
      const seenProducts = new Set<string>();
      for (const item of preparedItems) {
        if (seenProducts.has(item.productId)) {
          throw new Error(`Barang ${item.product.name} dipilih lebih dari satu kali. Gabungkan qty-nya dalam satu baris.`);
        }
        seenProducts.add(item.productId);
      }
    } catch (error: any) {
      toast.error(error.message);
      return;
    }

    setLoading(true);
    const insertedTransactionIds: string[] = [];
    const rollbackProducts = new Map<string, ProductScopePayload>();
    try {
        const compatibilityWarnings = new Set<string>();

        for (const item of preparedItems) {
          const { product, stockState, scopeColumnsAvailable } = await loadProductSnapshot(item.productId);
          if (!rollbackProducts.has(product.id)) {
            rollbackProducts.set(product.id, {
              current_qty: product.current_qty,
              average_cost: product.average_cost,
              branch_id: product.branch_id || null,
              technician_id: product.technician_id || null,
              updated_at: new Date().toISOString(),
            });
          }

          const calculation = applyTransactionDraftToState(
            {
              qty: stockState.effectiveQty,
              averageCost: stockState.effectiveAverageCost,
            },
            {
              type: formData.type as Transaction['type'],
              quantity: item.quantity,
              unitPrice: formData.type === 'IN' ? item.unitPrice : null,
            },
            product.unit,
          );

          const productPayload: ProductScopePayload = {
              current_qty: calculation.nextState.qty,
              average_cost: calculation.nextState.averageCost,
              branch_id: formData.branchId || null,
              technician_id: formData.technicianId || null,
              updated_at: new Date().toISOString()
          };

          const omittedProductScopeFields = await updateProductWithScopeCompatibility(product.id, productPayload);
          getScopeCompatibilityMessages(omittedProductScopeFields, 'product').forEach((message) => compatibilityWarnings.add(message));

          const trxPayload: any = {
              product_id: item.productId,
              type: formData.type,
              quantity: item.quantity,
              unit_price: calculation.unitPrice,
              total_value: calculation.totalValue,
              branch_id: formData.branchId || null,
              technician_id: formData.technicianId || null,
              notes: formData.notes,
              date: formData.date
          };

          const insertResult = await saveTransactionHistoryWithScopeCompatibility(trxPayload, {
            scopeColumnsAvailable,
          });

          getScopeCompatibilityMessages(insertResult.omittedScopeFields, 'history').forEach((message) => compatibilityWarnings.add(message));

          const insertedId = (insertResult.data as { id?: string } | null)?.id;
          if (insertedId) {
            insertedTransactionIds.push(insertedId);
          }

          if (insertResult.missingHistoryScope) {
            compatibilityWarnings.add("Snapshot cabang dan teknisi mutasi belum ikut tersimpan ke histori transaksi karena kolom scope di `stock_transactions` belum ada di database.");
          }
        }

        toast.success(`${preparedItems.length} transaksi berhasil dicatat`);
        if (compatibilityWarnings.size > 0) {
          toast.warning(Array.from(compatibilityWarnings).join(' '), {
            duration: 7000,
          });
        }
        if (currentUser) {
          const typeLabels: Record<string, string> = { IN: 'Masuk', OUT: 'Keluar', ADJUST: 'Adjustment' };
          const itemSummary = preparedItems
            .map((item) => `${item.product.name} (${item.quantity} ${item.product.unit})`)
            .join(', ');
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'CREATE',
            'Transaksi Stok',
            `Mencatat ${preparedItems.length} transaksi ${typeLabels[formData.type] || formData.type}: ${itemSummary}${formData.branchId ? ` - Cabang ${activeBranches.find((branch) => branch.id === formData.branchId)?.name || formData.branchId}` : ''}${formData.technicianId ? ` - Teknisi ${users.find((user) => user.id === formData.technicianId)?.name || formData.technicianId}` : ''}`,
            '',
            {
              type: formData.type,
              items: preparedItems.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            }
          );
        }
        handleDialogOpenChange(false);
        emitStockUpdated();

    } catch (error: any) {
        console.error("Error submitting transaction:", error);
        if (insertedTransactionIds.length > 0 || rollbackProducts.size > 0) {
          try {
            if (insertedTransactionIds.length > 0) {
              await supabase
                .from('stock_transactions')
                .delete()
                .in('id', insertedTransactionIds);
            }

            for (const [productId, payload] of rollbackProducts) {
              await updateProductWithScopeCompatibility(productId, payload);
            }
          } catch (rollbackError) {
            console.error("Error rolling back batch stock transaction:", rollbackError);
            toast.error("Gagal menyimpan batch dan rollback tidak sepenuhnya berhasil. Cek histori stok sebelum input ulang.");
            return;
          }
        }
        toast.error(`Gagal: ${error.message}`);
    } finally {
        setLoading(false);
    }
  };

  const handleEditTransaction = async () => {
    if (!editingTransaction) {
      return;
    }

    if (!canEditTransaction) {
      toast.error("Anda tidak memiliki izin untuk mengubah transaksi stok");
      return;
    }

    const inputQty = Number(formData.quantity);
    if (!formData.productId || !formData.quantity || !formData.type) {
      toast.error("Mohon lengkapi data wajib");
      return;
    }

    if (isNaN(inputQty) || inputQty === 0) {
      toast.error("Jumlah tidak boleh 0");
      return;
    }

    if (formData.type !== 'ADJUST' && inputQty < 0) {
      toast.error("Jumlah harus angka positif untuk tipe Masuk/Keluar");
      return;
    }

    setLoading(true);
    try {
      const { product, productTransactions, stockState, scopeColumnsAvailable } = await loadProductSnapshot(editingTransaction.product_id);
      const compatibilityWarnings = new Set<string>();
      const sortedTransactions = [...productTransactions].sort(sortStockTransactions);
      const latestTransaction = sortedTransactions[sortedTransactions.length - 1];
      const previousTransaction = sortedTransactions[sortedTransactions.length - 2] as (StockTransactionLike & {
        branch_id?: string | null;
        technician_id?: string | null;
      }) | undefined;

      const isLatestTransaction = Boolean(latestTransaction && latestTransaction.id === editingTransaction.id);

      if (!isLatestTransaction) {
        // Edit transaksi histori (bukan paling baru). Tipe & tanggal tetap terkunci;
        // hanya qty dan harga beli (HPP) yang bisa berubah. Stok & HPP rata-rata
        // direkalkulasi dari SELURUH histori transaksi produk ini lalu dipersist.
        const editedType = editingTransaction.type;
        const editedUnitPrice = editedType === 'IN' ? Number(formData.unitPrice) : null;

        if (editedType === 'IN' && (!Number.isFinite(editedUnitPrice as number) || (editedUnitPrice as number) <= 0)) {
          throw new Error("Harga beli harus diisi");
        }

        // Substitusi qty & harga di baris yang diedit.
        const editedTransactions: StockTransactionLike[] = sortedTransactions.map((trx) =>
          trx.id === editingTransaction.id
            ? { ...trx, quantity: inputQty, unit_price: editedUnitPrice }
            : trx
        );

        // Validasi: stok berjalan tidak boleh pernah minus di sepanjang histori.
        const chronological = [...editedTransactions].sort(sortStockTransactions);
        let runningQty = 0;
        for (const trx of chronological) {
          const trxQty = toStockNumber(trx.quantity);
          runningQty = roundStockQuantity(trx.type === 'OUT' ? runningQty - trxQty : runningQty + trxQty);
          if (runningQty < 0) {
            throw new Error("Perubahan ini membuat stok pernah minus di tengah histori. Sesuaikan qty agar stok tidak pernah negatif.");
          }
        }

        const ledger = computeLedgerState(editedTransactions);

        // Snapshot harga & total untuk baris yang diedit.
        let snapshotUnitPrice: number;
        let snapshotTotalValue: number;
        if (editedType === 'IN') {
          snapshotUnitPrice = roundCurrencyValue(editedUnitPrice as number);
          snapshotTotalValue = roundCurrencyValue(inputQty * (editedUnitPrice as number));
        } else {
          const priorAverage = computeLedgerState(
            chronological.filter((trx) => sortStockTransactions(trx, editingTransaction) < 0)
          ).averageCost;
          snapshotUnitPrice = roundCurrencyValue(priorAverage);
          snapshotTotalValue = roundCurrencyValue(inputQty * priorAverage);
        }

        const omittedProductScopeFields = await updateProductWithScopeCompatibility(product.id, {
          current_qty: ledger.qty,
          average_cost: ledger.averageCost,
          branch_id: formData.branchId || null,
          technician_id: formData.technicianId || null,
          updated_at: new Date().toISOString(),
        });
        getScopeCompatibilityMessages(omittedProductScopeFields, 'product').forEach((message) => compatibilityWarnings.add(message));

        const historyPayload = {
          quantity: inputQty,
          unit_price: snapshotUnitPrice,
          total_value: snapshotTotalValue,
          branch_id: formData.branchId || null,
          technician_id: formData.technicianId || null,
          notes: formData.notes,
        };

        try {
          const updateResult = await saveTransactionHistoryWithScopeCompatibility(historyPayload, {
            transactionId: editingTransaction.id,
            scopeColumnsAvailable,
          });
          getScopeCompatibilityMessages(updateResult.omittedScopeFields, 'history').forEach((message) => compatibilityWarnings.add(message));
          if (updateResult.missingHistoryScope) {
            compatibilityWarnings.add("Snapshot cabang dan teknisi mutasi belum ikut tersimpan ke histori transaksi karena kolom scope di `stock_transactions` belum ada di database.");
          }
        } catch (updateError) {
          try {
            await updateProductWithScopeCompatibility(product.id, {
              current_qty: product.current_qty,
              average_cost: product.average_cost,
              branch_id: product.branch_id || null,
              technician_id: product.technician_id || null,
              updated_at: new Date().toISOString(),
            });
          } catch (rollbackError) {
            console.error("Error rolling back product after historical transaction update failure:", rollbackError);
          }
          throw updateError;
        }

        toast.success("Transaksi diperbarui & HPP rata-rata dihitung ulang");
        if (compatibilityWarnings.size > 0) {
          toast.warning(Array.from(compatibilityWarnings).join(' '), {
            duration: 7000,
          });
        }
        if (currentUser) {
          const typeLabels: Record<string, string> = { IN: 'Masuk', OUT: 'Keluar', ADJUST: 'Adjustment' };
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'UPDATE',
            'Transaksi Stok',
            `Koreksi histori transaksi ${typeLabels[editedType] || editedType}: ${product.name} (${inputQty} ${product.unit}) - stok & HPP rata-rata direkalkulasi`,
            editingTransaction.id,
            { productId: product.id, type: editedType, quantity: inputQty, recompute: true }
          );
        }
        handleDialogOpenChange(false);
        emitStockUpdated();
        return;
      }

      if (
        previousTransaction &&
        sortStockTransactions<Pick<StockTransactionLike, 'date' | 'created_at'>>(
          {
            date: formData.date,
            created_at: editingTransaction.created_at,
          },
          previousTransaction
        ) < 0
      ) {
        throw new Error("Tanggal transaksi tidak boleh lebih awal dari mutasi sebelumnya. Jika urutannya memang salah, batalkan lalu catat ulang agar histori tetap rapi.");
      }

      const baseState = reverseTransactionFromState(
        {
          qty: stockState.effectiveQty,
          averageCost: stockState.effectiveAverageCost,
        },
        {
          type: editingTransaction.type,
          quantity: editingTransaction.quantity,
          total_value: editingTransaction.total_value,
        }
      );

      const calculation = applyTransactionDraftToState(
        baseState,
        {
          type: formData.type as Transaction['type'],
          quantity: inputQty,
          unitPrice: formData.type === 'IN' ? Number(formData.unitPrice) : null,
        },
        product.unit,
      );

      const omittedProductScopeFields = await updateProductWithScopeCompatibility(product.id, {
        current_qty: calculation.nextState.qty,
        average_cost: calculation.nextState.averageCost,
        branch_id: formData.branchId || null,
        technician_id: formData.technicianId || null,
        updated_at: new Date().toISOString(),
      });
      getScopeCompatibilityMessages(omittedProductScopeFields, 'product').forEach((message) => compatibilityWarnings.add(message));

      const updatePayload = {
        type: formData.type,
        quantity: inputQty,
        unit_price: calculation.unitPrice,
        total_value: calculation.totalValue,
        branch_id: formData.branchId || null,
        technician_id: formData.technicianId || null,
        notes: formData.notes,
        date: formData.date,
      };

      try {
        const updateResult = await saveTransactionHistoryWithScopeCompatibility(updatePayload, {
          transactionId: editingTransaction.id,
          scopeColumnsAvailable,
        });
        getScopeCompatibilityMessages(updateResult.omittedScopeFields, 'history').forEach((message) => compatibilityWarnings.add(message));
        if (updateResult.missingHistoryScope) {
          compatibilityWarnings.add("Snapshot cabang dan teknisi mutasi belum ikut tersimpan ke histori transaksi karena kolom scope di `stock_transactions` belum ada di database.");
        }
      } catch (updateError) {
        try {
          await updateProductWithScopeCompatibility(product.id, {
            current_qty: product.current_qty,
            average_cost: product.average_cost,
            branch_id: scopeColumnsAvailable && previousTransaction ? previousTransaction.branch_id || null : product.branch_id || null,
            technician_id: scopeColumnsAvailable && previousTransaction ? previousTransaction.technician_id || null : product.technician_id || null,
            updated_at: new Date().toISOString(),
          });
        } catch (rollbackError) {
          console.error("Error rolling back product after transaction update failure:", rollbackError);
        }
        throw updateError;
      }

      toast.success("Transaksi berhasil diperbarui");
      if (compatibilityWarnings.size > 0) {
        toast.warning(Array.from(compatibilityWarnings).join(' '), {
          duration: 7000,
        });
      }
      if (currentUser) {
        const typeLabels: Record<string, string> = { IN: 'Masuk', OUT: 'Keluar', ADJUST: 'Adjustment' };
        logActivity(
          { id: currentUser.id, name: currentUser.name, role: currentUser.role },
          'UPDATE',
          'Transaksi Stok',
          `Memperbarui transaksi ${typeLabels[formData.type] || formData.type}: ${product.name} (${inputQty} ${product.unit})${formData.branchId ? ` - Cabang ${activeBranches.find((branch) => branch.id === formData.branchId)?.name || formData.branchId}` : ''}${formData.technicianId ? ` - Teknisi ${users.find((user) => user.id === formData.technicianId)?.name || formData.technicianId}` : ''}`,
          editingTransaction.id,
          { productId: product.id, type: formData.type, quantity: inputQty }
        );
      }
      handleDialogOpenChange(false);
      emitStockUpdated();
    } catch (error: any) {
      console.error("Error updating transaction:", error);
      toast.error(`Gagal ubah transaksi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (editingTransaction) {
      await handleEditTransaction();
      return;
    }

    await handleCreateTransaction();
  };

  const handleDeleteTransaction = async (trx: Transaction) => {
    if (!canCancelTransaction) {
      toast.error("Anda tidak memiliki izin untuk membatalkan transaksi");
      return;
    }

    setLoading(true);
    try {
      const { product, productTransactions, stockState, scopeColumnsAvailable } = await loadProductSnapshot(trx.product_id);
      const sortedTransactions = [...productTransactions].sort(sortStockTransactions);
      const latestTransaction = sortedTransactions[sortedTransactions.length - 1];

      if (!latestTransaction || latestTransaction.id !== trx.id) {
        throw new Error("Hanya transaksi terbaru per produk yang bisa dibatalkan agar histori stok tetap konsisten");
      }

      const previousTransaction = sortedTransactions[sortedTransactions.length - 2] as (StockTransactionLike & {
        branch_id?: string | null;
        technician_id?: string | null;
      }) | undefined;

      let newQty = stockState.effectiveQty;
      let newAvgCost = stockState.effectiveAverageCost;
      const trxQty = toStockNumber(trx.quantity);
      const trxTotalValue = toStockNumber(trx.total_value);

      if (trx.type === 'IN') {
        const reversedQty = roundStockQuantity(newQty - trxQty);
        if (reversedQty < 0) throw new Error("Tidak dapat membatalkan: stok saat ini lebih kecil dari qty transaksi");
        if (reversedQty === 0) {
          newAvgCost = 0;
        } else {
          const currentTotal = newQty * newAvgCost;
          newAvgCost = roundCurrencyValue((currentTotal - trxTotalValue) / reversedQty);
          if (newAvgCost < 0) newAvgCost = 0;
        }
        newQty = reversedQty;
      } else if (trx.type === 'OUT') {
        const restoredTotal = newQty * newAvgCost + trxTotalValue;
        newQty = roundStockQuantity(newQty + trxQty);
        newAvgCost = newQty > 0 ? roundCurrencyValue(restoredTotal / newQty) : 0;
        } else if (trx.type === 'ADJUST') {
          const reversedQty = roundStockQuantity(newQty - trxQty);
          if (reversedQty < 0) throw new Error("Tidak dapat membatalkan: hasil reversal stok akan negatif");
          newQty = reversedQty;
        }

      const omittedScopeFields = await updateProductWithScopeCompatibility(product.id, {
        current_qty: newQty,
        average_cost: newAvgCost,
        branch_id: scopeColumnsAvailable && previousTransaction ? previousTransaction.branch_id || null : product.branch_id || null,
        technician_id: scopeColumnsAvailable && previousTransaction ? previousTransaction.technician_id || null : product.technician_id || null,
        updated_at: new Date().toISOString(),
      });

      const { error: deleteError } = await supabase
        .from('stock_transactions')
        .delete()
        .eq('id', trx.id);

      if (deleteError) {
        try {
          await updateProductWithScopeCompatibility(product.id, {
            current_qty: product.current_qty,
            average_cost: product.average_cost,
            branch_id: product.branch_id || null,
            technician_id: product.technician_id || null,
            updated_at: new Date().toISOString(),
          });
        } catch (rollbackError) {
          console.error("Error rolling back product after delete failure:", rollbackError);
        }
        throw deleteError;
      }

      toast.success("Transaksi dibatalkan dan stok dikembalikan");
      const deleteWarnings = getScopeCompatibilityMessages(omittedScopeFields, 'product');
      if (deleteWarnings.length > 0) {
        toast.warning(deleteWarnings.join(' '), {
          duration: 7000,
        });
      }
      if (currentUser) {
        const typeLabels: Record<string, string> = { IN: 'Masuk', OUT: 'Keluar', ADJUST: 'Adjustment' };
        logActivity(
          { id: currentUser.id, name: currentUser.name, role: currentUser.role },
          'DELETE',
          'Transaksi Stok',
          `Membatalkan transaksi ${typeLabels[trx.type] || trx.type}: ${product.name} (${trxQty} ${product.unit})`,
          trx.id,
          { productId: trx.product_id, type: trx.type, quantity: trxQty }
        );
      }
      emitStockUpdated();
    } catch (error: any) {
      console.error("Error deleting transaction:", error);
      toast.error(`Gagal batalkan transaksi: ${error.message}`);
    } finally {
      setDeleteTarget(null);
      setLoading(false);
    }
  };

  const dateFrom = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : null;
  const dateTo = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : dateFrom;

  const filteredTransactions = transactions.filter((transaction) => {
      const transactionDate = transaction.date || transaction.created_at?.slice(0, 10) || '';
      const branchId = getTransactionBranchId(transaction);
      const technicianId = getTransactionTechnicianId(transaction);
      const branchName = getBranchName(branchId).toLowerCase();
      const technicianName = getUserName(technicianId).toLowerCase();
      const productName = transaction.products?.name?.toLowerCase() || '';
      const notes = transaction.notes?.toLowerCase() || '';
      const search = searchTerm.trim().toLowerCase();

      const matchesType = typeFilter === 'all' || transaction.type === typeFilter;
      const matchesBranch =
        branchFilter === 'all' ||
        (branchFilter === UNASSIGNED_SCOPE_FILTER ? !branchId : branchId === branchFilter);
      const matchesTechnician =
        technicianFilter === 'all' ||
        (technicianFilter === UNASSIGNED_SCOPE_FILTER ? !technicianId : technicianId === technicianFilter);
      const matchesDate =
        (!dateFrom || transactionDate >= dateFrom) &&
        (!dateTo || transactionDate <= dateTo);
      const matchesSearch =
        !search ||
        productName.includes(search) ||
        notes.includes(search) ||
        branchName.includes(search) ||
        technicianName.includes(search);

      return matchesType && matchesBranch && matchesTechnician && matchesDate && matchesSearch;
  });

  const getTypeLabel = (type: string) => {
      switch(type) {
          case 'IN': return 'Masuk';
          case 'OUT': return 'Keluar';
          case 'ADJUST': return 'Opname';
          default: return type;
      }
  };

  const isEditMode = Boolean(editingTransaction);
  const isEditingLatestTransaction = editingTransaction ? latestCancelableTransactionIds.has(editingTransaction.id) : false;
  const selectedProduct = products.find(p => p.id === formData.productId);
  const selectedBranch = activeBranches.find((branch) => branch.id === formData.branchId);
  const selectedTechnician = activeTechnicians.find((technician) => technician.id === formData.technicianId);
  const sameBranchTechnicians = activeTechnicians.filter((technician) => technician.branchId === formData.branchId);
  const otherActiveTechnicians = activeTechnicians.filter((technician) => technician.branchId !== formData.branchId);
  const tableColumnCount = hasTransactionActions ? 9 : 8;
  const transactionPagination = useInventoryTablePagination(
    filteredTransactions,
    `${searchTerm}|${typeFilter}|${branchFilter}|${technicianFilter}|${dateFrom || ''}|${dateTo || ''}`,
  );

  useEffect(() => {
    document.querySelector<HTMLElement>('.inventoryTransactionTable')?.scrollTo({ left: 0, top: 0 });
  }, [searchTerm, typeFilter, branchFilter, technicianFilter, dateFrom, dateTo, transactionPagination.page]);

  const transactionPreview = useMemo(() => {
    if (!selectedProduct) return null;

    if (isEditMode && !isEditingLatestTransaction) {
      const parsedQty = Number(formData.quantity);
      const parsedPrice = Number(formData.unitPrice);
      const totalValue = formData.type === 'IN' && Number.isFinite(parsedQty) && Number.isFinite(parsedPrice) && parsedPrice > 0
        ? roundCurrencyValue(parsedQty * parsedPrice)
        : null;
      return {
        beforeQty: null,
        afterQty: null,
        totalValue,
        error: null as string | null,
      };
    }

    const parsedQuantity = Number(formData.quantity);
    if (!formData.quantity || Number.isNaN(parsedQuantity) || parsedQuantity === 0) {
      return null;
    }

    try {
      const baseState = isEditMode && isEditingLatestTransaction && editingTransaction && selectedProduct.id === editingTransaction.product_id
        ? reverseTransactionFromState(
            {
              qty: toStockNumber(selectedProduct.current_qty),
              averageCost: toStockNumber(selectedProduct.average_cost),
            },
            editingTransaction,
          )
        : {
            qty: toStockNumber(selectedProduct.current_qty),
            averageCost: toStockNumber(selectedProduct.average_cost),
          };

      const calculation = applyTransactionDraftToState(
        baseState,
        {
          type: formData.type as Transaction['type'],
          quantity: parsedQuantity,
          unitPrice: formData.type === 'IN' ? Number(formData.unitPrice) : null,
        },
        selectedProduct.unit,
      );

      return {
        beforeQty: baseState.qty,
        afterQty: calculation.nextState.qty,
        totalValue: calculation.totalValue,
        error: null as string | null,
      };
    } catch (error: any) {
      return {
        beforeQty: null,
        afterQty: null,
        totalValue: null,
        error: error?.message || 'Preview transaksi belum bisa dihitung.',
      };
    }
  }, [
    editingTransaction,
    formData.date,
    formData.productId,
    formData.quantity,
    formData.type,
    formData.unitPrice,
    isEditMode,
    isEditingLatestTransaction,
    selectedProduct,
  ]);
  const batchTransactionPreview = useMemo(() => {
    if (isEditMode) return [];

    const stateByProduct = new Map<string, TransactionState>();

    return batchItems.map((item) => {
      const product = products.find((productItem) => productItem.id === item.productId);
      const parsedQuantity = Number(item.quantity);

      if (!product || !item.quantity || Number.isNaN(parsedQuantity) || parsedQuantity === 0) {
        return {
          itemId: item.id,
          product,
          beforeQty: null,
          afterQty: null,
          totalValue: null,
          error: null as string | null,
        };
      }

      const baseState = stateByProduct.get(product.id) || {
        qty: toStockNumber(product.current_qty),
        averageCost: toStockNumber(product.average_cost),
      };

      try {
        const calculation = applyTransactionDraftToState(
          baseState,
          {
            type: formData.type as Transaction['type'],
            quantity: parsedQuantity,
            unitPrice: formData.type === 'IN' ? Number(item.unitPrice) : null,
          },
          product.unit,
        );

        stateByProduct.set(product.id, calculation.nextState);

        return {
          itemId: item.id,
          product,
          beforeQty: baseState.qty,
          afterQty: calculation.nextState.qty,
          totalValue: calculation.totalValue,
          error: null as string | null,
        };
      } catch (error: any) {
        return {
          itemId: item.id,
          product,
          beforeQty: baseState.qty,
          afterQty: null,
          totalValue: null,
          error: error?.message || 'Preview transaksi belum bisa dihitung.',
        };
      }
    });
  }, [batchItems, formData.type, isEditMode, products]);
  const batchPreviewTotals = useMemo(() => {
    return batchTransactionPreview.reduce(
      (summary, preview) => ({
        filledRows: summary.filledRows + (preview.product ? 1 : 0),
        totalValue: summary.totalValue + (preview.totalValue || 0),
        hasError: summary.hasError || Boolean(preview.error),
      }),
      { filledRows: 0, totalValue: 0, hasError: false }
    );
  }, [batchTransactionPreview]);

  return (
    <div className="inventoryTabStack">
      {/* Filters */}
      <OperationalFilterPanel className="inventoryFilterPanel inventoryFilterPanelStack">
        <div className="responsiveFilterGrid inventoryFilterGrid inventoryFilterGridTransactions">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Cari barang, cabang, teknisi, atau catatan..."
              className="uiInput pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="uiSelectTrigger">
              <SelectValue placeholder="Tipe Transaksi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tipe</SelectItem>
              <SelectItem value="IN">Masuk (Beli)</SelectItem>
              <SelectItem value="OUT">Keluar (Pakai/Jual)</SelectItem>
              <SelectItem value="ADJUST">Opname</SelectItem>
            </SelectContent>
          </Select>

            <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="uiSelectTrigger">
              <SelectValue placeholder="Semua Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Cabang</SelectItem>
              <SelectItem value={UNASSIGNED_SCOPE_FILTER}>Belum ditentukan</SelectItem>
              {activeBranches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
            <SelectTrigger className="uiSelectTrigger">
              <SelectValue placeholder="Semua Teknisi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Teknisi</SelectItem>
              <SelectItem value={UNASSIGNED_SCOPE_FILTER}>Belum ditentukan</SelectItem>
              {activeTechnicians.map((technician) => (
                <SelectItem key={technician.id} value={technician.id}>
                  {technician.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div>
            <DatePickerWithRange
              date={dateRange}
              setDate={setDateRange}
              className="w-full"
            />
          </div>

        </div>

        <div className="inventoryFilterFooter">
          <div className="inventoryFilterMeta">
            <span>Tampil: {filteredTransactions.length} mutasi</span>
            {branchFilter !== 'all' && (
              <span>
                Cabang: {branchFilter === UNASSIGNED_SCOPE_FILTER ? 'Belum ditentukan' : getBranchName(branchFilter)}
              </span>
            )}
            {technicianFilter !== 'all' && (
              <span>
                Teknisi: {technicianFilter === UNASSIGNED_SCOPE_FILTER ? 'Belum ditentukan' : getUserName(technicianFilter)}
              </span>
            )}
            {dateFrom && (
              <span>
                Periode: {dateFrom}{dateTo && dateTo !== dateFrom ? ` s/d ${dateTo}` : ''}
              </span>
            )}
          </div>
          <div className="inventoryFilterActions">
            <Button variant="outline" size="icon" onClick={fetchData} title="Refresh" className="inventoryFilterRefreshButton">
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {canCreateTransaction && (
              <Button onClick={openNewDialog} icon={<Plus className="h-4 w-4" />} className="inventoryPrimaryButton">
                Transaksi Baru
              </Button>
            )}
          </div>
        </div>
      </OperationalFilterPanel>

      {/* Table */}
      <OperationalTableCard className="inventoryTableCard">
        <MasterDataTableTitle title="Histori Transaksi & Mutasi" count={filteredTransactions.length} variant="active" />
        <DataTable
          actionWidth={hasTransactionActions ? 82 : undefined}
          cellY={12}
          columns={createDataTableColumns([
            'number',
            'status',
            'name',
            'text',
            'quantity',
            'money',
            'money',
            'description',
            hasTransactionActions && 'action',
          ])}
          className="inventoryTransactionTable"
          primaryLines={1}
          rowMinHeight={58}
          secondaryLines={1}
          textMax={220}
        >
        <table>
          <TableHeader>
            <TableRow>
              <TableHead>No</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>Nama Barang</TableHead>
              <TableHead>Teknisi/Cabang</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Harga Satuan</TableHead>
              <TableHead className="text-right">Total Nilai</TableHead>
              <TableHead>Catatan</TableHead>
              {hasTransactionActions && (
                <TableActionHeader />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && transactions.length === 0 ? (
                 <TableRow><TableCell colSpan={tableColumnCount} className="h-32 text-center border-0 text-slate-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : filteredTransactions.length === 0 ? (
                 <TableRow><TableCell colSpan={tableColumnCount} className="border-0"><OperationalEmptyState icon={ClipboardList} title="Belum ada transaksi" description="Tidak ada mutasi yang cocok dengan filter saat ini." className="py-12" /></TableCell></TableRow>
            ) : (
                transactionPagination.paginatedItems.map((trx, index) => (
                    <TableRow key={trx.id} className="border-slate-100 hover:bg-blue-50/40 dark:border-slate-800 dark:hover:bg-slate-800/60">
                        <TableCell className="inventoryTableIndexCell">
                          {transactionPagination.startIndex + index + 1}
                        </TableCell>
                        <TableCell>
                          <span className={`inventoryStockTypeText is${trx.type}`}>{getTypeLabel(trx.type)}</span>
                        </TableCell>
                        <TableCell>
                            <TableText primary={trx.products?.name || 'Unknown Product'} secondary={formatStockDateLabel(trx.date)} />
                        </TableCell>
                        <TableCell>
                            <div className="inventoryOwnerStack">
                              <span>{getUserName(getTransactionTechnicianId(trx))}</span>
                              <small>{getBranchName(getTransactionBranchId(trx))}</small>
                            </div>
                        </TableCell>
                        <TableCell className="text-right font-bold">
                            <span className={`inventoryStockQtyText is${trx.type}`}>
                              {trx.quantity}
                            </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-500">
                            {formatStockCurrency(trx.unit_price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                            <span className={`inventoryStockQtyText is${trx.type}`}>
                              {formatStockCurrency(trx.total_value)}
                            </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] text-slate-500" title={trx.notes}>
                            <TableText primary={trx.notes || '-'} />
                        </TableCell>
                        {hasTransactionActions && (
                          <TableActionCell>
                            <TableActionMenu contentClassName="w-56">
                              {canEditTransaction && (
                                <TableActionMenuItem icon={Edit} onClick={() => openEditDialog(trx)}>
                                  {latestCancelableTransactionIds.has(trx.id) ? "Edit transaksi terbaru" : "Edit snapshot histori"}
                                </TableActionMenuItem>
                              )}
                              {canCancelTransaction && latestCancelableTransactionIds.has(trx.id) && (
                                <TableActionMenuItem danger icon={Trash2} onClick={() => setDeleteTarget(trx)}>
                                  Batalkan transaksi
                                </TableActionMenuItem>
                              )}
                            </TableActionMenu>
                          </TableActionCell>
                        )}
                    </TableRow>
                ))
            )}
          </TableBody>
        </table>
        </DataTable>
        <InventoryTablePagination {...transactionPagination} />
      </OperationalTableCard>

      {/* New Transaction Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <MasterDataFormDialogContent size="wide" className="inventoryProductFormDialog">
            <DialogHeader>
                <DialogTitle>{isEditMode ? 'Edit Transaksi Stok' : 'Catat Transaksi Stok'}</DialogTitle>
                <DialogDescription>
                    {isEditMode
                      ? (isEditingLatestTransaction
                          ? 'Perbarui transaksi terbaru per produk tanpa memutus konsistensi histori stok.'
                          : 'Edit qty atau Harga Beli transaksi lama — stok & HPP rata-rata dihitung ulang dari seluruh histori.')
                      : 'Pencatatan transaksi stok barang masuk, keluar, atau penyesuaian (opname).'}
                </DialogDescription>
            </DialogHeader>
            <form
              className="masterDataForm inventoryProductForm"
              onSubmit={(event) => {
                event.preventDefault();
                handleSubmit();
              }}
            >
            <MasterDataDialogBody className="inventoryProductFormBody">
                {isEditMode && (
                    <div className="inventoryFormNotice">
                        <strong>{isEditingLatestTransaction ? 'Mode edit transaksi terbaru' : 'Mode koreksi histori mutasi'}</strong>
                        <p>
                            {isEditingLatestTransaction
                              ? 'Produk tidak bisa diganti dari menu edit. Jika salah produk atau urutan tanggalnya perlu dipindah ke masa lalu, batalkan transaksi ini lalu catat ulang.'
                              : 'Qty dan Harga Beli bisa diperbaiki di sini; stok dan HPP rata-rata akan dihitung ulang dari seluruh histori saat disimpan.'}
                        </p>
                    </div>
                )}

                {historyScopeAvailable === false && (
                    <div className="inventoryFormNotice isWarning">
                        <strong>Snapshot histori mutasi belum tersimpan penuh</strong>
                        <p>Database live belum punya kolom snapshot cabang/teknisi pada histori mutasi. Simpan transaksi tetap jalan, tetapi dua field itu belum masuk penuh ke tabel histori sampai migration dijalankan.</p>
                    </div>
                )}

                {/* Tanggal */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel>Tanggal</MasterDataFieldLabel>
                    <Input 
                        type="date" 
                        className="uiInput"
                        value={formData.date} 
                        disabled={isEditMode && !isEditingLatestTransaction}
                        onChange={(e) => setFormData({...formData, date: e.target.value})}
                    />
                </div>

                {isEditMode && (
                  <div className="space-y-1.5">
                      <MasterDataFieldLabel required>Barang</MasterDataFieldLabel>
                      <Select
                          value={formData.productId}
                          onValueChange={handleProductChange}
                          disabled={isEditMode}
                      >
                          <SelectTrigger className="uiSelectTrigger">
                              <SelectValue placeholder="Pilih Barang" />
                          </SelectTrigger>
                          <SelectContent className="z-[200] max-h-[200px]">
                              {products.map(p => (
                                  <SelectItem key={p.id} value={p.id}>
                                      {p.name} (Stok: {p.current_qty} {p.unit}{p.stock_needs_review ? ' | sinkron histori' : ''})
                                  </SelectItem>
                              ))}
                          </SelectContent>
                      </Select>
                      {selectedProduct?.stock_needs_review && typeof selectedProduct.recorded_qty === 'number' && (
                        <p className="text-[11px] text-amber-700">
                          Data tabel lama menunjukkan {selectedProduct.recorded_qty} {selectedProduct.unit}, tetapi form ini memakai histori transaksi.
                        </p>
                      )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel>Cabang Mutasi</MasterDataFieldLabel>
                        <Select
                            value={formData.branchId || '_none_'}
                            onValueChange={(val) => setFormData((prev) => ({ ...prev, branchId: val === '_none_' ? '' : val }))}
                        >
                            <SelectTrigger className="uiSelectTrigger">
                                <SelectValue placeholder="Pilih Cabang" />
                            </SelectTrigger>
                            <SelectContent className="z-[200]">
                                <SelectItem value="_none_">
                                    <span className="text-slate-400">Belum ditentukan</span>
                                </SelectItem>
                                {activeBranches.map((branch) => (
                                    <SelectItem key={branch.id} value={branch.id}>
                                        {branch.name} {branch.city ? `(${branch.city})` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <MasterDataFieldLabel>Teknisi Mutasi</MasterDataFieldLabel>
                        <Select
                            value={formData.technicianId || '_none_'}
                            onValueChange={handleTechnicianChange}
                        >
                            <SelectTrigger className="uiSelectTrigger">
                                <SelectValue placeholder="Pilih Teknisi" />
                            </SelectTrigger>
                            <SelectContent className="z-[200] max-h-[260px]">
                                <SelectItem value="_none_">
                                    <span className="text-slate-400">Belum ditentukan</span>
                                </SelectItem>
                                {sameBranchTechnicians.length > 0 && (
                                    <SelectGroup>
                                        <SelectLabel>Teknisi Cabang Terpilih</SelectLabel>
                                        {sameBranchTechnicians.map((technician) => (
                                            <SelectItem key={technician.id} value={technician.id}>
                                                {technician.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                )}
                                {sameBranchTechnicians.length > 0 && otherActiveTechnicians.length > 0 && <SelectSeparator />}
                                {otherActiveTechnicians.length > 0 && (
                                    <SelectGroup>
                                        <SelectLabel>Teknisi Aktif Lainnya</SelectLabel>
                                        {otherActiveTechnicians.map((technician) => {
                                            const branchName = activeBranches.find((branch) => branch.id === technician.branchId)?.name;
                                            return (
                                                <SelectItem key={technician.id} value={technician.id}>
                                                    {technician.name}{branchName ? ` - ${branchName}` : ''}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectGroup>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Tipe */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel required>Tipe</MasterDataFieldLabel>
                    <Select 
                        value={formData.type} 
                        disabled={isEditMode && !isEditingLatestTransaction}
                        onValueChange={(val) => setFormData({...formData, type: val})}
                    >
                        <SelectTrigger className="uiSelectTrigger">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                            <SelectItem value="IN">Masuk (Pembelian)</SelectItem>
                            <SelectItem value="OUT">Keluar (Penjualan/Pakai)</SelectItem>
                            <SelectItem value="ADJUST">Adjustment (Opname +/-)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {isEditMode ? (
                  <>
                    {/* Qty */}
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel required>Qty</MasterDataFieldLabel>
                        <div className="relative">
                            <Input
                                type="number"
                                className="uiInput"
                                value={formData.quantity}
                                onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                                placeholder={selectedProduct ? `Qty (${selectedProduct.unit})` : 'Qty'}
                            />
                        </div>
                        {formData.type === 'ADJUST' && (
                            <p className="text-[10px] text-slate-500">Gunakan angka negatif untuk mengurangi stok (misal: -2).</p>
                        )}
                    </div>

                    {/* Harga Beli - only for IN */}
                    {formData.type === 'IN' && (
                        <div className="space-y-1.5">
                            <MasterDataFieldLabel required>Harga Beli</MasterDataFieldLabel>
                            <Input
                                type="number"
                                className="uiInput"
                                value={formData.unitPrice}
                                onChange={(e) => setFormData({...formData, unitPrice: e.target.value})}
                                placeholder="Harga satuan dalam Rupiah"
                            />
                        </div>
                    )}

                    {formData.type === 'OUT' && selectedProduct && (
                        <div className="inventoryFormNotice isWarning">
                            Harga keluar akan menggunakan HPP Rata-rata saat ini:
                            <b> {formatStockCurrency(selectedProduct.average_cost)}</b>
                        </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <MasterDataFieldLabel required>Daftar Barang</MasterDataFieldLabel>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Tambahkan beberapa barang untuk tipe transaksi dan tanggal yang sama.
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addBatchItem} icon={<Plus className="h-3.5 w-3.5" />}>
                        Tambah
                      </Button>
                    </div>

                    <div className="space-y-2.5">
                      {batchItems.map((item, index) => {
                        const rowProduct = products.find((product) => product.id === item.productId);
                        const rowPreview = batchTransactionPreview.find((preview) => preview.itemId === item.id);

                        return (
                          <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-500">Barang {index + 1}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={batchItems.length === 1}
                                onClick={() => removeBatchItem(item.id)}
                                className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                                title="Hapus baris"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>

                            <div className="space-y-2">
                              <Select
                                  value={item.productId}
                                  onValueChange={(productId) => handleBatchProductChange(item.id, productId)}
                              >
                                  <SelectTrigger className="uiSelectTrigger">
                                      <SelectValue placeholder="Pilih Barang" />
                                  </SelectTrigger>
                                  <SelectContent className="z-[200] max-h-[240px]">
                                      {products.map(p => (
                                          <SelectItem key={p.id} value={p.id}>
                                              {p.name} (Stok: {p.current_qty} {p.unit}{p.stock_needs_review ? ' | sinkron histori' : ''})
                                          </SelectItem>
                                      ))}
                                  </SelectContent>
                              </Select>

                              <div className={formData.type === 'IN' ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
                                <div className="relative">
                                  <Input
                                      type="number"
                                      className="uiInput"
                                      value={item.quantity}
                                      onChange={(event) => updateBatchItem(item.id, { quantity: event.target.value })}
                                      placeholder={rowProduct ? `Qty (${rowProduct.unit})` : 'Qty'}
                                  />
                                </div>

                                {formData.type === 'IN' && (
                                  <div className="relative">
                                    <Input
                                        type="number"
                                        className="uiInput"
                                        value={item.unitPrice}
                                        onChange={(event) => updateBatchItem(item.id, { unitPrice: event.target.value })}
                                        placeholder="Harga dalam Rupiah"
                                    />
                                  </div>
                                )}
                              </div>

                              {rowProduct?.stock_needs_review && typeof rowProduct.recorded_qty === 'number' && (
                                <p className="text-[11px] text-amber-700">
                                  Tabel lama {rowProduct.recorded_qty} {rowProduct.unit}; form memakai histori transaksi.
                                </p>
                              )}
                              {formData.type === 'ADJUST' && (
                                <p className="text-[10px] text-slate-500">Gunakan angka negatif untuk mengurangi stok.</p>
                              )}
                              {formData.type === 'OUT' && rowProduct && (
                                <p className="text-[11px] text-yellow-700">
                                  HPP saat ini: {formatStockCurrency(rowProduct.average_cost)}
                                </p>
                              )}
                              {rowPreview?.error && (
                                <p className="text-[11px] text-red-600">{rowPreview.error}</p>
                              )}
                              {rowPreview && !rowPreview.error && rowPreview.product && rowPreview.afterQty != null && (
                                <div className="flex justify-between rounded-lg bg-white px-2 py-1.5 text-[11px] text-slate-500">
                                  <span>
                                    Stok: {rowPreview.beforeQty} → <b className="text-slate-700">{rowPreview.afterQty} {rowPreview.product.unit}</b>
                                  </span>
                                  <span className="font-medium text-emerald-600">
                                    {formatStockCurrency(rowPreview.totalValue)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Catatan */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel>Catatan</MasterDataFieldLabel>
                    <Input 
                        className="uiInput"
                        value={formData.notes} 
                        onChange={(e) => setFormData({...formData, notes: e.target.value})}
                        placeholder="Contoh: Pembelian Toko A, Pemakaian Cuci Mobil B 1234 XX" 
                    />
                </div>

                {!isEditMode && batchPreviewTotals.filledRows > 0 && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-2 text-xs font-medium text-slate-500">Ringkasan Batch</p>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Jumlah Barang</span>
                            <span className="font-medium text-slate-700">{batchPreviewTotals.filledRows}</span>
                        </div>
                        <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-xs">
                            <span className="text-slate-500">Estimasi Total Nilai</span>
                            <span className="font-semibold text-emerald-600">{formatStockCurrency(batchPreviewTotals.totalValue)}</span>
                        </div>
                        {batchPreviewTotals.hasError && (
                            <p className="mt-2 text-[11px] text-red-600">
                                Ada baris yang belum valid. Perbaiki baris bertanda merah sebelum menyimpan.
                            </p>
                        )}
                    </div>
                )}

                {/* Summary Preview */}
                {isEditMode && selectedProduct && transactionPreview && (
                    <div className="bg-slate-50 rounded-lg p-3 space-y-1.5 border border-slate-100">
                        <p className="text-xs font-medium text-slate-500 mb-2">Ringkasan Transaksi</p>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Produk</span>
                            <span className="text-slate-700 font-medium">{selectedProduct.name}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500">
                                {isEditMode
                                  ? (isEditingLatestTransaction ? 'Stok Sebelum Transaksi Ini' : 'Stok Referensi Saat Ini')
                                  : 'Stok Saat Ini'}
                            </span>
                            <span className="text-slate-700 font-medium">
                                {transactionPreview.beforeQty ?? selectedProduct.current_qty} {selectedProduct.unit}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Cabang Mutasi</span>
                            <span className="text-slate-700 font-medium">{selectedBranch?.name || '-'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Teknisi Mutasi</span>
                            <span className="text-slate-700 font-medium">{selectedTechnician?.name || '-'}</span>
                        </div>
                        {isEditMode && formData.type === 'IN' && formData.unitPrice && !transactionPreview.error && transactionPreview.totalValue != null && (
                            <div className="flex justify-between text-xs border-t border-slate-200 pt-1.5 mt-1.5">
                                <span className="text-slate-500">Total Pembelian</span>
                                <span className="text-emerald-600 font-medium">
                                    {formatStockCurrency(transactionPreview.totalValue)}
                                </span>
                            </div>
                        )}
                        {!transactionPreview.error && isEditingLatestTransaction ? (
                            <div className="flex justify-between text-xs border-t border-slate-200 pt-1.5 mt-1.5">
                                <span className="text-slate-500">Stok Setelah</span>
                                <span className={`font-bold ${formData.type === 'OUT' ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {transactionPreview.afterQty} {selectedProduct.unit}
                                </span>
                            </div>
                        ) : !transactionPreview.error && isEditMode && !isEditingLatestTransaction ? (
                            <div className="border-t border-slate-200 pt-1.5 mt-1.5 text-[11px] text-slate-500">
                                Stok berjalan & HPP rata-rata akan dihitung ulang dari seluruh histori saat disimpan.
                            </div>
                        ) : (
                            <div className="border-t border-slate-200 pt-1.5 mt-1.5 text-[11px] text-red-600">
                                {transactionPreview.error}
                            </div>
                        )}
                    </div>
                )}
                <MasterDataFormActions
                    isSubmitting={loading}
                    onCancel={() => handleDialogOpenChange(false)}
                    saveLabel={isEditMode ? 'Simpan Perubahan' : 'Simpan Transaksi'}
                />
            </MasterDataDialogBody>
            </form>
        </MasterDataFormDialogContent>
      </Dialog>

      {/* Konfirmasi Batalkan Transaksi */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="sm:max-w-[440px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-slate-900">Batalkan Transaksi?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-500 space-y-1">
              <span>Transaksi ini akan dihapus dan stok produk akan dikembalikan ke kondisi sebelumnya.</span>
              {deleteTarget && (
                <span className="block mt-2 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs space-y-1">
                  <span className="flex justify-between">
                    <span className="text-slate-400">Produk</span>
                    <span className="font-medium text-slate-700">{deleteTarget.products?.name || '-'}</span>
                  </span>
                  <span className="flex justify-between">
                    <span className="text-slate-400">Tipe</span>
                    <span className="font-medium text-slate-700">{deleteTarget.type}</span>
                  </span>
                  <span className="flex justify-between">
                    <span className="text-slate-400">Qty</span>
                    <span className="font-medium text-slate-700">{deleteTarget.quantity}</span>
                  </span>
                  <span className="flex justify-between">
                    <span className="text-slate-400">Cabang</span>
                    <span className="font-medium text-slate-700">{getBranchName(getTransactionBranchId(deleteTarget))}</span>
                  </span>
                  <span className="flex justify-between">
                    <span className="text-slate-400">Teknisi</span>
                    <span className="font-medium text-slate-700">{getUserName(getTransactionTechnicianId(deleteTarget))}</span>
                  </span>
                  <span className="flex justify-between">
                    <span className="text-slate-400">Tanggal</span>
                    <span className="font-medium text-slate-700">
                      {deleteTarget.date ? format(new Date(deleteTarget.date), 'dd MMM yyyy', { locale: idLocale }) : '-'}
                    </span>
                  </span>
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && handleDeleteTransaction(deleteTarget)}
            >
              Ya, Batalkan Transaksi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isScopeInfoDialogOpen} onOpenChange={setIsScopeInfoDialogOpen}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-slate-900">Detail Snapshot Mutasi</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-sm text-slate-500">
              <span className="block rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                <span className="flex justify-between gap-4">
                  <span className="text-slate-400">Cabang Mutasi</span>
                  <span className="font-medium text-slate-700">{selectedBranch?.name || '-'}</span>
                </span>
                <span className="mt-2 flex justify-between gap-4">
                  <span className="text-slate-400">Teknisi Mutasi</span>
                  <span className="font-medium text-slate-700">{selectedTechnician?.name || '-'}</span>
                </span>
              </span>
              <span className="block">
                {isEditMode && !isEditingLatestTransaction
                  ? 'Pilihan ini hanya memperbarui histori mutasi lama dan tidak mengubah stok maupun owner aktif produk.'
                  : 'Pilihan ini tersimpan ke histori transaksi dan sekaligus memperbarui status owner aktif produk.'}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">Tutup</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
