import React, { useState, useEffect, useMemo } from 'react';
import { 
  Tabs, TabsContent, TabsRail, TabsTrigger, TabsViewport 
} from '@/app/components/ui/tabs';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { ArrowUpRight, ArrowDownLeft, Plus, ChevronDown, ChevronUp, CheckCircle, Wallet, User as UserIcon, Building2, Edit, Trash2, Search, Filter, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/app/components/ui/utils';
import { useMasterData } from '@/app/pages/master-data/context/MasterDataCtx';
import { usePermissions } from '@/app/hooks/usePermissions';
import { logActivity } from '@/app/services/auditService';
import {
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/app/components/ui/table";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";
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
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/app/components/ui/command";
import { Check } from "lucide-react";
import { createDataTableColumns, DataTable, TableActionCell, TableActionHeader, TableText } from '@/app/components/ui/data-table';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '@/app/components/ui/operational-page';
import {
  MasterDataDialogBody,
  MasterDataCurrencyInput,
  MasterDataFieldLabel,
  MasterDataFormActions,
  MasterDataFormDialogContent,
  MasterDataFormField,
  MasterDataFormGrid,
  MasterDataFormHeader,
} from '@/app/components/ui/master-data-ui';

// --- Types ---
interface DailyReport {
  id?: string;
  created_at?: string;
  service_date: string;
  technician_id: string;
  technician_name: string;
  technician_role: string;
  
  revenue_cash: number;
  revenue_transfer: number;
  deposit_amount: number;
  payment_status: 'Unpaid' | 'Paid' | 'Paid_Transfer';
  
  commission_amount: number;
  commission_rate: number;
  transport_cost: number;
  other_cost: number;
  saving_amount: number;
  saving_rate: number;
  notes?: string;
}

interface ManualDebt {
    id: string;
    created_at: string;
    transaction_date: string; // New field
    type: 'payable' | 'receivable';
    amount: number;
    description: string;
    due_date?: string;
    status: 'paid' | 'unpaid';
    identity_name: string;
    identity_id?: string; // New field
    identity_type?: 'user' | 'vendor' | 'other'; // New field
    is_internal: boolean;
}

interface Vendor {
    id: string;
    name: string;
    status: string;
}

// --- Logic: Financial Calculation (Mirror logika Laporan.tsx) ---
const calculateFinancials = (data: DailyReport) => {
  const totalRevenue = (data.revenue_cash || 0) + (data.revenue_transfer || 0);

  // Gunakan stored commission_amount jika ada, fallback ke rate-based
  const commissionAmount = (data.commission_amount !== undefined && data.commission_amount !== null)
    ? data.commission_amount
    : (totalRevenue * (data.commission_rate || 0)) / 100;

  const savingAmount = (data.saving_amount !== undefined && data.saving_amount !== null)
    ? data.saving_amount
    : (commissionAmount * (data.saving_rate || 0)) / 100;

  const grossHakTeknisi = commissionAmount + (data.transport_cost || 0) + (data.other_cost || 0);
  const netHakTeknisi = grossHakTeknisi - savingAmount;

  const cashOnHand = data.revenue_cash || 0;
  const actualSetor = data.deposit_amount || 0;

  // Mirror logika Laporan.tsx — 3 branch berdasarkan payment_status
  const isPaidTransfer = data.payment_status === 'Paid_Transfer';
  const isUnpaid = data.payment_status === 'Unpaid';

  let targetSetor = 0;
  let officeDebt = 0;
  let balance = 0;

  if (isPaidTransfer) {
    // Sudah ditransfer manual → wajib setor full cash, hutang = 0
    targetSetor = cashOnHand;
    balance = targetSetor - actualSetor;
    officeDebt = 0;
    // Jika lebih setor → jadi hutang kantor (over-deposit)
    if (balance < 0) officeDebt += Math.abs(balance);

  } else if (isUnpaid) {
    // Belum dibayar → catat hutang hak teknisi (komisi+transport-tabungan)
    targetSetor = cashOnHand;
    balance = targetSetor - actualSetor;
    officeDebt = netHakTeknisi;
    if (balance < 0) officeDebt += Math.abs(balance);

  } else {
    // Paid (generic) — adaptive: potong cash atau setor penuh
    if (actualSetor < (cashOnHand - 1000)) {
      targetSetor = Math.max(0, cashOnHand - netHakTeknisi);
    } else {
      targetSetor = cashOnHand;
    }
    balance = targetSetor - actualSetor;
    officeDebt = 0; // Sudah dibayar, tidak ada hutang
    if (balance < 0) officeDebt += Math.abs(balance);
  }

  return {
    targetSetor,
    balance,
    officeDebt,
    commissionAmount,
    savingAmount
  };
};

const formatRupiah = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(amount);
};

// --- Sub-Component for Grouping ---
const DebtGroupCard = ({ person, type, canManage, onSettle, onEdit, onDelete }: { 
    person: any, 
    type: 'payable' | 'receivable', 
    canManage: boolean,
    onSettle: (item: any, type: any) => void,
    onEdit: (item: any) => void,
    onDelete: (item: any) => void
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <OperationalTableCard className="debtGroupCard">
            <div 
                className="debtGroupHeader"
                onClick={() => setIsOpen(!isOpen)}
            >
                 <div className="flex flex-col items-start text-left">
                    <span className="debtGroupName">
                        {person.name}
                        {person.items.some((i: any) => i.identity_type === 'vendor') && (
                            <span className="debtIdentityText isVendor">Vendor</span>
                        )}
                         {person.items.some((i: any) => i.identity_type === 'user') && (
                            <span className="debtIdentityText isUser">Karyawan</span>
                        )}
                    </span>
                    <span className="debtGroupMeta">
                        {person.items.length} Transaksi {type === 'receivable' ? 'Belum Setor' : 'Belum Dibayar'}
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <div className={cn("debtGroupTotal", type === 'receivable' ? "isReceivable" : "isPayable")}>
                        {formatRupiah(person.total)}
                    </div>
                    {isOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </div>
            </div>
            
            {isOpen && (
                <div className="debtGroupTable">
                    <DataTable
                      columns={createDataTableColumns(['number', 'date', 'description', 'status', 'money', 'action'])}
                      rowMinHeight={58}
                      cellY={11}
                      textMax={280}
                    >
                      <table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>No</TableHead>
                                <TableHead>Tanggal</TableHead>
                                <TableHead>Keterangan</TableHead>
                                <TableHead>Sumber</TableHead>
                                <TableHead className="text-right">Nominal</TableHead>
                                <TableActionHeader />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {person.items.map((item: any, idx: number) => (
                                <TableRow key={idx}>
                                    <TableCell className="debtIndexCell">
                                        {idx + 1}
                                    </TableCell>
                                    <TableCell>
                                        {format(new Date(item.date), 'dd MMM yyyy', { locale: id })}
                                    </TableCell>
                                    <TableCell>
                                        <TableText primary={item.description} />
                                    </TableCell>
                                    <TableCell>
                                        <span className={cn("debtSourceText", item.source === 'manual' ? "isManual" : "isAuto")}>
                                            {item.source === 'manual' ? 'MANUAL' : 'AUTO'}
                                        </span>
                                    </TableCell>
                                    <TableCell className={cn("debtMoneyCell", type === 'receivable' ? "isReceivable" : "isPayable")}>
                                        {formatRupiah(item.amount)}
                                    </TableCell>
                                    <TableActionCell>
                                        <div className="debtRowActions">
                                            {item.source === 'manual' && (
                                                <>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        disabled={!canManage}
                                                        className="inventoryIconButton text-slate-400 hover:text-blue-600"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onEdit(item);
                                                        }}
                                                    >
                                                        <Edit className="w-3.5 h-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        disabled={!canManage}
                                                        className="inventoryIconButton text-slate-400 hover:text-red-600"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDelete(item);
                                                        }}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </>
                                            )}
                                            <Button 
                                                size="sm" 
                                                variant="outline" 
                                                className={cn(
                                                    "debtSettleButton",
                                                    type === 'receivable' 
                                                        ? "isReceivable"
                                                        : "isPayable"
                                                )}
                                                disabled={!canManage}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSettle(item, type);
                                                }}
                                            >
                                                {type === 'receivable' ? 'Selesai' : 'Bayar'}
                                            </Button>
                                        </div>
                                    </TableActionCell>
                                </TableRow>
                            ))}
                        </TableBody>
                      </table>
                    </DataTable>
                </div>
            )}
        </OperationalTableCard>
    );
};

export const DebtsPage = () => {
  const { users, currentUser } = useMasterData();
  const { hasPermission } = usePermissions();
  const canViewDebts = hasPermission('debts.view');
  const canManageFinance = hasPermission('finance.manage');
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [manualDebts, setManualDebts] = useState<ManualDebt[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [paidSavingIds, setPaidSavingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [isRefresh, setIsRefresh] = useState(false);
  
  // Dialog State for Settlement
  const [settleDialogOpen, setSettleDialogOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<{item: any, type: 'payable' | 'receivable'} | null>(null);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dialog State for Create Manual
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newDebt, setNewDebt] = useState({
      type: 'receivable',
      amount: '',
      identity_id: '',
      identity_name: '',
      identity_type: 'user', // 'user' | 'vendor' | 'other'
      description: '',
      transaction_date: format(new Date(), 'yyyy-MM-dd'),
      due_date: format(new Date(), 'yyyy-MM-dd')
  });

  // Edit & Delete State
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<ManualDebt | null>(null);
  const [deletingDebt, setDeletingDebt] = useState<ManualDebt | null>(null);

  // Filters - Moved up to avoid ReferenceError
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all'); // all, user, vendor

  const fetchData = async () => {
    try {
      setLoading(true);
      // 1. Fetch Auto Reports
      const { data: reportData, error: reportError } = await supabase
        .from('technician_daily_reports')
        .select('*')
        .order('service_date', { ascending: false });
      
      if (reportError) throw reportError;
      setReports(reportData || []);

      // 2. Fetch Vendors (Safely)
      try {
          const { data: vendorData, error: vendorError } = await supabase
            .from('vendors')
            .select('*')
            .eq('status', 'active');
          
          if (!vendorError) {
              setVendors(vendorData || []);
          }
      } catch (e) {
          console.log("Vendor table missing or error");
      }

      // 3. Fetch Manual Debts (using KV Store)
      try {
          const { data: manualData, error: manualError } = await supabase
            .from('kv_store_f781cd00')
            .select('*')
            .like('key', 'manual_debt:%');
          
          if (!manualError && manualData) {
              const parsed = manualData.map(d => d.value);
              // Filter status locally since we can't query JSON value directly efficiently here
              const unpaid = parsed.filter((p: any) => p.status === 'unpaid');
              // Sort locally
              unpaid.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
              setManualDebts(unpaid);
          }
      } catch (e) {
          console.log("KV store error or table missing", e);
      }

      // 4. Fetch Paid Savings Status (Freelance Tabungan)
      try {
          const { data: paidSavingsData } = await supabase
              .from('kv_store_f781cd00')
              .select('key')
              .like('key', 'saving_paid:%');
          
          const paidSet = new Set(paidSavingsData?.map(d => d.key.replace('saving_paid:', '')) || []);
          setPaidSavingIds(paidSet);
      } catch (e) {
          console.log("Error fetching paid savings", e);
      }

    } catch (err: any) {
      toast.error('Gagal memuat data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canViewDebts) {
        fetchData();
    }
  }, [isRefresh, canViewDebts]);

  const { receivables, payables, totalReceivable, totalPayable } = useMemo(() => {
    const techMapReceivables = new Map<string, { id: string, name: string, items: any[], total: number }>();
    const techMapPayables = new Map<string, { id: string, name: string, items: any[], total: number }>();

    // 1. Process Auto Reports
    reports.forEach(r => {
        const calcs = calculateFinancials(r);
        
        // Auto Receivables
        if (calcs.balance > 0) {
            const key = `auto-${r.technician_id}`;
            const items = techMapReceivables.get(key)?.items || [];
            items.push({ 
                source: 'auto',
                original: r,
                date: r.service_date,
                amount: calcs.balance,
                description: r.notes || `Laporan Harian (Kurang Setor)`,
                identity_type: 'user',
                ...calcs 
            });
            
            techMapReceivables.set(key, {
                id: key,
                name: r.technician_name,
                items,
                total: (techMapReceivables.get(key)?.total || 0) + calcs.balance
            });
        }

        // Auto Payables
        if (calcs.officeDebt > 0 && r.payment_status !== 'Paid') {
            const key = `auto-${r.technician_id}`;
            const items = techMapPayables.get(key)?.items || [];
            items.push({ 
                source: 'auto',
                original: r,
                date: r.service_date,
                amount: calcs.officeDebt, 
                description: `Gaji/Komisi/Bensin`,
                identity_type: 'user',
                ...calcs 
            });
            
            techMapPayables.set(key, {
                id: key,
                name: r.technician_name,
                items,
                total: (techMapPayables.get(key)?.total || 0) + calcs.officeDebt
            });
        }

        // Savings (Tabungan) for Freelance — hanya tampil untuk record Unpaid
        if (r.technician_role === 'Freelance' && r.payment_status === 'Unpaid' && calcs.savingAmount > 0 && r.id && !paidSavingIds.has(r.id)) {
            const key = `auto-${r.technician_id}`;
            const items = techMapPayables.get(key)?.items || [];
            
            items.push({ 
                source: 'auto-saving',
                original: r,
                date: r.service_date,
                amount: calcs.savingAmount, 
                description: `Tabungan/Simpanan (Hold 50%)`,
                identity_type: 'user',
                ...calcs 
            });
            
            techMapPayables.set(key, {
                id: key,
                name: r.technician_name,
                items,
                total: (techMapPayables.get(key)?.total || 0) + calcs.savingAmount
            });
        }
    });

    // 2. Process Manual Debts
    manualDebts.forEach(d => {
        const key = `manual-${d.identity_name}`;
        
        const item = {
             source: 'manual',
             original: d,
             date: d.transaction_date || d.created_at, // Use transaction date if available
             amount: d.amount,
             description: d.description,
             identity_type: d.identity_type
        };

        if (d.type === 'receivable') {
             const items = techMapReceivables.get(key)?.items || [];
             items.push(item);
             techMapReceivables.set(key, {
                 id: key,
                 name: d.identity_name,
                 items,
                 total: (techMapReceivables.get(key)?.total || 0) + d.amount
             });
        } else {
             const items = techMapPayables.get(key)?.items || [];
             items.push(item);
             techMapPayables.set(key, {
                 id: key,
                 name: d.identity_name,
                 items,
                 total: (techMapPayables.get(key)?.total || 0) + d.amount
             });
        }
    });

    let receivablesList = Array.from(techMapReceivables.values()).sort((a,b) => b.total - a.total);
    let payablesList = Array.from(techMapPayables.values()).sort((a,b) => b.total - a.total);

    // Apply Filters
    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        receivablesList = receivablesList.filter(p => p.name.toLowerCase().includes(lower));
        payablesList = payablesList.filter(p => p.name.toLowerCase().includes(lower));
    }

    if (filterType !== 'all') {
       receivablesList = receivablesList.filter(p => p.items.some((i:any) => i.identity_type === filterType));
       payablesList = payablesList.filter(p => p.items.some((i:any) => i.identity_type === filterType));
    }

    const totalReceivable = receivablesList.reduce((acc, curr) => acc + curr.total, 0);
    const totalPayable = payablesList.reduce((acc, curr) => acc + curr.total, 0);

    return { receivables: receivablesList, payables: payablesList, totalReceivable, totalPayable };
  }, [reports, manualDebts, searchTerm, filterType, paidSavingIds]);

  const handleSettle = (item: any, type: 'payable' | 'receivable') => {
      if (!canManageFinance) return;

      setSelectedDebt({ item, type });
      setSettleAmount(item.amount);
      setSettleDialogOpen(true);
  };

  const confirmSettle = async () => {
      if (!canManageFinance) return;
      if (!selectedDebt) return;
      setIsProcessing(true);
      try {
          const { item, type } = selectedDebt;
          
          if (item.source === 'auto') {
              // Handle Auto Settlement
              const reportId = item.original.id;
              if (type === 'receivable') {
                  const newDeposit = (item.original.deposit_amount || 0) + settleAmount;
                  const { error } = await supabase.from('technician_daily_reports')
                    .update({ 
                        deposit_amount: newDeposit,
                        deposit_status: 'Verified',
                        notes: item.original.notes ? item.original.notes + `\n[Settled ${formatRupiah(settleAmount)}]` : `[Settled ${formatRupiah(settleAmount)}]`
                    })
                    .eq('id', reportId);
                  if (error) throw error;
              } else {
                  if (settleAmount >= item.amount) {
                      const { error } = await supabase.from('technician_daily_reports').update({ payment_status: 'Paid' }).eq('id', reportId);
                      if (error) throw error;
                  } else {
                      toast.warning("Pembayaran parsial laporan harian belum didukung.");
                      setIsProcessing(false);
                      return;
                  }
              }
          } else if (item.source === 'auto-saving') {
              // Handle Auto Saving Settlement (Freelance Tabungan)
              const reportId = item.original.id;
              
              // We mark this specific saving as paid in KV store
              const { error } = await supabase.from('kv_store_f781cd00').insert({
                  key: `saving_paid:${reportId}`,
                  value: {
                      paid_at: new Date().toISOString(),
                      amount: settleAmount,
                      technician_id: item.original.technician_id
                  }
              });
              
              if (error) throw error;

          } else {
              // Handle Manual Settlement (KV Store)
              const debtId = item.original.id;
              const updatedItem = { ...item.original, status: 'paid' };
              
              const { error } = await supabase.from('kv_store_f781cd00').upsert({
                  key: `manual_debt:${debtId}`,
                  value: updatedItem
              });
              
              if (error) throw error;
          }

          toast.success("Transaksi berhasil diselesaikan.");
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'PAYMENT',
              'Hutang & Piutang',
              `Menyelesaikan transaksi: ${item?.identity_name || item?.name || ''}`,
              item?.id || item?.original?.id || ''
            );
          }
          setSettleDialogOpen(false);
          setIsRefresh(prev => !prev);
          
      } catch (err: any) {
          toast.error("Gagal memproses: " + err.message);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleCreateManual = async () => {
      if (!canManageFinance) return;
      if (!newDebt.type || !newDebt.transaction_date || !newDebt.identity_name || !newDebt.amount || Number(newDebt.amount) <= 0) {
          toast.error("Mohon lengkapi jenis transaksi, tanggal, pihak, dan nominal.");
          return;
      }
      
      setIsProcessing(true);
      try {
          const newId = crypto.randomUUID();
          const payload = {
              id: newId,
              created_at: new Date().toISOString(),
              type: newDebt.type,
              amount: Number(newDebt.amount),
              identity_name: newDebt.identity_name,
              identity_id: newDebt.identity_id || null, // Optional
              identity_type: newDebt.identity_type,
              description: newDebt.description,
              transaction_date: newDebt.transaction_date,
              due_date: newDebt.due_date,
              status: 'unpaid',
              is_internal: newDebt.identity_type === 'user'
          };

          const { error } = await supabase.from('kv_store_f781cd00').upsert({
              key: `manual_debt:${newId}`,
              value: payload
          });
          
          if (error) throw error;
          
          toast.success("Berhasil mencatat transaksi baru.");
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'CREATE',
              'Hutang & Piutang',
              `Mencatat ${payload.type === 'receivable' ? 'piutang' : 'hutang'} baru: ${payload.identity_name} - Rp ${Number(payload.amount).toLocaleString('id-ID')}`,
              newId,
              { type: payload.type, amount: payload.amount }
            );
          }
          setCreateDialogOpen(false);
          setNewDebt({ 
            type: 'receivable', 
            amount: '', 
            identity_id: '', 
            identity_name: '', 
            identity_type: 'user',
            description: '', 
            transaction_date: format(new Date(), 'yyyy-MM-dd'),
            due_date: format(new Date(), 'yyyy-MM-dd') 
          });
          setIsRefresh(prev => !prev);
      } catch (err: any) {
          toast.error("Gagal menyimpan (Pastikan kolom baru sudah ditambahkan): " + err.message);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleEdit = (item: any) => {
      if (!canManageFinance) return;
      setEditingDebt(item.original);
      setNewDebt({
          type: item.original.type,
          amount: item.amount.toString(),
          identity_id: item.original.identity_id || '',
          identity_name: item.original.identity_name,
          identity_type: item.original.identity_type || 'user',
          description: item.description,
          transaction_date: item.original.transaction_date || format(new Date(item.original.created_at), 'yyyy-MM-dd'),
          due_date: item.original.due_date || ''
      });
      setEditDialogOpen(true);
  };

  const confirmEdit = async () => {
      if (!canManageFinance) return;
      if (!editingDebt) return;
      if (!newDebt.type || !newDebt.transaction_date || !newDebt.identity_name || !newDebt.amount || Number(newDebt.amount) <= 0) {
          toast.error("Mohon lengkapi jenis transaksi, tanggal, pihak, dan nominal.");
          return;
      }
      setIsProcessing(true);
      try {
          const payload = {
              ...editingDebt, // Keep original fields like id, created_at
              type: newDebt.type,
              amount: Number(newDebt.amount),
              identity_name: newDebt.identity_name,
              identity_id: newDebt.identity_id || null,
              identity_type: newDebt.identity_type,
              description: newDebt.description,
              transaction_date: newDebt.transaction_date,
              due_date: newDebt.due_date,
              is_internal: newDebt.identity_type === 'user'
          };

          const { error } = await supabase.from('kv_store_f781cd00').upsert({
              key: `manual_debt:${editingDebt.id}`,
              value: payload
          });

          if (error) throw error;

          toast.success("Data berhasil diperbarui");
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'UPDATE',
              'Hutang & Piutang',
              `Memperbarui data ${newDebt.type === 'receivable' ? 'piutang' : 'hutang'}: ${newDebt.identity_name}`,
              editingDebt.id
            );
          }
          setEditDialogOpen(false);
          setIsRefresh(prev => !prev);
      } catch (e: any) {
          toast.error("Gagal update: " + e.message);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleDelete = (item: any) => {
      if (!canManageFinance) return;
      setDeletingDebt(item.original);
      setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
      if (!canManageFinance) return;
      if (!deletingDebt) return;
      setIsProcessing(true);
      try {
          const { error } = await supabase.from('kv_store_f781cd00').delete().eq('key', `manual_debt:${deletingDebt.id}`);
          if (error) throw error;
          
          toast.success("Data berhasil dihapus");
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'DELETE',
              'Hutang & Piutang',
              `Menghapus data ${deletingDebt.type === 'receivable' ? 'piutang' : 'hutang'}: ${deletingDebt.identity_name}`,
              deletingDebt.id
            );
          }
          setDeleteDialogOpen(false);
          setIsRefresh(prev => !prev);
      } catch (e: any) {
          toast.error("Gagal hapus: " + e.message);
      } finally {
          setIsProcessing(false);
      }
  };

  // Combine Users and Vendors for Combobox
  const combinedIdentities = useMemo(() => {
      const userOpts = users.map(u => ({ 
          id: u.id, 
          name: u.name, 
          type: 'user', 
          label: `${u.name} (Karyawan)` 
      }));
      const vendorOpts = vendors.map(v => ({ 
          id: v.id, 
          name: v.name, 
          type: 'vendor', 
          label: `${v.name} (Vendor)` 
      }));
      return [...userOpts, ...vendorOpts];
  }, [users, vendors]);

  const [comboOpen, setComboOpen] = useState(false);

  if (!canViewDebts) {
    return (
      <OperationalPageShell className="debtPage">
        <OperationalEmptyState
          icon={Lock}
          title="Akses Dibatasi"
          description="Anda tidak memiliki izin untuk membuka halaman hutang dan piutang."
          className="min-h-[70vh]"
        />
      </OperationalPageShell>
    );
  }

  return (
    <OperationalPageShell className="debtPage pb-20">
        <div className="debtStack">
            <OperationalPageHeader
              eyebrow="Keuangan"
              icon={Wallet}
              title="Hutang & Piutang"
              subtitle={
                <>
                  Monitoring kewajiban dari laporan harian dan input manual.
                  {!canManageFinance && <span className="debtReadOnlyNote"> Mode lihat saja.</span>}
                </>
              }
              onRefresh={() => setIsRefresh(!isRefresh)}
              isRefreshing={loading}
              actions={
                <div className="debtHeaderActions">
                  <Button onClick={() => setCreateDialogOpen(true)} disabled={!canManageFinance} className="inventoryPrimaryButton">
                    <Plus className="h-4 w-4" />
                    Catat Manual
                  </Button>
                </div>
              }
            />

            {/* Filter Section */}
            <OperationalFilterPanel className="responsiveFilterGrid debtFilterPanel">
                <div className="debtSearchField">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                        placeholder="Cari nama karyawan atau vendor..." 
                        className="uiInput pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="debtFilterType">
                    <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="uiSelectTrigger">
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 text-slate-500" />
                                <SelectValue placeholder="Tipe Pihak" />
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Semua Tipe</SelectItem>
                            <SelectItem value="user">Karyawan Internal</SelectItem>
                            <SelectItem value="vendor">Vendor / Partner</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </OperationalFilterPanel>

            <OperationalKpiGrid className="debtKpiGrid">
                <OperationalKpiCard label="Total Hutang" value={formatRupiah(totalPayable)} icon={ArrowDownLeft} tone="rose" />
                <OperationalKpiCard label="Total Piutang" value={formatRupiah(totalReceivable)} icon={ArrowUpRight} tone="emerald" />
            </OperationalKpiGrid>

            <Tabs defaultValue="receivable" className="w-full">
                <TabsViewport className="debtTabsViewport">
                  <TabsRail className="masterDataTabs debtTabs min-w-max">
                    <TabsTrigger value="receivable" className="masterDataTab debtTab">
                        Piutang (Masuk)
                        <span className="debtTabCount">{receivables.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="payable" className="masterDataTab debtTab">
                        Hutang (Keluar)
                        <span className="debtTabCount">{payables.length}</span>
                    </TabsTrigger>
                  </TabsRail>
                </TabsViewport>
                
                <TabsContent value="receivable" className="debtTabContent">
                    {receivables.length === 0 ? (
                        <OperationalTableCard>
                          <OperationalEmptyState icon={CheckCircle} title="Tidak Ada Piutang" description="Semua teknisi sudah menyetor dan tidak ada pinjaman." className="py-12" />
                        </OperationalTableCard>
                    ) : (
                        receivables.map(person => (
                            <DebtGroupCard key={person.id} person={person} type="receivable" canManage={canManageFinance} onSettle={handleSettle} onEdit={handleEdit} onDelete={handleDelete} />
                        ))
                    )}
                </TabsContent>
                
                <TabsContent value="payable" className="debtTabContent">
                    {payables.length === 0 ? (
                        <OperationalTableCard>
                          <OperationalEmptyState icon={CheckCircle} title="Tidak Ada Hutang" description="Semua kewajiban pembayaran sudah lunas." className="py-12" />
                        </OperationalTableCard>
                    ) : (
                        payables.map(person => (
                             <DebtGroupCard key={person.id} person={person} type="payable" canManage={canManageFinance} onSettle={handleSettle} onEdit={handleEdit} onDelete={handleDelete} />
                        ))
                    )}
                </TabsContent>
            </Tabs>
        </div>

        {/* SETTLEMENT DIALOG */}
        <Dialog open={settleDialogOpen} onOpenChange={setSettleDialogOpen}>
            <MasterDataFormDialogContent>
                <DialogHeader>
                    <DialogTitle>Konfirmasi Penyelesaian</DialogTitle>
                    <DialogDescription>
                         Tandai transaksi ini sebagai selesai/lunas.
                    </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmSettle();
                  }}
                >
                <MasterDataDialogBody>
                    <div className="space-y-2">
                        <MasterDataFieldLabel>Nominal {selectedDebt?.type === 'receivable' ? 'Diterima' : 'Dibayar'}</MasterDataFieldLabel>
                        <MasterDataCurrencyInput
                            value={settleAmount}
                            onValueChange={(amount) => setSettleAmount(Number(amount || 0))}
                            disabled={selectedDebt?.type === 'payable'}
                        />
                        {selectedDebt?.item.source === 'auto' && selectedDebt.type === 'payable' && (
                            <p className="text-[10px] text-red-500">Untuk Gaji Otomatis, wajib bayar Full untuk menandai Lunas.</p>
                        )}
                    </div>
                    <MasterDataFormActions
                      isSubmitting={isProcessing}
                      onCancel={() => setSettleDialogOpen(false)}
                      saveLabel="Simpan"
                      submitDisabled={!canManageFinance}
                    />
                </MasterDataDialogBody>
                </form>
            </MasterDataFormDialogContent>
        </Dialog>

         {/* CREATE MANUAL DIALOG */}
         <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <MasterDataFormDialogContent size="wide" className="debtFormDialog">
                <MasterDataFormHeader
                  icon={Wallet}
                  title="Catat Hutang/Piutang Manual"
                  description="Catat pinjaman karyawan, kasbon, atau hutang vendor di luar operasional harian."
                />
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateManual();
                  }}
                >
                <MasterDataDialogBody className="debtFormBody">
                  <MasterDataFormGrid>
                        <MasterDataFormField span="half">
                            <MasterDataFieldLabel required>Jenis Transaksi</MasterDataFieldLabel>
                            <Select value={newDebt.type} onValueChange={(val: any) => setNewDebt({...newDebt, type: val})}>
                                <SelectTrigger className="uiSelectTrigger">
                                    <SelectValue placeholder="Pilih Jenis" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="receivable">Piutang (Uang Masuk)</SelectItem>
                                    <SelectItem value="payable">Hutang (Uang Keluar)</SelectItem>
                                </SelectContent>
                            </Select>
                        </MasterDataFormField>
                         <MasterDataFormField span="half">
                            <MasterDataFieldLabel required>Tanggal Transaksi</MasterDataFieldLabel>
                            <Input 
                                type="date" 
                                className="uiInput"
                                value={newDebt.transaction_date}
                                onChange={(e) => setNewDebt({...newDebt, transaction_date: e.target.value})}
                            />
                        </MasterDataFormField>

                    <MasterDataFormField span="half">
                        <MasterDataFieldLabel required>Pihak</MasterDataFieldLabel>
                        <Popover open={comboOpen} onOpenChange={setComboOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={comboOpen}
                                className="uiSelectTrigger w-full justify-between"
                                >
                                {newDebt.identity_name
                                    ? newDebt.identity_name
                                    : "Pilih Karyawan atau Vendor..."}
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0">
                                <Command>
                                    <CommandInput placeholder="Cari karyawan atau vendor..." />
                                    <CommandList>
                                        <CommandEmpty>
                                            <div className="p-4 text-center">
                                                <p className="text-sm text-slate-500 mb-2">Tidak ditemukan.</p>
                                                <Button 
                                                    type="button"
                                                    size="sm" 
                                                    variant="secondary" 
                                                    className="w-full"
                                                    onClick={() => {
                                                        const searchInput = document.querySelector('[cmdk-input]') as HTMLInputElement;
                                                        const val = searchInput?.value || "Vendor Baru";
                                                        setNewDebt({
                                                            ...newDebt, 
                                                            identity_name: val,
                                                            identity_id: '',
                                                            identity_type: 'other'
                                                        });
                                                        setComboOpen(false);
                                                    }}
                                                >
                                                    Gunakan input pencarian sebagai nama baru
                                                </Button>
                                            </div>
                                        </CommandEmpty>
                                        <CommandGroup heading="Karyawan">
                                            {combinedIdentities.filter(i => i.type === 'user').map((identity) => (
                                            <CommandItem
                                                key={identity.id}
                                                value={identity.label}
                                                onSelect={() => {
                                                    setNewDebt({
                                                        ...newDebt,
                                                        identity_name: identity.name,
                                                        identity_id: identity.id,
                                                        identity_type: 'user'
                                                    });
                                                    setComboOpen(false);
                                                }}
                                            >
                                                <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    newDebt.identity_id === identity.id ? "opacity-100" : "opacity-0"
                                                )}
                                                />
                                                <div className="flex flex-1 items-center justify-between">
                                                    <div className="flex items-center">
                                                        <UserIcon className="w-3 h-3 mr-2 text-slate-400" />
                                                        {identity.name}
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-blue-50 text-blue-700 border-blue-200">Karyawan</Badge>
                                                </div>
                                            </CommandItem>
                                            ))}
                                        </CommandGroup>
                                        <CommandGroup heading="Vendor / Partner">
                                            {combinedIdentities.filter(i => i.type === 'vendor').map((identity) => (
                                            <CommandItem
                                                key={identity.id}
                                                value={identity.label}
                                                onSelect={() => {
                                                    setNewDebt({
                                                        ...newDebt,
                                                        identity_name: identity.name,
                                                        identity_id: identity.id,
                                                        identity_type: 'vendor'
                                                    });
                                                    setComboOpen(false);
                                                }}
                                            >
                                                <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    newDebt.identity_id === identity.id ? "opacity-100" : "opacity-0"
                                                )}
                                                />
                                                <div className="flex flex-1 items-center justify-between">
                                                    <div className="flex items-center">
                                                        <Building2 className="w-3 h-3 mr-2 text-slate-400" />
                                                        {identity.name}
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-amber-50 text-amber-700 border-amber-200">Vendor</Badge>
                                                </div>
                                            </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </MasterDataFormField>

                    <MasterDataFormField span="half">
                        <MasterDataFieldLabel required>Nominal</MasterDataFieldLabel>
                        <MasterDataCurrencyInput
                            value={newDebt.amount}
                            onValueChange={(amount) => setNewDebt({...newDebt, amount})}
                        />
                    </MasterDataFormField>

                    <MasterDataFormField span="full">
                            <MasterDataFieldLabel optional>Keterangan</MasterDataFieldLabel>
                            <Input 
                                className="uiInput"
                                placeholder="Cth: Kasbon sakit, Pembelian Kabel..." 
                                value={newDebt.description}
                                onChange={(e) => setNewDebt({...newDebt, description: e.target.value})}
                            />
                        </MasterDataFormField>
                        <MasterDataFormField span="half">
                             <MasterDataFieldLabel optional>Jatuh Tempo</MasterDataFieldLabel>
                            <Input 
                                type="date" 
                                className="uiInput"
                                value={newDebt.due_date}
                                onChange={(e) => setNewDebt({...newDebt, due_date: e.target.value})}
                            />
                        </MasterDataFormField>
                    </MasterDataFormGrid>
                    <MasterDataFormActions
                      isSubmitting={isProcessing}
                      onCancel={() => setCreateDialogOpen(false)}
                      saveLabel="Simpan Transaksi"
                      submitDisabled={!canManageFinance}
                    />
                </MasterDataDialogBody>
                </form>
            </MasterDataFormDialogContent>
        </Dialog>

        {/* EDIT DIALOG */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <MasterDataFormDialogContent size="wide" className="debtFormDialog">
                <MasterDataFormHeader
                  icon={Wallet}
                  title="Edit Transaksi Manual"
                  description="Ubah detail hutang/piutang tanpa mengubah relasi pihak transaksi."
                />
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmEdit();
                  }}
                >
                <MasterDataDialogBody className="debtFormBody">
                  <MasterDataFormGrid>
                        <MasterDataFormField span="half">
                            <MasterDataFieldLabel required>Jenis Transaksi</MasterDataFieldLabel>
                            <Select value={newDebt.type} onValueChange={(val: any) => setNewDebt({...newDebt, type: val})}>
                                <SelectTrigger className="uiSelectTrigger">
                                    <SelectValue placeholder="Pilih Jenis" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="receivable">Piutang (Uang Masuk)</SelectItem>
                                    <SelectItem value="payable">Hutang (Uang Keluar)</SelectItem>
                                </SelectContent>
                            </Select>
                        </MasterDataFormField>
                         <MasterDataFormField span="half">
                            <MasterDataFieldLabel required>Tanggal Transaksi</MasterDataFieldLabel>
                            <Input 
                                type="date" 
                                className="uiInput"
                                value={newDebt.transaction_date}
                                onChange={(e) => setNewDebt({...newDebt, transaction_date: e.target.value})}
                            />
                        </MasterDataFormField>

                     <MasterDataFormField span="half">
                        <MasterDataFieldLabel required>Pihak</MasterDataFieldLabel>
                        <Input value={newDebt.identity_name} disabled className="uiInput" />
                        <p className="text-[10px] text-slate-500">Nama pihak tidak dapat diubah saat edit.</p>
                    </MasterDataFormField>

                    <MasterDataFormField span="half">
                        <MasterDataFieldLabel required>Nominal</MasterDataFieldLabel>
                        <MasterDataCurrencyInput
                            value={newDebt.amount}
                            onValueChange={(amount) => setNewDebt({...newDebt, amount})}
                        />
                    </MasterDataFormField>

                    <MasterDataFormField span="full">
                            <MasterDataFieldLabel optional>Keterangan</MasterDataFieldLabel>
                            <Input 
                                className="uiInput"
                                placeholder="Cth: Kasbon sakit, Pembelian Kabel..." 
                                value={newDebt.description}
                                onChange={(e) => setNewDebt({...newDebt, description: e.target.value})}
                            />
                        </MasterDataFormField>
                        <MasterDataFormField span="half">
                             <MasterDataFieldLabel optional>Jatuh Tempo</MasterDataFieldLabel>
                            <Input 
                                type="date" 
                                className="uiInput"
                                value={newDebt.due_date}
                                onChange={(e) => setNewDebt({...newDebt, due_date: e.target.value})}
                            />
                        </MasterDataFormField>
                    </MasterDataFormGrid>
                    <MasterDataFormActions
                      isSubmitting={isProcessing}
                      onCancel={() => setEditDialogOpen(false)}
                      saveLabel="Simpan Perubahan"
                      submitDisabled={!canManageFinance}
                    />
                </MasterDataDialogBody>
                </form>
            </MasterDataFormDialogContent>
        </Dialog>

        {/* DELETE CONFIRMATION */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Hapus Transaksi?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Data hutang/piutang ini akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white" disabled={isProcessing || !canManageFinance}>
                        {isProcessing ? "Menghapus..." : "Hapus"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </OperationalPageShell>
  );
};
