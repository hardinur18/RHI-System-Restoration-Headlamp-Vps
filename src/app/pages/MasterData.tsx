import React, { useState, useMemo, useEffect } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Search, Plus, Pencil, Trash2, AlertCircle, RefreshCw, Database } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { 
  MasterTabId, 
  MasterDataItem, 
  MOCK_BRANCHES, 
  MOCK_AREAS, 
  MOCK_SERVICES, 
  MOCK_VEHICLES, 
  MOCK_PLATFORMS, 
  MOCK_AD_ACCOUNTS,
  MOCK_SOURCES, 
  MOCK_PAYMENTS, 
  MOCK_TEAMS,
  MOCK_STAFF_STATUS,
  MOCK_EMPLOYMENT,
  MOCK_BANKS
} from './master-data/data';
import { MasterDataDialog } from './master-data/MasterDataDialog';
import { useMasterData } from './master-data/context';
import { usePermissions } from '@/app/hooks/usePermissions';
import { isOwnerLikeRole } from '@/app/data/roleHelpers';
import { toast } from 'sonner';
import { masterDataService } from '../services/masterDataService';

// Tabs configuration
const TABS: { id: MasterTabId; label: string }[] = [
  { id: 'branches', label: 'Cabang' },
  { id: 'areas', label: 'Daerah' },
  { id: 'services', label: 'Jenis Layanan' },
  { id: 'vehicles', label: 'Tipe Mobil' },
  { id: 'platforms', label: 'Platform Iklan' },
  { id: 'ad_accounts', label: 'Akun Iklan' },
  { id: 'sources', label: 'Sumber Iklan' },
  { id: 'payments', label: 'Metode Pembayaran' },
  { id: 'teams', label: 'Tim Teknisi' },
  { id: 'staff_status', label: 'Status Staff' },
  { id: 'employment', label: 'Tipe Kerja' },
  { id: 'banks', label: 'Bank' },
];

export default function MasterData() {
  const { currentRole } = useMasterData();
  const { hasPermission } = usePermissions();
  const [activeTab, setActiveTab] = useState<MasterTabId>('areas'); // Default to Area per request
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterDataItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Specific Filters
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');

  // State for delete dialog
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // State for all data
  // Initialize with empty arrays to indicate "not loaded" or "empty"
  // We will fetch on mount/tab change
  const [data, setData] = useState<Record<string, any[]>>({
    branches: [],
    areas: [],
    services: [],
    vehicles: [],
    platforms: [],
    ad_accounts: [],
    sources: [],
    payments: [],
    teams: [],
    staff_status: [],
    employment: [],
    banks: [],
  });

  // Fetch Data function
  const fetchData = async (tabId: MasterTabId) => {
    setIsLoading(true);
    try {
      const result = await masterDataService.getAll(tabId);
      setData(prev => ({ ...prev, [tabId]: result }));
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch on tab change
  useEffect(() => {
    fetchData(activeTab);
    
    // Also fetch dependencies if needed (e.g., branches for area filter)
    if (activeTab === 'areas' && data.branches.length === 0) fetchData('branches');
    if (activeTab === 'ad_accounts' && data.platforms.length === 0) fetchData('platforms');
    if (activeTab === 'sources' && data.ad_accounts.length === 0) fetchData('ad_accounts');
  }, [activeTab]);

  // Determine access rights (RBAC)
  const canCreate = hasPermission('master_data.create');
  const canEdit = hasPermission('master_data.edit');
  const canDelete = hasPermission('master_data.delete');
  const hasManagementAccess = canCreate || canEdit || canDelete;

  // Get current tab data
  const currentData = useMemo(() => {
    return data[activeTab] || [];
  }, [data, activeTab]);

  // Filter logic
  const filteredData = useMemo(() => {
    let result = currentData;

    // Filter by Branch (Specific for Areas tab)
    if (activeTab === 'areas' && selectedBranchId !== 'all') {
      result = result.filter((item: any) => item.branchId === selectedBranchId);
    }

    if (!searchQuery) return result;
    
    return result.filter((item: any) => 
      Object.values(item).some(val => 
        String(val).toLowerCase().includes(searchQuery.toLowerCase())
      )
    );
  }, [currentData, searchQuery, activeTab, selectedBranchId]);

  const handleTabChange = (tabId: MasterTabId) => {
    setActiveTab(tabId);
    setSearchQuery('');
    setSelectedBranchId('all');
  };

  const handleAdd = () => {
    setEditingItem(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (item: MasterDataItem) => {
    setEditingItem(item);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (id: string) => {
    if (!canDelete) return;
    setDeleteId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!canDelete) {
      toast.error('Anda tidak memiliki izin untuk menghapus data master');
      setDeleteId(null);
      setIsDeleteDialogOpen(false);
      return;
    }

    if (deleteId) {
      try {
        await masterDataService.delete(activeTab, deleteId);
        
        setData(prev => ({
          ...prev,
          [activeTab]: prev[activeTab].filter((item: any) => item.id !== deleteId)
        }));
        toast.success('Data berhasil dihapus');
      } catch (e) {
        // Error handled in service
      } finally {
        setDeleteId(null);
        setIsDeleteDialogOpen(false);
      }
    }
  };

  const handleFormSubmit = async (formData: any) => {
    if (editingItem && !canEdit) {
      toast.error('Anda tidak memiliki izin untuk mengedit data master');
      return;
    }

    if (!editingItem && !canCreate) {
      toast.error('Anda tidak memiliki izin untuk menambah data master');
      return;
    }

    try {
      let payload = { ...formData };
      
      if (editingItem) {
        payload.id = editingItem.id;
      } else {
         if (!payload.id) {
             payload.id = `${activeTab.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-4)}`;
         }
      }

      // Enrich data with denormalized names for display if needed
      // Note: In a real backend, this join should happen on the server or via relational queries.
      // Here we simulate it before saving to KV to keep it simple.
      if (activeTab === 'areas') {
        const branch = data.branches.find(b => b.id === payload.branchId);
        if (branch) payload.branchName = branch.name;
      }
      if (activeTab === 'ad_accounts') {
        const platform = data.platforms.find(p => p.id === payload.platformId);
        if (platform) payload.platformName = platform.name;
        // Advertiser name is usually in MOCK_USERS but we don't have that easily accessible here without fetching users.
        // For now, we trust the form/mock data or accept it might be missing if not passed.
      }
      if (activeTab === 'sources') {
        const acc = data.ad_accounts.find(a => a.id === payload.adAccountId);
        if (acc) {
          payload.adAccountName = acc.name || acc.accountName; // Handle different naming conventions if any
          payload.platformName = acc.platformName;
        }
      }
      if (activeTab === 'teams') {
        const branch = data.branches.find(b => b.id === payload.branchId);
        if (branch) payload.branchName = branch.name;
      }

      const savedItem = await masterDataService.save(activeTab, payload) as MasterDataItem;

      if (editingItem) {
        setData(prev => ({
          ...prev,
          [activeTab]: prev[activeTab].map((item: any) => 
            item.id === savedItem.id ? savedItem : item
          )
        }));
        toast.success('Data berhasil diperbarui');
      } else {
        setData(prev => ({
          ...prev,
          [activeTab]: [savedItem, ...prev[activeTab]]
        }));
        toast.success('Data berhasil ditambahkan');
      }
      setIsDialogOpen(false);
    } catch (e) {
      // Error handled in service
    }
  };

  const handleSeedData = async () => {
    if (!canCreate) {
      toast.error('Anda tidak memiliki izin untuk mengimpor data awal');
      return;
    }

    if (!confirm('Apakah Anda yakin ingin mengisi data awal? Data duplikat mungkin akan tertimpa.')) return;
    
    setIsLoading(true);
    try {
      let mockData: any[] = [];
      switch(activeTab) {
        case 'branches': mockData = MOCK_BRANCHES; break;
        case 'areas': mockData = MOCK_AREAS; break;
        case 'services': mockData = MOCK_SERVICES; break;
        case 'vehicles': mockData = MOCK_VEHICLES; break;
        case 'platforms': mockData = MOCK_PLATFORMS; break;
        case 'ad_accounts': mockData = MOCK_AD_ACCOUNTS; break;
        case 'sources': mockData = MOCK_SOURCES; break;
        case 'payments': mockData = MOCK_PAYMENTS; break;
        case 'teams': mockData = MOCK_TEAMS; break;
        case 'staff_status': mockData = MOCK_STAFF_STATUS; break;
        case 'employment': mockData = MOCK_EMPLOYMENT; break;
        case 'banks': mockData = MOCK_BANKS; break;
      }
      
      await masterDataService.seed(activeTab, mockData);
      toast.success('Data berhasil diimport');
      fetchData(activeTab);
    } catch (e) {
      toast.error('Gagal import data');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to render table headers dynamically
  const renderTableHeader = () => {
    const commonHeaders = (
      <>
        {activeTab !== 'ad_accounts' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Nama</TableHead>}
        {activeTab === 'branches' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Lokasi</TableHead>}
        {activeTab === 'branches' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Radius/Geofence</TableHead>}
        {activeTab === 'areas' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Induk Cabang</TableHead>}
        {activeTab === 'services' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Info Layanan</TableHead>}
        {activeTab === 'vehicles' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Kategori</TableHead>}
        {activeTab === 'ad_accounts' && (
          <>
            <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Platform</TableHead>
            <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Nama Akun</TableHead>
            <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Advertiser</TableHead>
            <TableHead className="font-semibold text-slate-700 dark:text-slate-300">PPN</TableHead>
            <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Fee</TableHead>
          </>
        )}
        {activeTab === 'sources' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Info Campaign</TableHead>}
        {activeTab === 'payments' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Info Rekening</TableHead>}
        {activeTab === 'teams' && <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Leader & Cabang</TableHead>}
        <TableHead className="w-[100px] font-semibold text-slate-700 dark:text-slate-300">Status</TableHead>
        {(canEdit || canDelete) && <TableHead className="text-right w-[100px] font-semibold text-slate-700 dark:text-slate-300">Aksi</TableHead>}
      </>
    );
    return <TableRow className="border-b border-slate-200 hover:bg-transparent">{commonHeaders}</TableRow>;
  };

  // Helper to render table rows dynamically
  const renderTableRow = (item: any) => (
    <TableRow key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 last:border-0">
      {activeTab !== 'ad_accounts' && (
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span className="text-slate-700">{item.name || item.accountName}</span>
          <span className="text-[10px] text-slate-400 font-mono">{item.code || item.id}</span>
        </div>
      </TableCell>
      )}
      
      {activeTab === 'branches' && (
        <>
          <TableCell>
            <div className="text-sm font-medium text-slate-700">{item.city}</div>
            <div className="text-xs text-slate-500 truncate max-w-[200px]">{item.address}</div>
            {item.maps_url && (
              <a href={item.maps_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">
                Lihat Peta
              </a>
            )}
          </TableCell>
          <TableCell>
            <div className="text-xs">
              {item.geofence ? (
                <Badge variant="outline" className="text-[10px] border-purple-200 text-purple-700 bg-purple-50">Geofence Active</Badge>
              ) : (
                <span className="text-slate-600">Radius: {item.radius} KM</span>
              )}
            </div>
          </TableCell>
        </>
      )}
      
      {activeTab === 'areas' && (
        <TableCell>
          <Badge variant="secondary" className="font-normal text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200">
            {item.branchName || item.branchId}
          </Badge>
        </TableCell>
      )}

      {activeTab === 'services' && (
        <TableCell>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">Rp {item.defaultPrice?.toLocaleString()}</div>
          <div className="text-xs text-slate-500 max-w-[200px] truncate">{item.description}</div>
        </TableCell>
      )}

      {activeTab === 'vehicles' && (
        <TableCell>
           <Badge variant="secondary" className="capitalize bg-slate-100 text-slate-600">
             {item.category}
           </Badge>
        </TableCell>
      )}

      {activeTab === 'ad_accounts' && (
        <>
          <TableCell>
            <span className="text-sm font-medium text-slate-700">{item.platformName}</span>
          </TableCell>
          <TableCell>
            <span className="text-sm font-medium text-slate-700">{item.accountName}</span>
          </TableCell>
          <TableCell>
            <span className="text-sm text-slate-500">{item.advertiserName}</span>
          </TableCell>
          <TableCell>
            <span className="text-sm font-medium text-slate-700">{item.ppn ?? 0}%</span>
          </TableCell>
          <TableCell>
            <span className="text-sm font-medium text-slate-700">{item.fee ?? 0}%</span>
          </TableCell>
        </>
      )}

      {activeTab === 'sources' && (
        <TableCell>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">{item.adAccountName}</span>
            <span className="text-xs text-slate-500">{item.platformName}</span>
            {item.defaultCsName && (
              <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded w-fit">Default CS: {item.defaultCsName}</span>
            )}
          </div>
        </TableCell>
      )}

      {activeTab === 'payments' && (
        <TableCell>
          <div className="text-sm font-medium text-slate-700">{item.accountNumber}</div>
          <div className="text-xs text-slate-500">{item.accountHolder}</div>
        </TableCell>
      )}

      {activeTab === 'teams' && (
        <TableCell>
           <div className="text-sm font-medium text-slate-700">{item.leaderName}</div>
           <div className="text-xs text-slate-500">Base: {item.branchName || item.branchId}</div>
        </TableCell>
      )}

      <TableCell>
        <Badge 
          className={
            item.status === 'active'
              ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/40 shadow-none font-medium'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 shadow-none'
          }
        >
          {item.status === 'active' ? 'Aktif' : 'Non Aktif'}
        </Badge>
      </TableCell>

      {(canEdit || canDelete) && (
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            {canEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-50" onClick={() => handleEdit(item)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteClick(item.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Master Data</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {hasManagementAccess || isOwnerLikeRole(currentRole)
              ? 'Kelola seluruh data referensi sistem.' 
              : 'Lihat daftar referensi sistem.'}
          </p>
        </div>
        <div className="flex gap-2">
          {hasManagementAccess && (
            <>
              <Button variant="outline" size="icon" onClick={() => fetchData(activeTab)} disabled={isLoading} title="Refresh Data">
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              {canCreate && currentData.length === 0 && !isLoading && (
                 <Button variant="outline" onClick={handleSeedData} className="gap-2">
                   <Database className="w-4 h-4" />
                   Isi Data Default
                 </Button>
              )}
              {canCreate && (
                <Button className="bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/20" onClick={handleAdd}>
                  <Plus className="w-4 h-4 mr-2" />
                  Tambah {TABS.find(t => t.id === activeTab)?.label}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scrollable Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 overflow-x-auto custom-scrollbar">
        <div className="flex gap-2 min-w-max pb-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${activeTab === tab.id 
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'}
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden min-h-[500px]">
        {/* Toolbar */}
        <div className="masterDataFilterPanel p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-4 bg-white dark:bg-slate-900">
          <div className="responsiveFilterGrid flex-1">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder={`Cari data ${TABS.find(t => t.id === activeTab)?.label.toLowerCase()}...`}
                className="pl-9 bg-white border-slate-200 focus:border-blue-500 transition-colors"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Filter khusus Tab Area */}
            {activeTab === 'areas' && (
              <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                <SelectTrigger className="w-[180px] bg-white border-slate-200">
                  <SelectValue placeholder="Semua Cabang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cabang</SelectItem>
                  {data.branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-normal text-slate-500 bg-white border-slate-200">
              Role: <span className="font-semibold ml-1 capitalize text-slate-700">{currentRole.replace('_', ' ')}</span>
            </Badge>
          </div>
        </div>

        {/* Table Container with padding/margin as requested */}
        <div className="overflow-x-auto px-6 py-2">
          <Table className="min-w-[800px]">
            <TableHeader className="bg-transparent">
              {renderTableHeader()}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                   <TableCell colSpan={canEdit ? 10 : 9} className="h-64 text-center text-slate-500">
                     <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                        <span className="text-slate-600">Memuat data...</span>
                     </div>
                   </TableCell>
                </TableRow>
              ) : filteredData.length > 0 ? (
                filteredData.map(renderTableRow)
              ) : (
                <TableRow>
                  <TableCell colSpan={canEdit ? 10 : 9} className="h-64 text-center text-slate-500 border-none">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="p-3 rounded-full bg-slate-50">
                        <Search className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="font-medium text-slate-600">Tidak ada data ditemukan</p>
                      <p className="text-xs text-slate-400">
                        {currentData.length === 0 
                          ? "Database kosong. Klik tombol 'Isi Data Default' untuk memuat data awal." 
                          : "Coba ubah kata kunci pencarian atau filter."}
                      </p>
                      {canEdit && <Button variant="link" onClick={handleAdd} className="mt-2 text-blue-600">Tambah data baru</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex justify-between items-center bg-slate-50/30 dark:bg-slate-800/30">
          <span>Menampilkan {filteredData.length} data</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled className="text-xs h-7">Prev</Button>
            <Button variant="ghost" size="sm" disabled className="text-xs h-7">Next</Button>
          </div>
        </div>
      </div>

      {/* Form Modal */}
      <MasterDataDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        activeTab={activeTab}
        item={editingItem}
        onSubmit={handleFormSubmit}
        dependencies={{
          branches: data.branches // Pass updated branch data
        }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Konfirmasi Hapus
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              Apakah Anda yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!isDeleteDialogOpen}>Batal</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              Hapus Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
