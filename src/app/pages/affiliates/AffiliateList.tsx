import React, { useState, useEffect, useCallback } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Label } from '../../components/ui/label';
import { Plus, Search, Edit, Trash2, Phone, Loader2, ExternalLink, Share2, Users, UserCheck, WalletCards, UserX } from 'lucide-react';
import { Affiliate } from '../../types/affiliate';
import { toast } from 'sonner';
import { usePermissions } from '@/app/hooks/usePermissions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { useMasterData } from '@/app/pages/master-data/context';
import { logActivity } from '@/app/services/auditService';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
  RequiredLabel,
} from '../../components/ui/operational-page';

const readEdgeError = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return new Error(body?.error || fallback);
  } catch {
    return new Error(fallback);
  }
};

export const AffiliateList: React.FC = () => {
  const { hasPermission } = usePermissions();
  const { currentUser } = useMasterData();
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Dialog States
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form/Selection States
  const [currentAffiliate, setCurrentAffiliate] = useState<Affiliate | null>(null);
  const [formData, setFormData] = useState<Partial<Affiliate>>({
    nama_lengkap: '',
    no_whatsapp: '',
    status: 'Active',
    profesi: '',
    komisi: 0,
    total_komisi: 0,
    social_media: ''
  });

  const API_URL = buildMakeServerUrl();
  const AFFILIATE_APP_DATA_URL = `${API_URL}/app-data/affiliates`;

  // Fetch Affiliates
  const fetchAffiliates = useCallback(async () => {
    try {
      setLoading(true);

      const response = await fetch(`${AFFILIATE_APP_DATA_URL}?from=0&to=4999`, {
        headers: await getSessionBackedEdgeHeaders(),
      });
      
      if (!response.ok) {
         throw await readEdgeError(response, `Failed to fetch affiliates: ${response.status}`);
      }
      
      const apiData = await response.json();
      setAffiliates(Array.isArray(apiData?.rows) ? apiData.rows : []);
    } catch (error) {
      console.warn('Error fetching affiliates:', error);
      setAffiliates([]);
    } finally {
      setLoading(false);
    }
  }, [AFFILIATE_APP_DATA_URL]);

  useEffect(() => {
    if (hasPermission('affiliate.view')) {
      fetchAffiliates();
    }
  }, [hasPermission, fetchAffiliates]);

  // Access Control
  if (!hasPermission('affiliate.view')) {
    return (
      <OperationalPageShell className="affiliatePage">
        <OperationalEmptyState
          icon={UserX}
          title="Akses Ditolak"
          description="Anda tidak memiliki izin untuk mengakses halaman Affiliate. Hubungi administrator jika Anda memerlukan akses ini."
        />
      </OperationalPageShell>
    );
  }

  // Filtered Data
  const filteredAffiliates = affiliates.filter(item => 
    item.nama_lengkap.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.no_whatsapp.includes(searchQuery) ||
    item.profesi.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeAffiliates = affiliates.filter((item) => item.status === 'Active').length;
  const inactiveAffiliates = affiliates.length - activeAffiliates;
  const totalCommission = affiliates.reduce((sum, item) => sum + (Number(item.total_komisi) || 0), 0);

  // CRUD Handlers
  const handleAdd = async () => {
    setIsSubmitting(true);
    try {
        // Generate ID: AF- + 4 random digits
        const randomId = Math.floor(1000 + Math.random() * 9000);
        const newAffiliate: Affiliate = {
          id: `AF-${randomId}`,
          nama_lengkap: formData.nama_lengkap || '',
          no_whatsapp: formData.no_whatsapp || '',
          status: (formData.status as 'Active' | 'Inactive') || 'Active',
          profesi: formData.profesi || '',
          komisi: Number(formData.komisi) || 0,
          total_komisi: 0,
          social_media: formData.social_media || '',
          created_at: new Date().toISOString()
        };

        const response = await fetch(AFFILIATE_APP_DATA_URL, {
            method: 'POST',
            headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
            body: JSON.stringify(newAffiliate)
        });

        if (!response.ok) {
            throw await readEdgeError(response, 'Failed to create affiliate on server');
        }

        const body = await response.json();
        const savedAffiliate = body?.row || newAffiliate;
        setAffiliates([savedAffiliate, ...affiliates]);

        setIsAddDialogOpen(false);
        resetForm();
        toast.success("Affiliate berhasil ditambahkan");
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'CREATE', 'Affiliate',
            `Menambahkan affiliate: ${formData.nama_lengkap}`,
            ''
          );
        }
    } catch (error) {
        console.error('Error adding affiliate:', error);
        toast.error('Gagal menambahkan affiliate');
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!currentAffiliate) return;
    setIsSubmitting(true);
    try {
        const updatedData = {
            ...currentAffiliate,
            ...formData,
            komisi: Number(formData.komisi)
        };

        const response = await fetch(`${AFFILIATE_APP_DATA_URL}/${encodeURIComponent(currentAffiliate.id)}`, {
            method: 'PUT',
            headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
            body: JSON.stringify(updatedData)
        });

        if (!response.ok) {
            throw await readEdgeError(response, 'Failed to update affiliate on server');
        }

        const body = await response.json();
        const result = body?.row || updatedData;
        setAffiliates(affiliates.map(item => item.id === currentAffiliate.id ? result : item));
        setIsEditDialogOpen(false);
        setCurrentAffiliate(null);
        resetForm();
        toast.success("Data affiliate berhasil diperbarui");
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'UPDATE', 'Affiliate',
            `Memperbarui data affiliate: ${formData.nama_lengkap}`,
            currentAffiliate?.id || ''
          );
        }
    } catch (error) {
        console.error('Error updating affiliate:', error);
        toast.error('Gagal memperbarui affiliate');
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!currentAffiliate) return;
    try {
        const response = await fetch(`${AFFILIATE_APP_DATA_URL}/${encodeURIComponent(currentAffiliate.id)}`, {
            method: 'DELETE',
            headers: await getSessionBackedEdgeHeaders(),
        });

        if (!response.ok) {
            throw await readEdgeError(response, 'Failed to delete affiliate on server');
        }

        setAffiliates(affiliates.filter(item => item.id !== currentAffiliate.id));
        setIsDeleteDialogOpen(false);
        setCurrentAffiliate(null);
        toast.success("Affiliate berhasil dihapus");
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'DELETE', 'Affiliate',
            `Menghapus affiliate: ${currentAffiliate?.nama_lengkap}`,
            currentAffiliate?.id || ''
          );
        }
    } catch (error) {
        console.error('Error deleting affiliate:', error);
        toast.error('Gagal menghapus affiliate');
    }
  };

  const handleWhatsAppClick = (phone: string, name: string) => {
    const sanitizedPhone = phone.replace(/^0/, '62').replace(/\D/g, '');
    const message = `Halo ${name}, kami dari RHI System...`;
    const url = `https://wa.me/${sanitizedPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('id-ID').format(num);
  };

  const parseNumber = (str: string) => {
    return Number(str.replace(/\D/g, ''));
  };

  const handleKomisiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const numericValue = parseNumber(rawValue);
    setFormData({ ...formData, komisi: numericValue });
  };

  // Helper functions
  const openEditDialog = (affiliate: Affiliate) => {
    setCurrentAffiliate(affiliate);
    setFormData({
      nama_lengkap: affiliate.nama_lengkap,
      no_whatsapp: affiliate.no_whatsapp,
      status: affiliate.status,
      profesi: affiliate.profesi,
      komisi: affiliate.komisi,
      social_media: affiliate.social_media || ''
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (affiliate: Affiliate) => {
    setCurrentAffiliate(affiliate);
    setIsDeleteDialogOpen(true);
  };



  const resetForm = () => {
    setFormData({
      nama_lengkap: '',
      no_whatsapp: '',
      status: 'Active',
      profesi: '',
      komisi: 0,
      social_media: ''
    });
  };

  return (
    <OperationalPageShell className="affiliatePage">
      <div className="flex flex-col space-y-4">
        <OperationalPageHeader
          eyebrow="Operasional"
          icon={Share2}
          title="Affiliate"
          subtitle="Kelola data mitra affiliate, komisi, dan status keaktifan mereka."
          actions={
            hasPermission('affiliate.manage') ? (
              <Button
                className="affiliateHeaderButton h-9 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                onClick={() => setIsAddDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" /> Tambah Affiliate
              </Button>
            ) : null
          }
        />

        <OperationalKpiGrid>
          <OperationalKpiCard label="Total Affiliate" value={affiliates.length} icon={Users} />
          <OperationalKpiCard label="Aktif" value={activeAffiliates} icon={UserCheck} tone="emerald" />
          <OperationalKpiCard label="Nonaktif" value={inactiveAffiliates} icon={UserX} />
          <OperationalKpiCard label="Total Komisi" value={formatCurrency(totalCommission)} icon={WalletCards} tone="blue" />
        </OperationalKpiGrid>

        <OperationalFilterPanel className="affiliateFilterPanel">
             <div className="affiliateSearchBox relative w-full sm:w-72">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <Input
                  placeholder="Cari nama, whatsapp, atau profesi..."
                  className="affiliateSearchInput pl-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 transition-all w-full shadow-sm placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
             </div>
        </OperationalFilterPanel>

        <OperationalTableCard className="affiliateTableCard">

          {/* Table (Desktop) */}
          <div className="affiliateDesktopTable hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/50 dark:bg-slate-800/50">
                <TableRow className="border-b border-slate-100 dark:border-slate-700">
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4 pl-6">ID</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">Nama Lengkap</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">No Whatsapp</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">Profesi</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">Social Media</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">Komisi</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">Total Komisi</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4">Status</TableHead>
                  <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider py-4 pr-6">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                    <TableRow>
                        <TableCell colSpan={9}>
                             <div className="flex justify-center items-center gap-2">
                                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                                <span className="text-sm text-slate-500 dark:text-slate-400">Memuat data...</span>
                             </div>
                        </TableCell>
                    </TableRow>
                ) : filteredAffiliates.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={9}>
                       <OperationalEmptyState
                         icon={Share2}
                         title="Tidak ada data affiliate"
                         description="Coba ubah kata kunci pencarian atau tambahkan affiliate baru."
                       />
                     </TableCell>
                   </TableRow>
                ) : (
                  filteredAffiliates.map((affiliate) => (
                    <TableRow key={affiliate.id} className="affiliateTableRow hover:bg-slate-50/80 dark:hover:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors">
                      <TableCell className="py-4 pl-6 align-middle">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                           #{affiliate.id}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs border border-blue-200 dark:border-blue-800">
                                {affiliate.nama_lengkap.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="font-semibold text-slate-900 dark:text-slate-200 text-sm">
                                {affiliate.nama_lengkap}
                            </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                         <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                            <Phone className="w-3.5 h-3.5 mr-2 text-slate-400" />
                            {affiliate.no_whatsapp}
                         </div>
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                        <Badge variant="outline" className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 font-normal">
                            {affiliate.profesi}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                        {affiliate.social_media ? (
                           <a 
                             href={affiliate.social_media.startsWith('http') ? affiliate.social_media : `https://${affiliate.social_media}`}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="text-blue-600 hover:underline flex items-center gap-1 text-sm"
                           >
                              <ExternalLink className="h-3 w-3" />
                              <span className="truncate max-w-[150px]">{affiliate.social_media}</span>
                           </a>
                        ) : (
                           <span className="text-slate-400 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                        <span className="font-medium text-slate-700 dark:text-slate-300 text-sm">
                           {formatCurrency(affiliate.komisi)}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                        <span className="font-bold text-green-600 dark:text-green-400 text-sm">
                           {formatCurrency(affiliate.total_komisi)}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 align-middle">
                        <Badge 
                          className={
                            affiliate.status === 'Active' 
                              ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800" 
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                          }
                          variant="outline"
                        >
                          {affiliate.status === 'Active' ? (
                              <div className="flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                Aktif
                              </div>
                          ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-slate-400"></span>
                                Non-Aktif
                              </div>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4 pr-6 text-right align-middle">
                        <div className="flex justify-end gap-2">

                           <Button 
                             variant="ghost" 
                             size="icon" 
                             onClick={() => handleWhatsAppClick(affiliate.no_whatsapp, affiliate.nama_lengkap)}
                             className="h-8 w-8 text-[#25D366] hover:text-[#128C7E] hover:bg-green-50 dark:hover:bg-green-900/20"
                             title="Chat WhatsApp"
                           >
                             <Phone className="h-4 w-4" /> 
                           </Button>
                          {hasPermission('affiliate.manage') && (
                          <>
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(affiliate)} className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(affiliate)} className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View */}
          <div className="affiliateMobileList md:hidden p-4 space-y-4">
             {loading ? (
                 <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-2" />
                    <p className="text-slate-500">Memuat data...</p>
                 </div>
              ) : filteredAffiliates.length === 0 ? (
                  <OperationalEmptyState
                    icon={Share2}
                    title="Tidak ada data affiliate"
                    description="Coba ubah kata kunci pencarian atau tambahkan affiliate baru."
                  />
             ) : (
                 filteredAffiliates.map((affiliate) => (
                    <div key={affiliate.id} className="affiliateMobileCard bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
                        <div className="flex justify-between items-start mb-4">
                           <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm border border-blue-200 dark:border-blue-800">
                                  {affiliate.nama_lengkap.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                  <h3 className="font-bold text-slate-900 dark:text-slate-100">{affiliate.nama_lengkap}</h3>
                                  <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 font-medium">{affiliate.profesi}</span>
                                      <span className="text-xs text-slate-400">#{affiliate.id}</span>
                                  </div>
                              </div>
                           </div>
                           <Badge 
                              className={`text-[10px] px-2 py-0.5 ${
                                affiliate.status === 'Active' 
                                  ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" 
                                  : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                              }`}
                              variant="outline"
                            >
                              {affiliate.status === 'Active' ? 'Aktif' : 'Non-Aktif'}
                            </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-4 py-3 border-t border-b border-slate-100 dark:border-slate-700 mb-3 bg-slate-50/50 dark:bg-slate-800/50 -mx-4 px-4">
                            <div>
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Komisi</p>
                                <p className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(affiliate.komisi)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Komisi</p>
                                <p className="font-bold text-green-600 dark:text-green-400">{formatCurrency(affiliate.total_komisi)}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">

                            <Button 
                              variant="outline" 
                              className="flex-1 h-9 text-xs border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                              onClick={() => handleWhatsAppClick(affiliate.no_whatsapp, affiliate.nama_lengkap)}
                            >
                              <Phone className="w-3.5 h-3.5 mr-2 text-green-600" /> WhatsApp
                            </Button>
                            
                            {hasPermission('affiliate.manage') && (
                              <div className="flex gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-9 w-9 border border-slate-200 dark:border-slate-700 text-blue-600"
                                  onClick={() => openEditDialog(affiliate)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-9 w-9 border border-slate-200 dark:border-slate-700 text-red-600"
                                  onClick={() => openDeleteDialog(affiliate)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                        </div>
                    </div>
                 ))
             )}
          </div>
        </OperationalTableCard>

        {/* Add Sheet */}
        <Sheet open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <SheetContent side="right" className="affiliateFormSheet z-[150] flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-slate-50 p-0 shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:w-[560px] sm:max-w-[560px]">
            <SheetHeader className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-6 py-4 text-left dark:border-slate-800 dark:bg-slate-900">
              <SheetTitle className="text-slate-900 dark:text-slate-100">Tambah Affiliate Baru</SheetTitle>
              <SheetDescription className="text-slate-500 dark:text-slate-400">
                Isi formulir di bawah ini untuk menambahkan mitra affiliate baru.
              </SheetDescription>
            </SheetHeader>
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="grid gap-2">
                <RequiredLabel>Nama</RequiredLabel>
                <Input
                  id="name"
                  value={formData.nama_lengkap}
                  onChange={(e) => setFormData({ ...formData, nama_lengkap: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  placeholder="Nama Lengkap"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>No WA</RequiredLabel>
                <Input
                  id="wa"
                  value={formData.no_whatsapp}
                  onChange={(e) => setFormData({ ...formData, no_whatsapp: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  placeholder="08xxxxxxxxxx"
                  type="tel"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>Profesi</RequiredLabel>
                <Input
                  id="profesi"
                  value={formData.profesi}
                  onChange={(e) => setFormData({ ...formData, profesi: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  placeholder="Contoh: Bengkel, Sales"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="social_media" className="text-xs font-semibold text-slate-600 dark:text-slate-400">Social Media</Label>
                <Input
                  id="social_media"
                  value={formData.social_media}
                  onChange={(e) => setFormData({ ...formData, social_media: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  placeholder="Link atau Username"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>Komisi (Rp)</RequiredLabel>
                <Input
                  id="komisi"
                  type="text"
                  value={formData.komisi ? formatNumber(formData.komisi) : ''}
                  onChange={handleKomisiChange}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  placeholder="0"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>Status</RequiredLabel>
                <Select 
                  value={formData.status} 
                  onValueChange={(val) => setFormData({ ...formData, status: val as 'Active' | 'Inactive' })}
                >
                  <SelectTrigger className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                    <SelectValue placeholder="Pilih Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SheetFooter className="sticky bottom-0 z-10 shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:px-6">
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={isSubmitting} className="w-full sm:w-auto">
                Batal
              </Button>
              <Button type="submit" onClick={handleAdd} disabled={isSubmitting} className="w-full min-w-[100px] bg-blue-600 hover:bg-blue-700 text-white sm:w-auto">
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Simpan</> : "Simpan"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Edit Sheet */}
        <Sheet open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <SheetContent side="right" className="affiliateFormSheet z-[150] flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-slate-50 p-0 shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:w-[560px] sm:max-w-[560px]">
            <SheetHeader className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-6 py-4 text-left dark:border-slate-800 dark:bg-slate-900">
              <SheetTitle className="text-slate-900 dark:text-slate-100">Edit Affiliate</SheetTitle>
              <SheetDescription className="text-slate-500 dark:text-slate-400">
                Perbarui informasi mitra affiliate.
              </SheetDescription>
            </SheetHeader>
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 py-5 sm:px-6">
               {/* Same fields as Add with dark mode classes */}
               <div className="grid gap-2">
                <RequiredLabel>Nama</RequiredLabel>
                <Input
                  id="edit-name"
                  value={formData.nama_lengkap}
                  onChange={(e) => setFormData({ ...formData, nama_lengkap: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>No WA</RequiredLabel>
                <Input
                  id="edit-wa"
                  value={formData.no_whatsapp}
                  onChange={(e) => setFormData({ ...formData, no_whatsapp: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  type="tel"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>Profesi</RequiredLabel>
                <Input
                  id="edit-profesi"
                  value={formData.profesi}
                  onChange={(e) => setFormData({ ...formData, profesi: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-social-media" className="text-xs font-semibold text-slate-600 dark:text-slate-400">Social Media</Label>
                <Input
                  id="edit-social-media"
                  value={formData.social_media}
                  onChange={(e) => setFormData({ ...formData, social_media: e.target.value })}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  placeholder="Link atau Username"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>Komisi (Rp)</RequiredLabel>
                <Input
                  id="edit-komisi"
                  type="text"
                  value={formData.komisi ? formatNumber(formData.komisi) : ''}
                  onChange={handleKomisiChange}
                  className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid gap-2">
                <RequiredLabel>Status</RequiredLabel>
                <Select 
                  value={formData.status} 
                  onValueChange={(val) => setFormData({ ...formData, status: val as 'Active' | 'Inactive' })}
                >
                  <SelectTrigger className="affiliateFormControl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                    <SelectValue placeholder="Pilih Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SheetFooter className="sticky bottom-0 z-10 shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:px-6">
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSubmitting} className="w-full sm:w-auto">
                Batal
              </Button>
              <Button type="submit" onClick={handleEdit} disabled={isSubmitting} className="w-full min-w-[100px] bg-blue-600 hover:bg-blue-700 text-white sm:w-auto">
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Simpan</> : "Simpan"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Delete Confirmation */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
           <AlertDialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
             <AlertDialogHeader>
               <AlertDialogTitle className="text-slate-900 dark:text-slate-100">Apakah Anda yakin?</AlertDialogTitle>
               <AlertDialogDescription className="text-slate-500 dark:text-slate-400">
                 Tindakan ini tidak dapat dibatalkan. Data affiliate <strong>{currentAffiliate?.nama_lengkap}</strong> akan dihapus permanen.
               </AlertDialogDescription>
             </AlertDialogHeader>
             <AlertDialogFooter>
               <AlertDialogCancel className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700">Batal</AlertDialogCancel>
               <AlertDialogAction variant="danger" onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">Hapus</AlertDialogAction>
             </AlertDialogFooter>
           </AlertDialogContent>
        </AlertDialog>



      </div>
    </OperationalPageShell>
  );
};
