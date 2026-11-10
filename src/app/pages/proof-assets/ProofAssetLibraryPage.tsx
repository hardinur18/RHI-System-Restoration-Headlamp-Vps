import React from 'react';
import {
  Car,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Images,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Dialog } from '@/app/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Switch } from '@/app/components/ui/switch';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/app/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover';
import { TableActionMenu, TableActionMenuItem } from '@/app/components/ui/data-table';
import {
  MasterDataFormActions,
  MasterDataFormDialogContent,
  MasterDataFormField,
  MasterDataFormGrid,
  MasterDataFormHeader,
} from '@/app/components/ui/master-data-ui';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
  RequiredLabel,
} from '@/app/components/ui/operational-page';
import { cn } from '@/app/components/ui/utils';
import { usePermissions } from '@/app/hooks/usePermissions';
import { useMasterData } from '@/app/pages/master-data/context';
import {
  createProofAsset,
  createProofAssetId,
  deleteProofAsset,
  deleteProofAssetImage,
  getProofAssetPublicUrl,
  incrementProofAssetUsage,
  listProofAssets,
  normalizeProofAssetTags,
  ProofAsset,
  updateProofAsset,
  uploadProofAssetImage,
} from '@/app/services/proofAssets';
import {
  fetchWhatsAppContacts,
  WhatsAppContact,
} from '@/app/services/whatsappModuleService';

const ALL_FILTER_VALUE = 'all';
const NONE_VEHICLE_VALUE = 'none';
const NONE_YEAR_VALUE = 'none';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MIN_PROOF_ASSET_YEAR = 1980;
const MAX_PROOF_ASSET_YEAR = new Date().getFullYear() + 1;
const MAX_FORWARD_CONTACT_OPTIONS = 60;
const PROOF_ASSET_YEAR_OPTIONS = Array.from(
  { length: MAX_PROOF_ASSET_YEAR - MIN_PROOF_ASSET_YEAR + 1 },
  (_, index) => String(MAX_PROOF_ASSET_YEAR - index),
);

type AssetStatusFilter = 'all' | 'active' | 'inactive';

type ProofAssetFormState = {
  title: string;
  vehicleTypeId: string;
  year: string;
  tags: string;
  caption: string;
  isActive: boolean;
};

const emptyFormState: ProofAssetFormState = {
  title: '',
  vehicleTypeId: '',
  year: '',
  tags: '',
  caption: '',
  isActive: true,
};

type ProofAssetContactOption = {
  id: string;
  name: string;
  phone: string;
  source: string;
  channelId: string;
  searchValue: string;
};

const formatNumber = (value: number) => new Intl.NumberFormat('id-ID').format(value || 0);

const normalizeWhatsAppPhone = (value: string | null | undefined) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
};

const formatWhatsAppPhone = (phone: string) => {
  const normalized = normalizeWhatsAppPhone(phone);
  return normalized ? `+${normalized}` : '-';
};

const buildWhatsAppManualUrl = (phone: string, caption: string) => {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  const encodedCaption = encodeURIComponent(caption.trim());
  return `https://wa.me/${normalizedPhone}${encodedCaption ? `?text=${encodedCaption}` : ''}`;
};

const assetMatchesSearch = (asset: ProofAsset, search: string, vehicleName: string) => {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [
    asset.id,
    asset.title,
    asset.caption || '',
    vehicleName,
    asset.year ? String(asset.year) : '',
    asset.tags.join(' '),
  ].some((value) => value.toLowerCase().includes(query));
};

type ProofAssetImageProps = {
  src: string;
  alt: string;
  className: string;
  loading?: 'eager' | 'lazy';
};

function ProofAssetImage({ src, alt, className, loading = 'lazy' }: ProofAssetImageProps) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="proofAssetImageFallback" aria-label={alt}>
        <Images className="h-7 w-7" />
        <span>Gambar tidak tersedia</span>
      </div>
    );
  }

  return (
    <>
      <div className={cn('proofAssetImageSkeleton', loaded && 'isLoaded')} aria-hidden="true" />
      <img
        src={src}
        alt={alt}
        className={cn(className, !loaded && 'isLoading')}
        loading={loading}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </>
  );
}

export function ProofAssetLibraryPage() {
  const { vehicles, currentUser, leads, orders } = useMasterData();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('proof_assets.create');
  const canEdit = hasPermission('proof_assets.edit');
  const canDelete = hasPermission('proof_assets.delete');
  const canForwardWhatsApp = hasPermission('whatsapp.chats.reply');

  const [assets, setAssets] = React.useState<ProofAsset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [vehicleFilter, setVehicleFilter] = React.useState(ALL_FILTER_VALUE);
  const [statusFilter, setStatusFilter] = React.useState<AssetStatusFilter>('active');
  const [formOpen, setFormOpen] = React.useState(false);
  const [vehicleComboboxOpen, setVehicleComboboxOpen] = React.useState(false);
  const [editingAsset, setEditingAsset] = React.useState<ProofAsset | null>(null);
  const [previewAsset, setPreviewAsset] = React.useState<ProofAsset | null>(null);
  const [formState, setFormState] = React.useState<ProofAssetFormState>(emptyFormState);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [deletingAsset, setDeletingAsset] = React.useState<ProofAsset | null>(null);
  const [forwardAsset, setForwardAsset] = React.useState<ProofAsset | null>(null);
  const [whatsAppContacts, setWhatsAppContacts] = React.useState<WhatsAppContact[]>([]);
  const [contactsLoading, setContactsLoading] = React.useState(false);
  const [contactsLoaded, setContactsLoaded] = React.useState(false);
  const [selectedContactId, setSelectedContactId] = React.useState('');
  const [manualWhatsAppNumber, setManualWhatsAppNumber] = React.useState('');
  const [forwardCaption, setForwardCaption] = React.useState('');
  const [forwardSending, setForwardSending] = React.useState(false);
  const [contactComboboxOpen, setContactComboboxOpen] = React.useState(false);
  const [contactSearch, setContactSearch] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const activeVehicles = React.useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === 'active'),
    [vehicles],
  );

  const vehicleNameById = React.useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.name])),
    [vehicles],
  );

  const loadAssets = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssets(await listProofAssets());
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat Galeri Bukti.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  React.useEffect(() => {
    if (!selectedFile) {
      setSelectedFilePreview('');
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setSelectedFilePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  React.useEffect(() => {
    if (!forwardAsset || contactsLoaded || contactsLoading) return;

    setContactsLoading(true);
    fetchWhatsAppContacts()
      .then((response) => setWhatsAppContacts(response.contacts || []))
      .catch(() => setWhatsAppContacts([]))
      .finally(() => {
        setContactsLoaded(true);
        setContactsLoading(false);
      });
  }, [contactsLoaded, contactsLoading, forwardAsset]);

  const filteredAssets = React.useMemo(() => {
    return assets.filter((asset) => {
      const vehicleName = asset.vehicleTypeId ? vehicleNameById.get(asset.vehicleTypeId) || '' : '';
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? asset.isActive : !asset.isActive);
      const matchesVehicle =
        vehicleFilter === ALL_FILTER_VALUE || asset.vehicleTypeId === vehicleFilter;

      return matchesStatus && matchesVehicle && assetMatchesSearch(asset, search, vehicleName);
    });
  }, [assets, search, statusFilter, vehicleFilter, vehicleNameById]);

  const stats = React.useMemo(() => {
    const active = assets.filter((asset) => asset.isActive).length;
    const inactive = assets.length - active;
    const usage = assets.reduce((sum, asset) => sum + asset.usageCount, 0);
    return {
      total: assets.length,
      active,
      inactive,
      usage,
    };
  }, [assets]);

  const contactOptions = React.useMemo(() => {
    const optionMap = new Map<string, ProofAssetContactOption>();
    const addOption = (
      name: string | null | undefined,
      phone: string | null | undefined,
      source: string,
      channelId = 'whatsapp',
    ) => {
      const normalizedPhone = normalizeWhatsAppPhone(phone);
      if (!normalizedPhone || optionMap.has(normalizedPhone)) return;
      const contactName = String(name || '').trim() || formatWhatsAppPhone(normalizedPhone);
      optionMap.set(normalizedPhone, {
        id: normalizedPhone,
        name: contactName,
        phone: normalizedPhone,
        source,
        channelId,
        searchValue: `${contactName} ${normalizedPhone} ${source}`.toLowerCase(),
      });
    };

    leads.forEach((lead) => addOption(lead.name, lead.phone, 'Prospek'));
    orders.forEach((order) => addOption(order.customerName, order.customerPhone, 'Pesanan'));
    whatsAppContacts.forEach((contact) => addOption(
      contact.name,
      contact.phoneNumber,
      'Kontak WA',
      contact.channelId || 'whatsapp',
    ));

    return Array.from(optionMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'id-ID', { sensitivity: 'base' }),
    );
  }, [leads, orders, whatsAppContacts]);

  const selectedContact = React.useMemo(
    () => contactOptions.find((contact) => contact.id === selectedContactId) || null,
    [contactOptions, selectedContactId],
  );

  const visibleContactOptions = React.useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    const filtered = query
      ? contactOptions.filter((contact) => contact.searchValue.includes(query))
      : contactOptions;

    return filtered.slice(0, MAX_FORWARD_CONTACT_OPTIONS);
  }, [contactOptions, contactSearch]);

  const resetForm = React.useCallback(() => {
    setEditingAsset(null);
    setVehicleComboboxOpen(false);
    setFormState(emptyFormState);
    setSelectedFile(null);
    setSelectedFilePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const openCreateForm = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditForm = (asset: ProofAsset) => {
    setEditingAsset(asset);
    setFormState({
      title: asset.title,
      vehicleTypeId: asset.vehicleTypeId || '',
      year: asset.year ? String(asset.year) : '',
      tags: asset.tags.join(', '),
      caption: asset.caption || '',
      isActive: asset.isActive,
    });
    setSelectedFile(null);
    setSelectedFilePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFormOpen(true);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Gambar harus JPG, PNG, atau WebP.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('Ukuran gambar maksimal 25MB.');
      event.target.value = '';
      return;
    }

    setSelectedFile(file);
  };

  const validateForm = () => {
    if (!formState.title.trim()) {
      toast.error('Nama aset wajib diisi.');
      return false;
    }

    if (!formState.vehicleTypeId) {
      toast.error('Tipe mobil wajib dipilih.');
      return false;
    }

    const yearValue = formState.year.trim();
    if (yearValue) {
      const parsedYear = Number(yearValue);
      if (
        !Number.isInteger(parsedYear) ||
        parsedYear < MIN_PROOF_ASSET_YEAR ||
        parsedYear > MAX_PROOF_ASSET_YEAR
      ) {
        toast.error(`Tahun harus antara ${MIN_PROOF_ASSET_YEAR} sampai ${MAX_PROOF_ASSET_YEAR}.`);
        return false;
      }
    }

    if (!editingAsset && !selectedFile) {
      toast.error('Gambar wajib diupload.');
      return false;
    }

    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    let uploadedPath = '';
    try {
      const assetId = editingAsset?.id || createProofAssetId();
      const imagePath = selectedFile
        ? await uploadProofAssetImage(selectedFile, assetId)
        : editingAsset?.imagePath || '';
      uploadedPath = imagePath;

      const payload = {
        title: formState.title,
        vehicleTypeId: formState.vehicleTypeId,
        year: formState.year.trim() ? Number(formState.year) : null,
        imagePath,
        tags: normalizeProofAssetTags(formState.tags),
        caption: formState.caption,
        isActive: formState.isActive,
      };

      const savedAsset = editingAsset
        ? await updateProofAsset(editingAsset.id, payload, { existingAsset: editingAsset })
        : await createProofAsset({
            ...payload,
            id: assetId,
            createdBy: currentUser?.id || null,
          });

      if (editingAsset && selectedFile && editingAsset.imagePath !== imagePath) {
        await deleteProofAssetImage(editingAsset.imagePath).catch(() => undefined);
      }

      setAssets((current) => {
        const exists = current.some((asset) => asset.id === savedAsset.id);
        if (exists) return current.map((asset) => asset.id === savedAsset.id ? savedAsset : asset);
        return [savedAsset, ...current];
      });
      toast.success(editingAsset ? 'Aset berhasil diperbarui.' : 'Aset berhasil ditambahkan.');
      setFormOpen(false);
      resetForm();
    } catch (err: any) {
      if (!editingAsset && uploadedPath) {
        await deleteProofAssetImage(uploadedPath).catch(() => undefined);
      }
      toast.error(err?.message || 'Gagal menyimpan aset.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingAsset) return;

    setSaving(true);
    try {
      await deleteProofAsset(deletingAsset.id);
      await deleteProofAssetImage(deletingAsset.imagePath).catch(() => undefined);
      setAssets((current) => current.filter((asset) => asset.id !== deletingAsset.id));
      toast.success('Aset berhasil dihapus.');
      setDeletingAsset(null);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menghapus aset.');
    } finally {
      setSaving(false);
    }
  };

  const openForwardDialog = (asset: ProofAsset) => {
    setForwardAsset(asset);
    setSelectedContactId('');
    setManualWhatsAppNumber('');
    setForwardCaption(asset.caption || asset.title);
    setContactComboboxOpen(false);
    setContactSearch('');
  };

  const closeForwardDialog = (force = false) => {
    if (forwardSending && !force) return;
    setForwardAsset(null);
    setSelectedContactId('');
    setManualWhatsAppNumber('');
    setForwardCaption('');
    setContactComboboxOpen(false);
    setContactSearch('');
  };

  const handleOpenForwardWhatsApp = async () => {
    if (!forwardAsset) return;

    const selectedPhone = selectedContact?.phone || '';
    const targetPhone = selectedPhone || normalizeWhatsAppPhone(manualWhatsAppNumber);
    if (!targetPhone || targetPhone.length < 10) {
      toast.error('Nomor WhatsApp belum valid.');
      return;
    }

    const caption = forwardCaption.trim() || forwardAsset.caption || forwardAsset.title;

    window.open(buildWhatsAppManualUrl(targetPhone, caption), '_blank', 'noopener,noreferrer');
    setForwardSending(true);
    try {
      const updatedAsset = await incrementProofAssetUsage(forwardAsset.id, { existingAsset: forwardAsset }).catch(() => null);
      setAssets((current) => current.map((asset) => {
        if (asset.id !== forwardAsset.id) return asset;
        return updatedAsset || { ...asset, usageCount: asset.usageCount + 1 };
      }));

      toast.success('WhatsApp dibuka dengan caption.');
      closeForwardDialog(true);
    } catch (err: any) {
      toast.error(err?.message || 'WhatsApp terbuka, tapi gagal mencatat penggunaan aset.');
    } finally {
      setForwardSending(false);
    }
  };

  const previewUrl =
    selectedFilePreview ||
    (editingAsset ? getProofAssetPublicUrl(editingAsset.imagePath) : '');
  const selectedVehicleName = formState.vehicleTypeId
    ? vehicleNameById.get(formState.vehicleTypeId) || 'Tipe mobil tidak tersedia'
    : 'Belum pilih';

  const canSubmitForm =
    (editingAsset ? canEdit : canCreate) && !saving;

  return (
    <OperationalPageShell className="proofAssetPage">
      <OperationalPageHeader
        eyebrow="Library"
        icon={Images}
        title="Galeri Bukti"
        subtitle="Koleksi gambar hasil edit, before-after, dan testimoni yang rapi untuk dipakai lintas fitur."
        onRefresh={() => void loadAssets()}
        isRefreshing={loading}
        actions={
          <>
            {canCreate && (
              <Button
                className="h-9 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                onClick={openCreateForm}
              >
                <Plus className="mr-2 h-4 w-4" />
                Tambah Aset
              </Button>
            )}
          </>
        }
      />

      <OperationalKpiGrid>
        <OperationalKpiCard label="Total Aset" value={formatNumber(stats.total)} icon={Images} />
        <OperationalKpiCard label="Aktif" value={formatNumber(stats.active)} icon={Eye} tone="emerald" />
        <OperationalKpiCard label="Nonaktif" value={formatNumber(stats.inactive)} icon={EyeOff} tone="amber" />
        <OperationalKpiCard label="Terpakai" value={formatNumber(stats.usage)} icon={CheckCircle2} tone="blue" />
      </OperationalKpiGrid>

      <OperationalFilterPanel className="proofAssetFilterPanel">
        <div className="responsiveFilterGrid proofAssetFilterGrid">
          <div className="proofAssetSearchWrap">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="proofAssetFilterControl pl-9"
              placeholder="Cari judul, tipe mobil, tahun, tags, caption, atau ID"
            />
          </div>
          <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
            <SelectTrigger className="proofAssetFilterControl">
              <SelectValue placeholder="Semua tipe mobil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Semua tipe mobil</SelectItem>
              {activeVehicles.map((vehicle) => (
                <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as AssetStatusFilter)}>
            <SelectTrigger className="proofAssetFilterControl">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
              <SelectItem value="all">Semua status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </OperationalFilterPanel>

      <OperationalTableCard className="proofAssetTablePanel">
        {loading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Memuat galeri bukti...</p>
              <p className="mt-1 text-xs font-medium text-slate-500">Mengambil metadata aset dari database.</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 pb-10">
            <OperationalEmptyState
              icon={Images}
              title="Galeri belum siap"
              description={error}
              className="pb-0"
            />
            <Button variant="outline" onClick={() => void loadAssets()}>
              Coba Lagi
            </Button>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pb-10">
            <OperationalEmptyState
              icon={Images}
              title="Belum ada aset"
              description="Aset yang cocok dengan filter belum tersedia."
              className="pb-0"
            />
            {canCreate && (
              <Button onClick={openCreateForm}>
                Tambah Aset
              </Button>
            )}
          </div>
        ) : (
          <div className="proofAssetGalleryGrid">
            {filteredAssets.map((asset, index) => {
              const vehicleName = asset.vehicleTypeId
                ? vehicleNameById.get(asset.vehicleTypeId) || 'Tipe mobil tidak tersedia'
                : 'Tanpa tipe mobil';
              const imageUrl = getProofAssetPublicUrl(asset.imagePath);

              return (
                <article
                  key={asset.id}
                  role="button"
                  tabIndex={0}
                  className="proofAssetCard group"
                  onClick={() => setPreviewAsset(asset)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setPreviewAsset(asset);
                    }
                  }}
                >
                  <div className="proofAssetImageWrap">
                    <ProofAssetImage
                      src={imageUrl}
                      alt={asset.title}
                      className="proofAssetImage"
                      loading={index < 6 ? 'eager' : 'lazy'}
                    />
                    <div className="proofAssetImageShade" />
                    <div className="proofAssetCardStatus">
                      <span className="proofAssetStatusPill">
                        <span className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          asset.isActive ? 'bg-emerald-500' : 'bg-slate-400',
                        )} />
                        {asset.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <div
                      className="proofAssetCardMenu"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <TableActionMenu>
                        <TableActionMenuItem icon={Eye} onSelect={() => setPreviewAsset(asset)}>
                          Lihat Detail
                        </TableActionMenuItem>
                        {canForwardWhatsApp && (
                          <TableActionMenuItem icon={Send} onSelect={() => openForwardDialog(asset)}>
                            Kirim WhatsApp
                          </TableActionMenuItem>
                        )}
                        {canEdit && (
                          <TableActionMenuItem icon={Pencil} onSelect={() => openEditForm(asset)}>
                            Edit Aset
                          </TableActionMenuItem>
                        )}
                        {canDelete && (
                          <TableActionMenuItem danger icon={Trash2} onSelect={() => setDeletingAsset(asset)}>
                            Hapus Aset
                          </TableActionMenuItem>
                        )}
                      </TableActionMenu>
                    </div>
                  </div>
                  <div className="proofAssetCardBody">
                    <div className="min-w-0 space-y-1">
                      <h2 className="proofAssetCardTitle">
                        {asset.title}
                      </h2>
                      <div className="proofAssetCardMeta">
                        <Car className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{vehicleName}{asset.year ? ` - ${asset.year}` : ''}</span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </OperationalTableCard>

      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => !open && setPreviewAsset(null)}>
        {previewAsset && (() => {
          const imageUrl = getProofAssetPublicUrl(previewAsset.imagePath);
          const vehicleName = previewAsset.vehicleTypeId
            ? vehicleNameById.get(previewAsset.vehicleTypeId) || 'Tipe mobil tidak tersedia'
            : '-';

          return (
            <MasterDataFormDialogContent
              preventOutsideClose={false}
              size="wide"
              className="proofAssetDetailDialog"
            >
              <MasterDataFormHeader
                icon={Images}
                title="Detail Galeri Bukti"
                description="Preview gambar dan metadata aset bukti."
              />
              <div className="proofAssetDetailBody">
                <div className="proofAssetDetailLayout">
                  <div className="proofAssetDetailImageFrame">
                    <ProofAssetImage
                      src={imageUrl}
                      alt={previewAsset.title}
                      className="proofAssetDetailImage"
                      loading="eager"
                    />
                  </div>
                  <div className="proofAssetDetailInfo">
                    <div className="proofAssetDetailHero">
                      <span className={cn('proofAssetStatusBadge', previewAsset.isActive ? 'isActive' : 'isInactive')}>
                        {previewAsset.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                      <h2>{previewAsset.title}</h2>
                      <p>{previewAsset.id}</p>
                    </div>
                    <div className="proofAssetDetailRows">
                      <div>
                        <span>Tipe Mobil</span>
                        <strong>{vehicleName}</strong>
                      </div>
                      <div>
                        <span>Tahun</span>
                        <strong>{previewAsset.year || '-'}</strong>
                      </div>
                      <div>
                        <span>Terpakai</span>
                        <strong>{formatNumber(previewAsset.usageCount)} kali</strong>
                      </div>
                      <div>
                        <span>Tags</span>
                        <strong>{previewAsset.tags.length ? previewAsset.tags.join(', ') : '-'}</strong>
                      </div>
                      <div className="proofAssetDetailRowWide">
                        <span>Caption</span>
                        <strong>{previewAsset.caption || '-'}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="proofAssetDetailActions">
                <Button type="button" variant="outline" onClick={() => setPreviewAsset(null)}>
                  Tutup
                </Button>
                {canForwardWhatsApp && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const asset = previewAsset;
                      setPreviewAsset(null);
                      openForwardDialog(asset);
                    }}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Kirim WhatsApp
                  </Button>
                )}
                {canEdit && (
                  <Button
                    type="button"
                    onClick={() => {
                      const asset = previewAsset;
                      setPreviewAsset(null);
                      openEditForm(asset);
                    }}
                  >
                    Edit Aset
                  </Button>
                )}
              </div>
            </MasterDataFormDialogContent>
          );
        })()}
      </Dialog>

      <Dialog open={Boolean(forwardAsset)} onOpenChange={(open) => !open && closeForwardDialog()}>
        {forwardAsset && (() => {
          const imageUrl = getProofAssetPublicUrl(forwardAsset.imagePath);
          const vehicleName = forwardAsset.vehicleTypeId
            ? vehicleNameById.get(forwardAsset.vehicleTypeId) || 'Tipe mobil tidak tersedia'
            : '-';
          const manualTarget = normalizeWhatsAppPhone(manualWhatsAppNumber);
          const targetPhone = selectedContact?.phone || manualTarget;

          return (
            <MasterDataFormDialogContent
              preventOutsideClose={false}
              size="wide"
              className="proofAssetForwardDialog"
            >
              <MasterDataFormHeader
                icon={Send}
                title="Kirim Gambar ke WhatsApp"
                description="Pilih kontak atau isi nomor manual, lalu kirim gambar galeri dengan caption."
              />

              <div className="proofAssetForwardBody">
                <section className="proofAssetForwardPreview">
                  <div className="proofAssetForwardImageFrame">
                    <ProofAssetImage
                      src={imageUrl}
                      alt={forwardAsset.title}
                      className="proofAssetForwardImage"
                      loading="eager"
                    />
                  </div>
                  <div className="proofAssetForwardPreviewMeta">
                    <strong>{forwardAsset.title}</strong>
                    <span>{vehicleName}{forwardAsset.year ? ` - ${forwardAsset.year}` : ''}</span>
                  </div>
                </section>

                <div className="proofAssetForwardFields">
                  <MasterDataFormGrid>
                    <MasterDataFormField span="full">
                      <Label>Kontak tersimpan</Label>
                      <Popover open={contactComboboxOpen} onOpenChange={setContactComboboxOpen}>
                        <PopoverTrigger
                          type="button"
                          role="combobox"
                          aria-expanded={contactComboboxOpen}
                          className={cn(
                            'uiSelectTrigger proofAssetContactTrigger',
                            !selectedContact && 'text-slate-500',
                          )}
                        >
                          <span className="truncate">
                            {selectedContact
                              ? `${selectedContact.name} - ${formatWhatsAppPhone(selectedContact.phone)}`
                              : contactsLoading
                                ? 'Memuat kontak...'
                                : 'Pilih kontak tersimpan'}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-[var(--radix-popover-trigger-width)] min-w-[360px] p-0"
                        >
                          <Command shouldFilter={false}>
                            <CommandInput
                              value={contactSearch}
                              onValueChange={setContactSearch}
                              placeholder="Cari nama atau nomor..."
                            />
                            <CommandList>
                              <CommandEmpty>
                                {contactsLoading ? 'Memuat kontak...' : 'Kontak tidak ditemukan.'}
                              </CommandEmpty>
                              <CommandGroup>
                                <CommandItem
                                  value="manual"
                                  onSelect={() => {
                                    setSelectedContactId('');
                                    setContactSearch('');
                                    setContactComboboxOpen(false);
                                  }}
                                >
                                  <Phone className="mr-2 h-4 w-4 text-slate-500" />
                                  Input nomor manual
                                  <Check className={cn('ml-auto h-4 w-4', !selectedContact ? 'opacity-100' : 'opacity-0')} />
                                </CommandItem>
                                {visibleContactOptions.map((contact) => (
                                  <CommandItem
                                    key={contact.id}
                                    value={contact.id}
                                    onSelect={() => {
                                      setSelectedContactId(contact.id);
                                      setManualWhatsAppNumber('');
                                      setContactSearch('');
                                      setContactComboboxOpen(false);
                                    }}
                                  >
                                    <MessageCircle className="mr-2 h-4 w-4 text-blue-500" />
                                    <span className="proofAssetContactOption">
                                      <strong>{contact.name}</strong>
                                      <span>{formatWhatsAppPhone(contact.phone)} - {contact.source}</span>
                                    </span>
                                    <Check className={cn(
                                      'ml-auto h-4 w-4',
                                      selectedContactId === contact.id ? 'opacity-100' : 'opacity-0',
                                    )} />
                                  </CommandItem>
                                ))}
                                {!contactsLoading && contactOptions.length > visibleContactOptions.length && (
                                  <div className="px-3 py-2 text-xs font-semibold text-slate-500">
                                    Ketik nama atau nomor untuk mencari kontak lain.
                                  </div>
                                )}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </MasterDataFormField>

                    <MasterDataFormField span="full">
                      <Label htmlFor="proof-forward-number">Nomor WhatsApp Manual</Label>
                      <Input
                        id="proof-forward-number"
                        value={manualWhatsAppNumber}
                        onChange={(event) => {
                          setManualWhatsAppNumber(event.target.value);
                          setSelectedContactId('');
                        }}
                        inputMode="tel"
                        placeholder="Contoh: 08123456789"
                      />
                    </MasterDataFormField>

                    <MasterDataFormField span="full">
                      <Label htmlFor="proof-forward-caption">Caption</Label>
                      <Textarea
                        id="proof-forward-caption"
                        value={forwardCaption}
                        onChange={(event) => setForwardCaption(event.target.value)}
                        rows={4}
                        placeholder="Tulis caption WhatsApp..."
                      />
                    </MasterDataFormField>
                  </MasterDataFormGrid>
                  <div className="proofAssetForwardTarget">
                    Tujuan: <strong>{targetPhone ? formatWhatsAppPhone(targetPhone) : 'belum dipilih'}</strong>
                  </div>
                </div>
              </div>

              <div className="proofAssetForwardActions">
                <Button type="button" variant="outline" onClick={() => closeForwardDialog()} disabled={forwardSending}>
                  Batal
                </Button>
                <Button type="button" onClick={handleOpenForwardWhatsApp} disabled={forwardSending || !targetPhone}>
                  {forwardSending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Buka WhatsApp
                </Button>
              </div>
            </MasterDataFormDialogContent>
          );
        })()}
      </Dialog>

      <Dialog open={formOpen} onOpenChange={(open) => {
        setFormOpen(open);
        if (!open) resetForm();
      }}>
        <MasterDataFormDialogContent size="wide" className="proofAssetFormDialog">
          <MasterDataFormHeader
            icon={Images}
            title={editingAsset ? 'Edit Aset Galeri Bukti' : 'Tambah Aset Galeri Bukti'}
            description={editingAsset ? editingAsset.id : 'Upload gambar final dan metadata aset.'}
          />

          <form className="masterDataForm proofAssetManagedForm" onSubmit={handleSubmit}>
            <div className="proofAssetFormBody">
              <section className="proofAssetUploadPanel">
                <Label>
                  <RequiredLabel>Gambar</RequiredLabel>
                </Label>
                <div className="proofAssetUploadPreview">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Preview aset" />
                  ) : (
                    <div className="proofAssetUploadEmpty">
                      <Images className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="proofAssetUploadButton"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Pilih Gambar
                </Button>
                <p>
                  Gambar otomatis dikompres untuk tampilan app.
                </p>
              </section>

              <MasterDataFormGrid className="proofAssetFormGrid">
                <MasterDataFormField span="full">
                  <Label htmlFor="proof-title">
                    <RequiredLabel>Nama Aset</RequiredLabel>
                  </Label>
                  <Input
                    id="proof-title"
                    value={formState.title}
                    onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Contoh: Innova lampu kuning"
                  />
                </MasterDataFormField>

                <MasterDataFormField span="half">
                  <Label>
                    <RequiredLabel>Tipe Mobil</RequiredLabel>
                  </Label>
                  <Popover open={vehicleComboboxOpen} onOpenChange={setVehicleComboboxOpen}>
                    <PopoverTrigger
                      type="button"
                      role="combobox"
                      aria-expanded={vehicleComboboxOpen}
                      className={cn(
                        'uiSelectTrigger proofAssetComboboxTrigger',
                        !formState.vehicleTypeId && 'text-slate-500',
                      )}
                    >
                      <span className="truncate">{selectedVehicleName}</span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Cari tipe mobil..." />
                        <CommandList>
                          <CommandEmpty>Tipe mobil tidak ditemukan.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value={NONE_VEHICLE_VALUE}
                              onSelect={() => {
                                setFormState((current) => ({ ...current, vehicleTypeId: '' }));
                                setVehicleComboboxOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  !formState.vehicleTypeId ? 'opacity-100' : 'opacity-0',
                                )}
                              />
                              Belum pilih
                            </CommandItem>
                            {activeVehicles.map((vehicle) => (
                              <CommandItem
                                key={vehicle.id}
                                value={`${vehicle.name} ${vehicle.category || ''}`}
                                onSelect={() => {
                                  setFormState((current) => ({ ...current, vehicleTypeId: vehicle.id }));
                                  setVehicleComboboxOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    formState.vehicleTypeId === vehicle.id ? 'opacity-100' : 'opacity-0',
                                  )}
                                />
                                <span className="truncate">{vehicle.name}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </MasterDataFormField>

                <MasterDataFormField span="half">
                  <Label htmlFor="proof-year">Tahun</Label>
                  <Select
                    value={formState.year || NONE_YEAR_VALUE}
                    onValueChange={(value) => setFormState((current) => ({
                      ...current,
                      year: value === NONE_YEAR_VALUE ? '' : value,
                    }))}
                  >
                    <SelectTrigger id="proof-year">
                      <SelectValue placeholder="Pilih tahun" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_YEAR_VALUE}>Belum pilih</SelectItem>
                      {PROOF_ASSET_YEAR_OPTIONS.map((year) => (
                        <SelectItem key={year} value={year}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </MasterDataFormField>

                <MasterDataFormField span="full">
                  <Label htmlFor="proof-tags">Tags</Label>
                  <Input
                    id="proof-tags"
                    value={formState.tags}
                    onChange={(event) => setFormState((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="kuning, buram, home service"
                  />
                </MasterDataFormField>

                <MasterDataFormField span="full">
                  <Label htmlFor="proof-caption">Caption</Label>
                  <Textarea
                    id="proof-caption"
                    value={formState.caption}
                    onChange={(event) => setFormState((current) => ({ ...current, caption: event.target.value }))}
                    placeholder="Deskripsi singkat tentang mobil atau gambar"
                    rows={3}
                  />
                </MasterDataFormField>

                <MasterDataFormField span="full">
                  <div className="proofAssetStatusSwitch">
                    <Label htmlFor="proof-active" className="text-sm">
                      Status Aktif
                    </Label>
                    <Switch
                      id="proof-active"
                      checked={formState.isActive}
                      onCheckedChange={(checked) => setFormState((current) => ({ ...current, isActive: checked }))}
                    />
                  </div>
                </MasterDataFormField>
              </MasterDataFormGrid>
            </div>

            <MasterDataFormActions
              onCancel={() => {
                setFormOpen(false);
                resetForm();
              }}
              isSubmitting={saving}
              submitDisabled={!canSubmitForm}
              saveLabel={editingAsset ? 'Simpan Aset' : 'Tambah Aset'}
            />
          </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deletingAsset)} onOpenChange={(open) => !open && setDeletingAsset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus aset?</AlertDialogTitle>
            <AlertDialogDescription>
              Aset {deletingAsset?.title || ''} akan dihapus dari library dan storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={saving}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OperationalPageShell>
  );
}
