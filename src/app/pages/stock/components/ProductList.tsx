import React, { useState, useEffect } from 'react';
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Plus, Search, Edit, Trash2, RefreshCcw, Loader2, Wand2, Check, ChevronsUpDown, ClipboardList, Boxes, PackageCheck, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/app/components/ui/badge";
import { useMasterData } from "@/app/pages/master-data/context";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/app/components/ui/command";
import { cn } from "@/app/components/ui/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/app/components/ui/alert-dialog";
import { usePermissions } from "@/app/hooks/usePermissions";
import { logActivity } from "@/app/services/auditService";
import { StockCard } from "./StockCard";
import { STOCK_UPDATED_EVENT, emitStockUpdated, groupTransactionsByProduct, reconcileProductStock, toStockNumber, type StockTransactionLike } from "../utils/stockLedger";
import { isMissingStockTransactionScopeColumnError, omitStockTransactionScope, retryWithoutInvalidStockScope, type StockScopeField } from "../utils/stockTransactionScope";
import { isTechnicianRole } from "@/app/data/roleHelpers";
import { createDataTableColumns, DataTable, TableActionCell, TableActionHeader, TableActionMenu, TableActionMenuItem, TableText } from "@/app/components/ui/data-table";
import { MasterDataDialogBody, MasterDataFormActions, MasterDataFieldLabel, MasterDataFormDialogContent } from "@/app/components/ui/master-data-ui";
import { MasterDataTableTitle } from "@/app/components/ui/master-data-table-title";
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalTableCard,
} from "@/app/components/ui/operational-page";
import { InventoryTablePagination, useInventoryTablePagination } from "./InventoryTablePagination";
import { FilterRow } from '@/app/components/ui/control-layout';

interface Product {
  id: string;
  sku?: string;
  name: string;
  category: string;
  service_type: string;
  unit: string;
  branch_id?: string;
  technician_id?: string;
  current_qty: number;
  average_cost: number;
  sell_price?: number;
  min_stock?: number;
  description?: string;
  updated_at?: string;
  recorded_qty?: number;
  recorded_average_cost?: number;
  stock_delta?: number;
  stock_value_delta?: number;
  stock_has_transactions?: boolean;
  stock_needs_review?: boolean;
}

interface ReferenceData {
    id: string;
    name: string;
}

interface ProductPayload extends Record<string, unknown> {
  name: string;
  category: string;
  service_type: string;
  unit: string;
  branch_id: string | null;
  technician_id: string | null;
  min_stock: number;
  sell_price: number;
  description: string;
  updated_at?: string;
  sku?: string;
  current_qty?: number;
  average_cost?: number;
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || error);
  }

  return String(error);
};

const formatInventoryNumber = (value: number | string | null | undefined, maximumFractionDigits = 2) =>
  toStockNumber(value).toLocaleString('id-ID', {
    maximumFractionDigits,
  });

const formatInventoryCurrency = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(toStockNumber(value));

const formatInventoryUnitPrice = (value: number | string | null | undefined, unit?: string) =>
  `${formatInventoryCurrency(value)}${unit ? ` / ${unit}` : ''}`;

export function ProductList() {
  const { services, activeBranches, users, currentUser } = useMasterData();
  const { hasPermission } = usePermissions();
  const activeServices = services.filter(s => s.status === 'active');
  const canCreateProduct = hasPermission('inventory.create');
  const canEditProduct = hasPermission('inventory.edit');
  const canDeleteProduct = hasPermission('inventory.delete');
  const canViewStockCard = hasPermission('stock.card.view');
  const hasProductActions = canViewStockCard || canEditProduct || canDeleteProduct;

  // Filter technicians from users list
  const technicians = users.filter(u => isTechnicianRole(u.role) && u.status === 'active');

  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<ReferenceData[]>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Unit Combobox State
  const [unitPopoverOpen, setUnitPopoverOpen] = useState(false);
  const [unitSearch, setUnitSearch] = useState("");

  // Category Combobox State
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");

  // Form validation state
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<Partial<Product>>({});
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  // Kartu Stok State
  const [stockCardOpen, setStockCardOpen] = useState(false);
  const [stockCardProduct, setStockCardProduct] = useState<Product | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
      sku: '',
      name: '',
      category: '',
      service_type: '',
      unit: '',
      branch_id: '',
      technician_id: '',
      min_stock: '0',
      sell_price: '0',
      description: '',
      initial_qty: '0', // Only for new products
      initial_cost: '0' // Only for new products
  });

  useEffect(() => {
    fetchData();

    const handleStockUpdate = () => {
      fetchData();
    };

    window.addEventListener(STOCK_UPDATED_EVENT, handleStockUpdate);
    return () => window.removeEventListener(STOCK_UPDATED_EVENT, handleStockUpdate);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
        const [productsRes, transactionsRes, unitsRes] = await Promise.all([
            supabase.from('products').select('*').order('name', { ascending: true }),
            supabase
              .from('stock_transactions')
              .select('id, product_id, type, quantity, unit_price, total_value, date, created_at'),
            supabase.from('stock_units').select('*').order('name', { ascending: true })
        ]);

        if (productsRes.error) throw productsRes.error;
        if (transactionsRes.error) throw transactionsRes.error;
        if (unitsRes.error) throw unitsRes.error;

        const transactionsByProduct = groupTransactionsByProduct((transactionsRes.data || []) as StockTransactionLike[]);
        const nextProducts = (productsRes.data || []).map((product) => {
          const stockState = reconcileProductStock(product, transactionsByProduct.get(product.id) || []);
          return {
            ...product,
            current_qty: stockState.effectiveQty,
            average_cost: stockState.effectiveAverageCost,
            recorded_qty: stockState.recordedQty,
            recorded_average_cost: stockState.recordedAverageCost,
            stock_delta: stockState.quantityDelta,
            stock_value_delta: stockState.averageCostDelta,
            stock_has_transactions: stockState.hasTransactions,
            stock_needs_review: stockState.hasMismatch,
          } as Product;
        });

        setProducts(nextProducts);
        setUnits(unitsRes.data || []);

    } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Gagal memuat data produk");
    } finally {
        setLoading(false);
    }
  };

  const getScopeCompatibilityMessages = (fields: StockScopeField[], target: 'product' | 'history') => {
    const messages: string[] = [];

    if (fields.includes('branch_id')) {
      messages.push(
        target === 'product'
          ? "Cabang owner produk belum ikut tersimpan karena schema `products.branch_id` masih format lama."
          : "Cabang saldo awal belum ikut tersimpan ke histori transaksi karena schema `stock_transactions.branch_id` masih format lama."
      );
    }

    if (fields.includes('technician_id')) {
      messages.push(
        target === 'product'
          ? "Teknisi owner produk belum ikut tersimpan karena schema `products.technician_id` masih format lama."
          : "Teknisi saldo awal belum ikut tersimpan ke histori transaksi karena schema `stock_transactions.technician_id` masih format lama."
      );
    }

    return messages;
  };

  const saveProductWithScopeCompatibility = async (payload: ProductPayload, productId?: string) => {
    const result = await retryWithoutInvalidStockScope(payload, async (nextPayload) => {
      if (productId) {
        return await supabase
          .from('products')
          .update(nextPayload)
          .eq('id', productId)
          .select();
      }

      return await supabase
        .from('products')
        .insert([nextPayload])
        .select();
    });

    if (result.error) throw result.error;

    if (result.omittedScopeFields.length > 0) {
      console.warn(
        `[Stock] Simpan products memakai fallback kompatibilitas tanpa scope: ${result.omittedScopeFields.join(', ')}`
      );
    }

    return {
      data: result.data || [],
      omittedScopeFields: result.omittedScopeFields,
    };
  };

  const handleSave = async () => {
    if (isEditMode && !canEditProduct) {
      toast.error("Anda tidak memiliki izin untuk mengubah produk");
      return;
    }

    if (!isEditMode && !canCreateProduct) {
      toast.error("Anda tidak memiliki izin untuk menambah produk");
      return;
    }

    // Validate required fields
    const errors: Record<string, string> = {};
    if (!isEditMode && !formData.sku.trim()) errors.sku = "SKU / Kode wajib diisi";
    if (!formData.name.trim()) errors.name = "Nama Barang wajib diisi";
    if (!formData.service_type) errors.service_type = "Jenis Layanan wajib dipilih";
    if (!formData.unit) errors.unit = "Satuan wajib dipilih";
    if (Number(formData.min_stock) < 0) errors.min_stock = "Minimum stok tidak boleh negatif";
    if (Number(formData.sell_price) < 0) errors.sell_price = "Harga jual tidak boleh negatif";
    if (!isEditMode && Number(formData.initial_qty) < 0) {
      errors.initial_qty = "Stok awal tidak boleh negatif";
    }
    if (!isEditMode && Number(formData.initial_qty) > 0 && Number(formData.initial_cost) <= 0) {
      errors.initial_cost = "HPP Awal wajib diisi";
    }

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Mohon lengkapi semua field wajib yang ditandai *");
      return;
    }

    setLoading(true);
    try {
        const openingQty = Number(formData.initial_qty);
        const openingCost = Number(formData.initial_cost || 0);
        const compatibilityWarnings = new Set<string>();
        let savedProductId = currentProduct.id || '';
        const payload: ProductPayload = {
            name: formData.name,
            category: formData.category,
            service_type: formData.service_type,
            unit: formData.unit,
            branch_id: formData.branch_id || null,
            technician_id: formData.technician_id || null,
            min_stock: Number(formData.min_stock),
            sell_price: Number(formData.sell_price),
            description: formData.description,
        };

        if (isEditMode && currentProduct.id) {
            // SKU tidak diubah saat edit
            payload.updated_at = new Date().toISOString();
            console.log('[Edit Product] Payload:', JSON.stringify(payload));
            console.log('[Edit Product] ID:', currentProduct.id);
            
            const { data, omittedScopeFields } = await saveProductWithScopeCompatibility(payload, currentProduct.id);
            getScopeCompatibilityMessages(omittedScopeFields, 'product').forEach((message) => compatibilityWarnings.add(message));
            savedProductId = data?.[0]?.id || currentProduct.id || '';
            
            console.log('[Edit Product] Response data:', data);
            
            if (!data || data.length === 0) {
                console.warn('[Edit Product] No rows updated — kemungkinan RLS atau ID tidak ditemukan');
                toast.error("Produk tidak ditemukan atau tidak bisa diupdate");
                setLoading(false);
                return;
            }
        } else {
            // SKU hanya di-set saat tambah baru
            payload.sku = formData.sku;
            // Initial Stock (Treat as opening balance)
            payload.current_qty = openingQty;
            payload.average_cost = openingQty > 0 ? openingCost : 0;
            
            console.log('[Add Product] Payload:', JSON.stringify(payload));
            
            const { data, omittedScopeFields } = await saveProductWithScopeCompatibility(payload);
            getScopeCompatibilityMessages(omittedScopeFields, 'product').forEach((message) => compatibilityWarnings.add(message));
            
            console.log('[Add Product] Response data:', data);

            const insertedProduct = data?.[0];
            if (!insertedProduct) {
                throw new Error("Produk baru gagal dibaca setelah disimpan");
            }
            savedProductId = insertedProduct.id;

            if (openingQty > 0) {
                const openingTransaction = {
                    product_id: insertedProduct.id,
                    type: 'IN' as const,
                    quantity: openingQty,
                     unit_price: openingCost,
                     total_value: openingQty * openingCost,
                     branch_id: formData.branch_id || null,
                     technician_id: formData.technician_id || null,
                     notes: 'Saldo awal produk',
                    date: new Date().toISOString().split('T')[0],
                };

                    const openingResult = await retryWithoutInvalidStockScope(openingTransaction, async (nextPayload) =>
                    await supabase
                        .from('stock_transactions')
                        .insert([nextPayload])
                );

                let openingError = openingResult.error;
                getScopeCompatibilityMessages(openingResult.omittedScopeFields, 'history').forEach((message) => compatibilityWarnings.add(message));

                if (openingError && isMissingStockTransactionScopeColumnError(openingError)) {
                    console.warn("[Stock] Kolom snapshot branch/technician belum ada di stock_transactions. Saldo awal tetap disimpan tanpa scope histori.");
                    const retry = await supabase
                        .from('stock_transactions')
                        .insert([omitStockTransactionScope(openingTransaction)]);
                    openingError = retry.error;
                    if (!openingError) {
                        compatibilityWarnings.add("Snapshot cabang dan teknisi saldo awal belum ikut tersimpan ke histori transaksi karena kolom scope di `stock_transactions` belum ada di database.");
                    }
                }

                if (openingError) {
                    await supabase.from('products').delete().eq('id', insertedProduct.id);
                    throw new Error(`Produk tersimpan tetapi transaksi saldo awal gagal dibuat: ${getErrorMessage(openingError)}`);
                }
            }
        }
        
        toast.success(isEditMode ? "Produk diperbarui" : "Produk ditambahkan");
        if (compatibilityWarnings.size > 0) {
          toast.warning(Array.from(compatibilityWarnings).join(' '), {
            duration: 7000,
          });
        }
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            isEditMode ? 'UPDATE' : 'CREATE',
            'Inventaris',
            `${isEditMode ? 'Memperbarui' : 'Menambahkan'} produk: ${formData.name} (${formData.sku})`,
            savedProductId
          );
        }
        setIsDialogOpen(false);
        emitStockUpdated();

    } catch (error: any) {
        console.error("Error saving product:", error);
        toast.error(`Gagal menyimpan produk: ${error.message || error}`);
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDeleteProduct) {
        toast.error("Anda tidak memiliki izin untuk menghapus produk");
        return;
    }

    try {
        // Cek apakah ada transaksi terkait
        const { count, error: countError } = await supabase
            .from('stock_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('product_id', id);

        if (countError) throw countError;

        if (count && count > 0) {
            toast.error(`Tidak bisa hapus: produk memiliki ${count} transaksi terkait. Batalkan transaksinya terlebih dahulu.`);
            setDeleteTarget(null);
            return;
        }

        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id);

        if (error) throw error;

        toast.success("Produk dihapus");
        const deletedProduct = products.find(p => p.id === id);
        if (currentUser && deletedProduct) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'DELETE',
            'Inventaris',
            `Menghapus produk: ${deletedProduct.name} (${deletedProduct.sku})`,
            id
          );
        }
        setProducts(products.filter(p => p.id !== id));
        emitStockUpdated();
    } catch (error: any) {
        if (!error.message?.includes('transaksi')) {
            toast.error("Gagal menghapus produk");
        }
    } finally {
        setDeleteTarget(null);
    }
  };

  const openAddDialog = () => {
    if (!canCreateProduct) {
      toast.error("Anda tidak memiliki izin untuk menambah produk");
      return;
    }

    setIsEditMode(false);
    setFormErrors({});
    setFormData({
        sku: '', 
        name: '', 
        category: '', 
        service_type: '', 
        unit: '', 
        branch_id: '',
        technician_id: '',
        min_stock: '0', 
        sell_price: '0', 
        description: '', 
        initial_qty: '0', 
        initial_cost: '0'
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (product: Product) => {
    if (!canEditProduct) {
      toast.error("Anda tidak memiliki izin untuk mengubah produk");
      return;
    }

    setIsEditMode(true);
    setFormErrors({});
    setCurrentProduct(product);
    setFormData({
        sku: product.sku || '',
        name: product.name,
        category: product.category || '',
        service_type: product.service_type || '',
        unit: product.unit || '',
        branch_id: product.branch_id || '',
        technician_id: product.technician_id || '',
        min_stock: String(product.min_stock || 0),
        sell_price: String(product.sell_price || 0),
        description: product.description || '',
        initial_qty: String(product.current_qty), 
        initial_cost: String(product.average_cost) 
    });
    setIsDialogOpen(true);
  };

  // Filter Logic
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = categoryFilter === 'all' || p.service_type === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Calculate Summary
  const totalItems = filteredProducts.length;
  const totalValue = filteredProducts.reduce((sum, p) => sum + (toStockNumber(p.current_qty) * toStockNumber(p.average_cost)), 0);
  const lowStockCount = filteredProducts.filter((product) => product.current_qty <= (product.min_stock || 0)).length;
  const productPagination = useInventoryTablePagination(filteredProducts, `${searchTerm}|${categoryFilter}`);

  const generateSKU = () => {
    let prefix = 'PRD';
    if (formData.category && formData.category.length >= 3) {
        prefix = formData.category.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '');
    }
    const random = Math.floor(1000 + Math.random() * 9000); // 4 digit random
    const newSku = `${prefix}-${random}`;
    setFormData(prev => ({ ...prev, sku: newSku }));
  };

  // Create new unit and add to list
  const handleCreateUnit = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
        const { data, error } = await supabase
            .from('stock_units')
            .insert([{ name: trimmed }])
            .select();
        if (error) {
            if (error.code === '23505') {
                toast.error("Satuan sudah ada");
            } else {
                throw error;
            }
            return;
        }
        setUnits(prev => [...prev, data[0]]);
        setFormData(prev => ({ ...prev, unit: trimmed }));
        setUnitSearch("");
        setUnitPopoverOpen(false);
        toast.success(`Satuan "${trimmed}" ditambahkan`);
    } catch (err) {
        toast.error("Gagal menyimpan satuan baru");
    }
  };

  // Check if unitSearch matches an existing unit
  const unitSearchTrimmed = unitSearch.trim().toLowerCase();
  const filteredUnits = units.filter(u => u.name.toLowerCase().includes(unitSearchTrimmed));
  const exactUnitMatch = units.some(u => u.name.toLowerCase() === unitSearchTrimmed);

  // Category combobox: unique categories from existing products
  const uniqueCategories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
  const categorySearchTrimmed = categorySearch.trim().toLowerCase();
  const filteredCategories = uniqueCategories.filter(c => c.toLowerCase().includes(categorySearchTrimmed));
  const exactCategoryMatch = uniqueCategories.some(c => c.toLowerCase() === categorySearchTrimmed);

  return (
    <div className="inventoryTabStack">
      {/* Filters & Actions */}
      <OperationalFilterPanel className="inventoryFilterPanel">
        <FilterRow className="inventoryFilterGrid inventoryFilterGridProducts">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input 
                    placeholder="Cari nama barang..." 
                    className="uiInput pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
             </div>
             <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="uiSelectTrigger">
                    <SelectValue placeholder="Filter Layanan" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Semua Layanan</SelectItem>
                    {activeServices.map((type) => (
                        <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
                    ))}
                </SelectContent>
             </Select>
        </FilterRow>
        <div className="inventoryFilterActions">
            <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
                <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {canCreateProduct && (
                <Button onClick={openAddDialog} icon={<Plus className="h-4 w-4" />} className="inventoryPrimaryButton">
                    Tambah Produk
                </Button>
            )}
        </div>
      </OperationalFilterPanel>

      {/* Summary Cards */}
      <OperationalKpiGrid className="inventoryKpiGrid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <OperationalKpiCard label="Total Produk" value={totalItems} icon={Boxes} tone="blue" />
          <OperationalKpiCard
            label="Total Nilai Aset"
            value={formatInventoryCurrency(totalValue)}
            icon={WalletCards}
            tone="emerald"
            className="xl:col-span-2"
          />
          <OperationalKpiCard label="Perlu Restock" value={lowStockCount} icon={PackageCheck} tone={lowStockCount > 0 ? "amber" : "default"} />
      </OperationalKpiGrid>

      {/* Table */}
      <OperationalTableCard className="inventoryTableCard">
        <MasterDataTableTitle title="Data Produk Aktif" count={filteredProducts.length} variant="active" />
        <DataTable
          actionWidth={hasProductActions ? 82 : undefined}
          cellY={12}
          columns={createDataTableColumns([
            'number',
            'name',
            'text',
            'text',
            'text',
            'quantity',
            'money',
            'money',
            'money',
            hasProductActions && 'action',
          ])}
          className="inventoryProductTable"
          rowMinHeight={66}
          textMax={260}
        >
        <table>
          <TableHeader>
            <TableRow>
              <TableHead>No</TableHead>
              <TableHead>Nama Barang</TableHead>
              <TableHead>Layanan</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Teknisi/Cabang</TableHead>
              <TableHead className="text-right">Stok</TableHead>
              <TableHead className="text-right">HPP (Avg)</TableHead>
              <TableHead className="text-right">Harga Jual</TableHead>
              <TableHead className="text-right">Total Nilai</TableHead>
              {hasProductActions && <TableActionHeader />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && products.length === 0 ? (
                 <TableRow>
                    <TableCell colSpan={hasProductActions ? 10 : 9} className="h-32 text-center border-0">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    </TableCell>
                 </TableRow>
            ) : filteredProducts.length === 0 ? (
                 <TableRow>
                    <TableCell colSpan={hasProductActions ? 10 : 9} className="border-0">
                        <OperationalEmptyState icon={Boxes} title="Tidak ada data produk" description="Belum ada produk yang cocok dengan filter saat ini." className="py-12" />
                    </TableCell>
                 </TableRow>
            ) : (
                productPagination.paginatedItems.map((product, index) => (
                    <TableRow
                      key={product.id}
                      className={cn(
                        "cursor-pointer border-slate-100 hover:bg-blue-50/40 dark:border-slate-800 dark:hover:bg-slate-800/60",
                        product.stock_needs_review && "bg-amber-50/30 dark:bg-amber-950/10",
                        product.current_qty <= (product.min_stock || 0) && !product.stock_needs_review && "bg-red-50/20 dark:bg-red-950/10"
                      )}
                      onClick={() => setDetailProduct(product)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDetailProduct(product);
                        }
                      }}
                    >
                        <TableCell className="inventoryTableIndexCell">
                            {productPagination.startIndex + index + 1}
                        </TableCell>
                        <TableCell>
                            <div className="inventoryProductNameCell">
                              <span
                                className={cn(
                                  "inventoryProductStatusDot",
                                  product.stock_needs_review
                                    ? "isAudit"
                                    : product.current_qty <= (product.min_stock || 0)
                                    ? "isLow"
                                    : "isOk"
                                )}
                              />
                              <TableText
                                primary={product.name}
                                secondary={product.sku || 'SKU belum diisi'}
                                className="inventoryProductText"
                              />
                            </div>
                            <div className="inventoryProductBadges">
                              {product.current_qty <= (product.min_stock || 0) && (
                                <Badge variant="destructive" className="inventoryStatusBadge">Low Stock</Badge>
                              )}
                              {product.stock_needs_review && (
                                <Badge className="inventoryStatusBadge inventoryStatusBadgeAudit">
                                  Audit Histori
                                </Badge>
                              )}
                            </div>
                            {product.stock_needs_review && typeof product.recorded_qty === 'number' && (
                              <p className="inventoryAuditNote">
                                Data tersimpan: {formatInventoryNumber(product.recorded_qty)} {product.unit}
                              </p>
                            )}
                        </TableCell>
                        <TableCell>
                            <span className="inventoryPlainCellText">{product.service_type || '-'}</span>
                        </TableCell>
                        <TableCell>
                            <span className="inventoryPlainCellText">
                              {product.category || '-'}
                            </span>
                        </TableCell>
                        <TableCell>
                            <div className="inventoryOwnerStack">
                              <span>{product.technician_id ? (users.find(u => u.id === product.technician_id)?.name || '-') : '-'}</span>
                              <small>{product.branch_id ? (activeBranches.find(b => b.id === product.branch_id)?.name || '-') : '-'}</small>
                            </div>
                        </TableCell>
                        <TableCell className="inventoryNumericCell">
                            <span className={cn("inventoryQtyValue", product.current_qty <= (product.min_stock || 0) ? "isLow" : "isOk")}>
                              {formatInventoryNumber(product.current_qty)}
                            </span>
                            <span className="inventoryQtyUnit">{product.unit}</span>
                        </TableCell>
                        <TableCell className={cn("inventoryMoneyCell", product.stock_needs_review && "isAudit")}>
                            <span className="inventoryMoneyValue">{formatInventoryCurrency(product.average_cost)}</span>
                            <span className="inventoryMoneyMeta">per {product.unit}</span>
                            {product.stock_needs_review && typeof product.recorded_average_cost === 'number' && (
                              <span className="inventoryMoneyWarning">
                                Tabel lama: {formatInventoryCurrency(product.recorded_average_cost)}
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="inventoryMoneyCell">
                             {product.sell_price ? (
                                <>
                                    <span className="inventoryMoneyValue isSell">{formatInventoryCurrency(product.sell_price)}</span>
                                    <span className="inventoryMoneyMeta">per {product.unit}</span>
                                </>
                             ) : '-'}
                        </TableCell>
                        <TableCell className="inventoryMoneyCell">
                            <span className="inventoryMoneyValue isAsset">{formatInventoryCurrency(product.current_qty * product.average_cost)}</span>
                        </TableCell>
                        {hasProductActions && (
                            <TableActionCell>
                                <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                                <TableActionMenu contentClassName="w-48">
                                    {canViewStockCard && (
                                        <TableActionMenuItem icon={ClipboardList} onClick={() => { setStockCardProduct(product); setStockCardOpen(true); }}>
                                            Kartu Stok
                                        </TableActionMenuItem>
                                    )}
                                    {canEditProduct && (
                                        <TableActionMenuItem icon={Edit} onClick={() => openEditDialog(product)}>
                                            Edit Detail
                                        </TableActionMenuItem>
                                    )}
                                    {canDeleteProduct && (
                                        <TableActionMenuItem danger icon={Trash2} onClick={() => setDeleteTarget(product)}>
                                            Hapus
                                        </TableActionMenuItem>
                                    )}
                                </TableActionMenu>
                                </div>
                            </TableActionCell>
                        )}
                    </TableRow>
                ))
            )}
          </TableBody>
        </table>
        </DataTable>
        <InventoryTablePagination {...productPagination} />
      </OperationalTableCard>

      {/* Dialog Form */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <MasterDataFormDialogContent size="wide" className="inventoryProductFormDialog">
            <DialogHeader>
                <DialogTitle>{isEditMode ? 'Edit Produk' : 'Tambah Produk Baru'}</DialogTitle>
                <DialogDescription>
                    {isEditMode ? 'Perbarui informasi detail produk.' : 'Isi data untuk menambahkan produk baru.'}
                </DialogDescription>
            </DialogHeader>
            <form
              className="masterDataForm inventoryProductForm"
              onSubmit={(event) => {
                event.preventDefault();
                handleSave();
              }}
            >
            <MasterDataDialogBody className="inventoryProductFormBody">
                {/* Row 1: Kategori + SKU */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel>Kategori</MasterDataFieldLabel>
                        <Popover open={categoryPopoverOpen} onOpenChange={(open) => { setCategoryPopoverOpen(open); if (!open) setCategorySearch(""); }}>
                            <PopoverTrigger asChild>
                                <Button
                                      type="button"
                                      variant="outline"
                                    role="combobox"
                                    aria-expanded={categoryPopoverOpen}
                                    className="uiSelectTrigger w-full justify-between"
                                >
                                    {formData.category || <span className="text-muted-foreground">Pilih kategori...</span>}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 z-[200]" align="start">
                                <Command shouldFilter={false}>
                                    <CommandInput placeholder="Cari atau ketik kategori baru..." value={categorySearch} onValueChange={setCategorySearch} />
                                    <CommandList>
                                        {filteredCategories.length === 0 && !categorySearch.trim() && (
                                            <CommandEmpty>Belum ada kategori. Ketik untuk membuat baru.</CommandEmpty>
                                        )}
                                        {filteredCategories.length > 0 && (
                                            <CommandGroup heading="Kategori Tersedia">
                                                {filteredCategories.map(cat => (
                                                    <CommandItem 
                                                        key={cat} 
                                                        value={cat} 
                                                        onSelect={() => {
                                                            setFormData(prev => ({...prev, category: cat}));
                                                            setCategoryPopoverOpen(false);
                                                            setCategorySearch("");
                                                        }}
                                                    >
                                                        <Check className={cn("mr-2 h-4 w-4", formData.category === cat ? "opacity-100" : "opacity-0")} />
                                                        {cat}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        )}
                                        {categorySearch.trim() && !exactCategoryMatch && (
                                            <CommandGroup heading="Buat Baru">
                                                <CommandItem 
                                                    value={`create-cat-${categorySearch}`}
                                                    onSelect={() => {
                                                        setFormData(prev => ({...prev, category: categorySearch.trim()}));
                                                        setCategoryPopoverOpen(false);
                                                        setCategorySearch("");
                                                    }}
                                                    className="text-blue-600"
                                                >
                                                    <Plus className="mr-2 h-4 w-4" />
                                                    Tambah kategori &quot;{categorySearch.trim()}&quot;
                                                </CommandItem>
                                            </CommandGroup>
                                        )}
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel required>SKU / Kode</MasterDataFieldLabel>
                        {isEditMode ? (
                            <div className="flex items-center h-9 px-3 rounded-md bg-slate-100 border border-slate-200 text-sm text-slate-600 font-mono">
                                {formData.sku || '-'}
                            </div>
                        ) : (
                            <div className="flex gap-1.5">
                                <Input 
	                                    className={cn("uiInput", formErrors.sku && "border-red-400 ring-1 ring-red-400")}
                                    value={formData.sku} 
                                    onChange={(e) => { setFormData({...formData, sku: e.target.value}); setFormErrors(prev => ({...prev, sku: ''})); }}
                                    placeholder="CHM-001"
                                />
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    onClick={generateSKU} 
                                    title="Generate SKU Otomatis"
	                                    className="shrink-0"
                                >
                                    <Wand2 className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                        {formErrors.sku && !isEditMode && <p className="text-[11px] text-red-500">{formErrors.sku}</p>}
                    </div>
                </div>

                {/* Nama Barang */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel required>Nama Barang</MasterDataFieldLabel>
                    <Input 
	                        className={cn("uiInput", formErrors.name && "border-red-400 ring-1 ring-red-400")}
                        value={formData.name} 
                        onChange={(e) => { setFormData({...formData, name: e.target.value}); setFormErrors(prev => ({...prev, name: ''})); }}
                        placeholder="Contoh: Shampoo Mobil"
                    />
                    {formErrors.name && <p className="text-[11px] text-red-500">{formErrors.name}</p>}
                </div>

                {/* Jenis Layanan */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel required>Jenis Layanan</MasterDataFieldLabel>
                    <Select 
                        value={formData.service_type} 
                        onValueChange={(val) => { setFormData({...formData, service_type: val}); setFormErrors(prev => ({...prev, service_type: ''})); }}
                    >
	                        <SelectTrigger className={cn("uiSelectTrigger", formErrors.service_type && "border-red-400 ring-1 ring-red-400")}>
                            <SelectValue placeholder="Pilih Layanan" />
                        </SelectTrigger>
                        <SelectContent>
                            {activeServices.map(type => (
                                <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {formErrors.service_type && <p className="text-[11px] text-red-500">{formErrors.service_type}</p>}
                </div>

                {/* Row: Cabang + Teknisi */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel>Cabang</MasterDataFieldLabel>
                        <Select 
                            value={formData.branch_id} 
                            onValueChange={(val) => setFormData({...formData, branch_id: val === '_none_' ? '' : val})}
                        >
	                            <SelectTrigger className="uiSelectTrigger">
                                <SelectValue placeholder="Pilih Cabang" />
                            </SelectTrigger>
                            <SelectContent className="z-[200]">
                                <SelectItem value="_none_">
                                    <span className="text-slate-400">Tidak ditentukan</span>
                                </SelectItem>
                                {activeBranches.map(branch => (
                                    <SelectItem key={branch.id} value={branch.id}>
                                        {branch.name} {branch.city ? `(${branch.city})` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel>Teknisi PIC</MasterDataFieldLabel>
                        <Select 
                            value={formData.technician_id} 
                            onValueChange={(val) => setFormData({...formData, technician_id: val === '_none_' ? '' : val})}
                        >
	                            <SelectTrigger className="uiSelectTrigger">
                                <SelectValue placeholder="Pilih Teknisi" />
                            </SelectTrigger>
                            <SelectContent className="z-[200]">
                                <SelectItem value="_none_">
                                    <span className="text-slate-400">Tidak ditentukan</span>
                                </SelectItem>
                                {technicians.map(tech => (
                                    <SelectItem key={tech.id} value={tech.id}>
                                        {tech.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Row: Satuan + Min. Stok */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
	                        <MasterDataFieldLabel required>Satuan</MasterDataFieldLabel>
                        <Popover open={unitPopoverOpen} onOpenChange={(open) => { setUnitPopoverOpen(open); if (!open) setUnitSearch(""); }}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={unitPopoverOpen}
	                                    className={cn("uiSelectTrigger w-full justify-between", formErrors.unit && "border-red-400 ring-1 ring-red-400")}
                                >
                                    {formData.unit || <span className="text-muted-foreground">Pilih satuan...</span>}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 z-[200]" align="start">
                                <Command shouldFilter={false}>
                                    <CommandInput placeholder="Cari atau ketik satuan baru..." value={unitSearch} onValueChange={setUnitSearch} />
                                    <CommandList>
                                        {filteredUnits.length === 0 && !unitSearch.trim() && (
                                            <CommandEmpty>Belum ada data satuan. Ketik untuk membuat baru.</CommandEmpty>
                                        )}
                                        {filteredUnits.length > 0 && (
                                            <CommandGroup heading="Satuan Tersedia">
                                                {filteredUnits.map(unit => (
                                                    <CommandItem 
                                                        key={unit.id} 
                                                        value={unit.name} 
                                                        onSelect={() => {
                                                            setFormData(prev => ({...prev, unit: unit.name}));
                                                            setUnitPopoverOpen(false);
                                                            setUnitSearch("");
                                                        }}
                                                    >
                                                        <Check className={cn("mr-2 h-4 w-4", formData.unit === unit.name ? "opacity-100" : "opacity-0")} />
                                                        {unit.name}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        )}
                                        {unitSearch.trim() && !exactUnitMatch && (
                                            <CommandGroup heading="Buat Baru">
                                                <CommandItem 
                                                    value={`create-${unitSearch}`}
                                                    onSelect={() => handleCreateUnit(unitSearch)}
                                                    className="text-blue-600"
                                                >
                                                    <Plus className="mr-2 h-4 w-4" />
                                                    Tambah satuan &quot;{unitSearch.trim()}&quot;
                                                </CommandItem>
                                            </CommandGroup>
                                        )}
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                        {formErrors.unit && <p className="text-[11px] text-red-500">{formErrors.unit}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <MasterDataFieldLabel>
                            Batas Minimum {formData.unit && <span className="text-slate-400">({formData.unit})</span>}
                        </MasterDataFieldLabel>
                        <Input 
                            type="number"
                            className={cn("uiInput", formErrors.min_stock && "border-red-400 ring-1 ring-red-400")}
                            value={formData.min_stock} 
                            onChange={(e) => { setFormData({...formData, min_stock: e.target.value}); setFormErrors(prev => ({...prev, min_stock: ''})); }} 
                        />
                        {formErrors.min_stock && <p className="text-[11px] text-red-500">{formErrors.min_stock}</p>}
                    </div>
                </div>

                {/* Harga Jual - full width */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel>
                        Harga Jual {formData.unit && <span className="text-slate-400">(per {formData.unit})</span>}
                    </MasterDataFieldLabel>
                    <Input
                        type="number"
                        className={cn("uiInput", formErrors.sell_price && "border-red-400 ring-1 ring-red-400")}
                        value={formData.sell_price}
                        onChange={(e) => { setFormData({...formData, sell_price: e.target.value}); setFormErrors(prev => ({...prev, sell_price: ''})); }}
                        placeholder="Harga dalam Rupiah"
                    />
                    {formErrors.sell_price && <p className="text-[11px] text-red-500">{formErrors.sell_price}</p>}
                </div>

                {/* Deskripsi */}
                <div className="space-y-1.5">
                    <MasterDataFieldLabel>Deskripsi</MasterDataFieldLabel>
                    <textarea 
                        className="uiInput min-h-24 resize-y py-3"
                        value={formData.description} 
                        onChange={(e) => setFormData({...formData, description: e.target.value})}
                        placeholder="Deskripsi produk..." 
                    />
                </div>

                {/* Saldo Awal - only for new product */}
                {!isEditMode && (
                    <>
                        <div className="border-t border-slate-100 pt-3">
                            <p className="text-xs font-medium text-slate-500 mb-3">Saldo Awal</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <MasterDataFieldLabel>
                                        Stok Awal {formData.unit && <span className="text-slate-400">({formData.unit})</span>}
                                    </MasterDataFieldLabel>
                                    <Input 
                                        type="number"
                                        className={cn("uiInput", formErrors.initial_qty && "border-red-400 ring-1 ring-red-400")}
                                        value={formData.initial_qty} 
                                        onChange={(e) => { setFormData({...formData, initial_qty: e.target.value}); setFormErrors(prev => ({...prev, initial_qty: ''})); }} 
                                    />
                                    {formErrors.initial_qty && <p className="text-[11px] text-red-500">{formErrors.initial_qty}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <MasterDataFieldLabel required>
                                        HPP Awal {formData.unit && <span className="text-slate-400">(per {formData.unit})</span>}
                                    </MasterDataFieldLabel>
                                    <Input 
                                        type="number"
                                        className={cn("uiInput", formErrors.initial_cost && "border-red-400 ring-1 ring-red-400")}
                                        value={formData.initial_cost} 
                                        onChange={(e) => { setFormData({...formData, initial_cost: e.target.value}); setFormErrors(prev => ({...prev, initial_cost: ''})); }}
                                        placeholder="HPP dalam Rupiah" 
                                    />
                                    {formErrors.initial_cost && <p className="text-[11px] text-red-500">{formErrors.initial_cost}</p>}
                                </div>
                            </div>
                        </div>

                        {/* Summary calculation */}
                        {(Number(formData.initial_qty) > 0 || Number(formData.initial_cost) > 0 || Number(formData.sell_price) > 0) && (
                            <div className="bg-slate-50 rounded-lg p-3 space-y-1.5 border border-slate-100">
                                <p className="text-xs font-medium text-slate-500 mb-2">Ringkasan</p>
                                {Number(formData.initial_qty) > 0 && Number(formData.initial_cost) > 0 && (
                                    <div className="flex items-center justify-between text-xs gap-2">
                                        <span className="text-slate-500 shrink-0">Nilai Stok Awal</span>
                                        <span className="text-right text-slate-700 font-medium">
                                            {formatInventoryNumber(formData.initial_qty)} {formData.unit} &times; {formatInventoryCurrency(formData.initial_cost)} = <span className="text-emerald-600">{formatInventoryCurrency(Number(formData.initial_qty) * Number(formData.initial_cost))}</span>
                                        </span>
                                    </div>
                                )}
                                {Number(formData.sell_price) > 0 && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-slate-500">Harga Jual</span>
                                        <span className="text-blue-600 font-medium">{formatInventoryUnitPrice(formData.sell_price, formData.unit)}</span>
                                    </div>
                                )}
                                {Number(formData.sell_price) > 0 && Number(formData.initial_cost) > 0 && (
                                    <div className="flex items-center justify-between text-xs border-t border-slate-200 pt-1.5 mt-1.5">
                                        <span className="text-slate-500">Margin</span>
                                        <span className={`font-medium ${(Number(formData.sell_price) - Number(formData.initial_cost)) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                            {formatInventoryUnitPrice(Number(formData.sell_price) - Number(formData.initial_cost), formData.unit)} ({Number(formData.initial_cost) > 0 ? ((Number(formData.sell_price) - Number(formData.initial_cost)) / Number(formData.initial_cost) * 100).toFixed(1) : '0'}%)
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* Edit mode: show current stock info as read-only context */}
                {isEditMode && (
                    <div className="border-t border-slate-100 pt-3">
                        <div className="bg-slate-50 rounded-lg p-3 space-y-1.5 border border-slate-100">
                            <p className="text-xs font-medium text-slate-500 mb-2">Info Stok Saat Ini</p>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Stok</span>
                                <span className="text-slate-700 font-medium">{formatInventoryNumber(currentProduct.current_qty)} {currentProduct.unit}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">HPP Rata-rata</span>
                                <span className="text-slate-700 font-medium">{formatInventoryUnitPrice(currentProduct.average_cost, currentProduct.unit)}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Total Nilai Aset</span>
                                <span className="text-emerald-600 font-medium">{formatInventoryCurrency((currentProduct.current_qty || 0) * (currentProduct.average_cost || 0))}</span>
                            </div>
                            {Number(formData.sell_price) > 0 && (
                                <div className="flex justify-between text-xs border-t border-slate-200 pt-1.5 mt-1.5">
                                    <span className="text-slate-500">Harga Jual</span>
                                    <span className="text-blue-600 font-medium">{formatInventoryUnitPrice(formData.sell_price, formData.unit)}</span>
                                </div>
                            )}
                            {Number(formData.sell_price) > 0 && Number(currentProduct.average_cost) > 0 && (
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Margin</span>
                                    <span className={`font-medium ${(Number(formData.sell_price) - Number(currentProduct.average_cost)) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {formatInventoryUnitPrice(Number(formData.sell_price) - Number(currentProduct.average_cost), formData.unit)} ({Number(currentProduct.average_cost) > 0 ? ((Number(formData.sell_price) - Number(currentProduct.average_cost)) / Number(currentProduct.average_cost) * 100).toFixed(1) : '0'}%)
                                    </span>
                                </div>
                            )}
                            <div className="border-t border-slate-200 pt-2 mt-2">
                                <p className="text-[11px] leading-relaxed text-slate-500">
                                    Stok aktual diubah lewat tab <span className="font-medium text-slate-600">Transaksi &amp; Mutasi</span>.
                                    Form detail produk ini hanya untuk metadata seperti nama barang, harga, satuan, dan batas minimum.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
                <MasterDataFormActions
                  isSubmitting={loading}
                  onCancel={() => setIsDialogOpen(false)}
                  saveLabel="Simpan"
                />
            </MasterDataDialogBody>
            </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={!!detailProduct} onOpenChange={(open) => { if (!open) setDetailProduct(null); }}>
        <MasterDataFormDialogContent size="wide" className="inventoryDetailDialog">
          <DialogHeader>
            <DialogTitle>Detail Produk</DialogTitle>
            <DialogDescription>
              Informasi master produk, kepemilikan stok, harga, dan status persediaan.
            </DialogDescription>
          </DialogHeader>
          {detailProduct && (
            <div className="inventoryDetailContent">
              <div className="inventoryDetailHero">
                <span
                  className={cn(
                    "inventoryProductStatusDot",
                    detailProduct.stock_needs_review
                      ? "isAudit"
                      : detailProduct.current_qty <= (detailProduct.min_stock || 0)
                      ? "isLow"
                      : "isOk"
                  )}
                />
                <div>
                  <h3>{detailProduct.name}</h3>
                  <p>{detailProduct.sku || 'SKU belum diisi'}</p>
                </div>
              </div>

              <div className="inventoryDetailGrid">
                <div className="inventoryDetailItem">
                  <span>Stok Saat Ini</span>
                  <strong>{formatInventoryNumber(detailProduct.current_qty)} {detailProduct.unit}</strong>
                </div>
                <div className="inventoryDetailItem">
                  <span>Batas Minimum</span>
                  <strong>{formatInventoryNumber(detailProduct.min_stock || 0)} {detailProduct.unit}</strong>
                </div>
                <div className="inventoryDetailItem">
                  <span>HPP Rata-rata</span>
                  <strong>{formatInventoryUnitPrice(detailProduct.average_cost, detailProduct.unit)}</strong>
                </div>
                <div className="inventoryDetailItem">
                  <span>Harga Jual</span>
                  <strong>{detailProduct.sell_price ? formatInventoryUnitPrice(detailProduct.sell_price, detailProduct.unit) : '-'}</strong>
                </div>
                <div className="inventoryDetailItem isWide">
                  <span>Total Nilai Aset</span>
                  <strong>{formatInventoryCurrency(detailProduct.current_qty * detailProduct.average_cost)}</strong>
                </div>
              </div>

              <div className="inventoryDetailRows">
                <div>
                  <span>Kategori</span>
                  <strong>{detailProduct.category || '-'}</strong>
                </div>
                <div>
                  <span>Layanan</span>
                  <strong>{detailProduct.service_type || '-'}</strong>
                </div>
                <div>
                  <span>Cabang</span>
                  <strong>{detailProduct.branch_id ? (activeBranches.find(b => b.id === detailProduct.branch_id)?.name || '-') : '-'}</strong>
                </div>
                <div>
                  <span>Teknisi PIC</span>
                  <strong>{detailProduct.technician_id ? (users.find(u => u.id === detailProduct.technician_id)?.name || '-') : '-'}</strong>
                </div>
                <div>
                  <span>Deskripsi</span>
                  <strong>{detailProduct.description || '-'}</strong>
                </div>
                {detailProduct.stock_needs_review && (
                  <div className="isWarning">
                    <span>Status Audit</span>
                    <strong>
                      Data tabel lama: {formatInventoryNumber(detailProduct.recorded_qty)} {detailProduct.unit}
                      {typeof detailProduct.recorded_average_cost === 'number'
                        ? `, HPP ${formatInventoryCurrency(detailProduct.recorded_average_cost)}`
                        : ''}
                    </strong>
                  </div>
                )}
              </div>

              <div className="inventoryDetailActions">
                {canViewStockCard && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setStockCardProduct(detailProduct);
                      setStockCardOpen(true);
                    }}
                  >
                    Kartu Stok
                  </Button>
                )}
                {canEditProduct && (
                  <Button
                    type="button"
                    onClick={() => {
                      openEditDialog(detailProduct);
                      setDetailProduct(null);
                    }}
                  >
                    Edit Produk
                  </Button>
                )}
              </div>
            </div>
          )}
        </MasterDataFormDialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-slate-900">Hapus Produk</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-500">
              Apakah Anda yakin ingin menghapus produk{' '}
              <span className="font-semibold text-slate-700">{deleteTarget?.name}</span>
              {deleteTarget?.sku && <span className="text-slate-400"> ({deleteTarget.sku})</span>}
              ?{' '}
              Produk hanya bisa dihapus jika tidak memiliki transaksi. Jika ada transaksi terkait, hapus akan ditolak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">Batal</AlertDialogCancel>
            <AlertDialogAction variant="danger"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="bg-red-600 hover:bg-red-700 text-white h-9"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus Produk
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Kartu Stok Dialog */}
      <StockCard
        open={stockCardOpen}
        onOpenChange={setStockCardOpen}
        product={stockCardProduct}
      />
    </div>
  );
}
